/**
 * Carregamento automático pela kursiPay: definições (platform_settings), elegibilidade, e CRIAÇÃO do pagamento (pedido interno + chamada à API).
 * Reutiliza as regras do carregamento de #145 (lib/carregamento.ts): referência gerada no servidor e escondida do utilizador, máximo 3 pedidos pendentes,
 * pedido igual (mesma conta e valor) recusado durante 10 min; o limitador de 5 pedidos por hora está em app.ts. O crédito é feito pelo webhook (routes/kursipayWebhook.ts).
 * Definições (platform_settings, value = {"value": …}):
 *   topup_kursipay_ativo           true liga a CRIAÇÃO de pagamentos kursiPay (ausente/false = desligada; o webhook processa SEMPRE os pagamentos já existentes)
 *   kursipay_sandbox_utilizadores  lista de ids de utilizador: em SANDBOX só estas contas criam pagamentos e só elas recebem crédito
 *   kursipay_valor_max             máximo por carregamento automático, em Kz (por defeito 100 000)
 */
import { randomInt } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, usersTable, topupRequestsTable, kursipayPagamentosTable, platformSettingsTable } from "@workspace/db";
import { JANELA_REPETIDO_MS, MAX_PENDENTES, VALOR_MIN } from "./carregamento";
import { criarPagamento, detalhesReferencia, formaCheckoutUrl, KursipayErro, mensagemDeErro, METODOS_DIRETOS, normalizarTelefoneAO, urlCheckout, type ConfigKursipay, type DetalhesReferencia, type ErroUtilizador, type MetodoDireto } from "./kursipay";
import { logger } from "./logger";
import { erroSeguro } from "./erroSeguro";
import { notificarAdmins } from "./takedown";

export const KURSIPAY_ATIVO_KEY = "topup_kursipay_ativo";
export const KURSIPAY_SANDBOX_KEY = "kursipay_sandbox_utilizadores";
export const KURSIPAY_VALOR_MAX_KEY = "kursipay_valor_max";
export const VALOR_MAX_PADRAO_KZ = 100_000;
export const MSG_INDISPONIVEL = "O pagamento online não está disponível de momento. Usa a transferência bancária.";

export interface SettingsKursipay { ativo: boolean; sandboxIds: number[]; valorMaxKz: number }
export async function lerSettingsKursipay(q: Pick<typeof db, "select"> = db): Promise<SettingsKursipay> {
  const rows = await q.select({ key: platformSettingsTable.key, value: platformSettingsTable.value }).from(platformSettingsTable)
    .where(inArray(platformSettingsTable.key, [KURSIPAY_ATIVO_KEY, KURSIPAY_SANDBOX_KEY, KURSIPAY_VALOR_MAX_KEY]));
  const v = (k: string): unknown => (rows.find((r) => r.key === k)?.value as { value?: unknown } | null)?.value;
  const ids = v(KURSIPAY_SANDBOX_KEY);
  const max = v(KURSIPAY_VALOR_MAX_KEY);
  return {
    ativo: v(KURSIPAY_ATIVO_KEY) === true,
    sandboxIds: Array.isArray(ids) ? ids.filter((x): x is number => Number.isInteger(x) && x > 0) : [],
    valorMaxKz: typeof max === "number" && Number.isFinite(max) && max >= VALOR_MIN && max <= 1_000_000 ? max : VALOR_MAX_PADRAO_KZ,
  };
}
/** Pode ESTA conta criar pagamentos kursiPay? (chave ligada; em sandbox, só as contas da lista). */
export const elegivel = (s: SettingsKursipay, cfg: ConfigKursipay, userId: number): boolean => s.ativo && (cfg.ambiente === "production" || s.sandboxIds.includes(userId));

const ALFABETO_REF = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const gerarReferenciaInterna = (): string => `XCL-${Array.from({ length: 8 }, () => ALFABETO_REF[randomInt(ALFABETO_REF.length)]).join("")}`;

/** Valor em Kz → cêntimos INTEIROS exatos (no máximo 2 casas decimais); null se não for representável (ex.: 500.999). Nunca arredonda um valor inválido. */
export function paraCentimos(kz: unknown): number | null {
  if (typeof kz !== "number" || !Number.isFinite(kz)) return null;
  const c = Math.round(kz * 100);
  return Math.abs(kz * 100 - c) < 1e-6 && Number.isSafeInteger(c) ? c : null;
}

export type ResultadoCriar = { ok: true; topupId: number; ambiente: string; checkoutUrl?: string; metodo?: MetodoDireto; referencia?: DetalhesReferencia } | { ok: false; erro: ErroUtilizador };
const erro = (http: number, codigo: string, mensagem: string): ResultadoCriar => ({ ok: false, erro: { http, codigo, mensagem } });

/** Alerta para os administradores (notificação do sistema; sem dados pessoais). Nunca lança. */
async function alertar(msg: string, alvoId: number): Promise<void> {
  try { await db.transaction(async (tx) => { await notificarAdmins(tx, msg, alvoId); }); } catch { /* o alerta nunca estraga a resposta */ }
}

/** `opc.metodo` ausente = checkout hospedado (compatibilidade); «multicaixa_express» | «reference» = cobrança DIRETA (o utilizador nunca sai do site). O telefone só é usado neste pedido: nunca é guardado nem registado. */
export async function criarCarregamentoKursipay(cfg: ConfigKursipay, userId: number, amountKz: unknown, opc: { metodo?: unknown; telefone?: unknown } = {}): Promise<ResultadoCriar> {
  const s = await lerSettingsKursipay();
  if (!elegivel(s, cfg, userId)) return erro(403, "metodo_indisponivel", MSG_INDISPONIVEL);
  const centimos = paraCentimos(amountKz);
  if (centimos === null) return erro(400, "valor_invalido", "O valor só pode ter até 2 casas decimais.");
  const kz = centimos / 100;
  if (kz < VALOR_MIN) return erro(400, "valor_invalido", `Valor mínimo: ${VALOR_MIN} Kz`);
  if (kz > s.valorMaxKz) return erro(400, "valor_invalido", `Valor máximo no pagamento online: ${s.valorMaxKz.toLocaleString("pt-PT")} Kz`);

  let metodo: MetodoDireto | undefined, telefone: string | undefined;
  if (opc.metodo !== undefined) {
    if (typeof opc.metodo !== "string" || !(METODOS_DIRETOS as readonly string[]).includes(opc.metodo)) return erro(400, "metodo_invalido", "Método de pagamento inválido.");
    metodo = opc.metodo as MetodoDireto;
    if (metodo === "multicaixa_express") {
      const tel = normalizarTelefoneAO(opc.telefone);
      if (!tel) return erro(400, "telefone_invalido", "Número de telemóvel inválido. Usa o número angolano do teu Multicaixa Express (9 dígitos, ex.: 923 456 789).");
      telefone = tel;
    }
  }

  // 1. Pedido interno + registo do pagamento (uma transação; a conta bloqueada serializa os pedidos da mesma conta).
  let criado: { topupId: number; reference: string; pagamentoId: number } | { erro: ResultadoCriar } | null = null;
  for (let tentativa = 0; tentativa < 3 && !criado; tentativa++) {
    const reference = gerarReferenciaInterna();
    try {
      criado = await db.transaction(async (tx) => {
        const [conta] = await tx.select({ ativo: usersTable.ativo }).from(usersTable).where(eq(usersTable.id, userId)).for("update");
        if (!conta || !conta.ativo) return { erro: erro(403, "conta_inativa", "Esta conta não pode fazer carregamentos.") };
        // Órfãos: pedidos que ficaram «a_criar» (o processo caiu entre gravar o pedido e falar com a kursiPay): fecham-se SEM crédito para não ocuparem a quota de pendentes.
        const orfaos = await tx.update(kursipayPagamentosTable).set({ estado: "failed", atualizadoEm: new Date() })
          .where(and(eq(kursipayPagamentosTable.userId, userId), eq(kursipayPagamentosTable.estado, "a_criar"), sql`${kursipayPagamentosTable.criadoEm} < now() - interval '5 minutes'`)).returning({ topupId: kursipayPagamentosTable.topupRequestId });
        if (orfaos.length) {
          await tx.update(topupRequestsTable).set({ status: "rejeitado", processadoEm: new Date(), notas: "kursiPay: pedido nunca chegou a ser criado na kursiPay; fechado sem crédito." })
            .where(and(inArray(topupRequestsTable.id, orfaos.map((o) => o.topupId)), eq(topupRequestsTable.status, "processando")));
          logger.warn({ codigo: "kursipay_orfaos_fechados", userId, n: orfaos.length }, "kursiPay: pedidos «a_criar» antigos fechados sem crédito");
        }
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(topupRequestsTable).where(and(eq(topupRequestsTable.userId, userId), inArray(topupRequestsTable.status, ["pendente", "processando"])));
        if (n >= MAX_PENDENTES) return { erro: erro(409, "pendentes_demais", `Já tens ${MAX_PENDENTES} pedidos de carregamento pendentes. Aguarda que sejam tratados.`) };
        const [igual] = await tx.select({ id: topupRequestsTable.id }).from(topupRequestsTable)
          .where(and(eq(topupRequestsTable.userId, userId), eq(topupRequestsTable.amount, kz.toFixed(2)), sql`${topupRequestsTable.status} <> 'rejeitado'`, sql`${topupRequestsTable.criadoEm} > now() - (${JANELA_REPETIDO_MS / 1000} * interval '1 second')`)).limit(1);
        if (igual) return { erro: erro(409, "pedido_repetido", "Já fizeste um pedido igual há poucos minutos. Aguarda que seja tratado.") };
        const [t] = await tx.insert(topupRequestsTable).values({ userId, amount: kz.toFixed(2), reference, status: "processando", paymentMethod: "kursipay" }).returning({ id: topupRequestsTable.id });
        const [p] = await tx.insert(kursipayPagamentosTable).values({ topupRequestId: t.id, userId, ambiente: cfg.ambiente, valorCentimos: centimos, moeda: "AOA", estado: "a_criar" }).returning({ id: kursipayPagamentosTable.id });
        return { topupId: t.id, reference, pagamentoId: p.id };
      });
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } } | null;
      if ((e?.code ?? e?.cause?.code) === "23505" && tentativa < 2) continue;   // colisão (raríssima) da referência: volta a tentar
      throw err;
    }
  }
  if (!criado) throw new Error("sem pedido");
  if ("erro" in criado) return criado.erro;
  const { topupId, reference } = criado;

  // 2. Chamada à kursiPay (fora da transação). Falha: o pedido fica rejeitado e o utilizador recebe uma mensagem clara.
  const falhar = async (codigo: string): Promise<void> => {
    await db.transaction(async (tx) => {
      await tx.update(topupRequestsTable).set({ status: "rejeitado", processadoEm: new Date(), notas: `kursiPay: criação do pagamento falhou (${codigo}).` }).where(and(eq(topupRequestsTable.id, topupId), eq(topupRequestsTable.status, "processando")));
      await tx.update(kursipayPagamentosTable).set({ estado: "failed", atualizadoEm: new Date() }).where(eq(kursipayPagamentosTable.topupRequestId, topupId));
    });
  };
  let pagamento;
  try {
    pagamento = await criarPagamento(cfg, { valorCentimos: centimos, referencia: reference, metodo, telefone });
  } catch (e) {
    const m = mensagemDeErro(e);
    const k = e instanceof KursipayErro ? e : null;
    // Motivo estruturado (códigos, estado HTTP da kursiPay e NOMES de campos; nunca chaves, cabeçalhos nem o corpo).
    logger[m.http >= 500 ? "error" : "warn"]({ codigo: "kursipay_criacao_falhou", topupId, motivo: k?.codigo ?? "desconhecido", httpKursipay: k?.http ?? 0, campos: k?.campos, httpResposta: m.http }, "kursiPay: criação do pagamento falhou");
    await falhar(k?.codigo ?? "erro");
    // A kursiPay respondeu com sucesso (2xx) mas não percebemos a resposta: o pagamento pode existir lá. Os admins são avisados; um payment.paid futuro vai para revisão manual.
    if (k?.codigo === "resposta_invalida" && k.http >= 200 && k.http < 300) await alertar(`kursiPay: a resposta à criação do pedido #${topupId} não pôde ser lida (campos: ${(k.campos ?? []).join(", ") || "?"}). O pagamento pode ter sido criado na kursiPay; o pedido ficou rejeitado e, se for pago, ficará em revisão manual.`, topupId);
    return { ok: false, erro: m };
  }
  // A resposta tem de coincidir com o que pedimos; senão não se manda o utilizador pagar.
  const url = metodo ? null : urlCheckout(pagamento.checkoutUrl, pagamento.id);
  const detalhes = metodo === "reference" ? detalhesReferencia(pagamento) : null;
  const divergencias = [
    pagamento.environment !== cfg.ambiente && "ambiente",
    pagamento.amount.amount !== centimos && "valor",
    pagamento.amount.currency !== "AOA" && "moeda",
    pagamento.externalReference !== reference && "referencia",
    !metodo && !url && "checkoutUrl",
    metodo !== undefined && typeof pagamento.method === "string" && pagamento.method !== metodo && "metodo",
    metodo === "reference" && !detalhes && "methodDetails",
  ].filter((x): x is string => typeof x === "string");
  if (divergencias.length) {
    logger.error({ codigo: "kursipay_criacao_falhou", topupId, motivo: "resposta_incoerente", campos: divergencias, formaCheckoutUrl: formaCheckoutUrl(pagamento.checkoutUrl), kursipayId: pagamento.id }, "kursiPay: a resposta à criação não coincide com o pedido");
    await falhar("resposta_incoerente");
    await alertar(`kursiPay: a resposta à criação do pedido #${topupId} não coincide com o pedido (${divergencias.join(", ")}). Pedido rejeitado; confirma no painel da kursiPay o pagamento ${pagamento.id}.`, topupId);
    return { ok: false, erro: mensagemDeErro(new Error("incoerente")) };
  }
  // A kursiPay JÁ criou o pagamento: se não o conseguirmos gravar, o pedido fecha-se sem crédito e os admins são avisados; um payment.paid futuro vai para revisão manual (não há id registado).
  try {
    await db.transaction(async (tx) => {
      const gravado = await tx.update(kursipayPagamentosTable).set({ kursipayId: pagamento.id, estado: "pending", checkoutUrl: url, atualizadoEm: new Date() })
        .where(and(eq(kursipayPagamentosTable.topupRequestId, topupId), sql`${kursipayPagamentosTable.kursipayId} IS NULL`)).returning({ id: kursipayPagamentosTable.id });
      if (gravado.length !== 1) throw new Error("nenhuma linha gravada");
      // Referência: os dados que o utilizador precisa para pagar ficam no pedido (external_ref), para o ecrã os voltar a mostrar sem nova chamada à kursiPay.
      if (detalhes) await tx.update(topupRequestsTable).set({ externalRef: detalhes }).where(eq(topupRequestsTable.id, topupId));
    });
  } catch (err) {
    logger.error({ codigo: "kursipay_criacao_falhou", topupId, motivo: "gravacao_falhou", kursipayId: pagamento.id, erro: erroSeguro(err) }, "kursiPay: o pagamento foi criado mas não foi possível gravá-lo");
    try { await falhar("gravacao_falhou"); } catch (e2) { logger.error({ codigo: "kursipay_fecho_falhou", topupId, erro: erroSeguro(e2) }, "kursiPay: não foi possível fechar o pedido órfão"); }
    await alertar(`kursiPay: o pagamento ${pagamento.id} foi criado na kursiPay mas não foi gravado (pedido #${topupId}). O pedido ficou rejeitado; se for pago, ficará em revisão manual (nunca é creditado automaticamente).`, topupId);
    return { ok: false, erro: mensagemDeErro(new KursipayErro("gravacao_falhou", 0)) };
  }
  return { ok: true, topupId, ambiente: cfg.ambiente, ...(metodo ? { metodo, ...(detalhes ? { referencia: detalhes } : {}) } : { checkoutUrl: url! }) };
}
