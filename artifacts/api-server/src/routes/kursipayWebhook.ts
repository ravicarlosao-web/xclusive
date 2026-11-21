/**
 * Webhook da kursiPay: POST /api/webhooks/kursipay (registado em app.ts com o corpo CRU, antes de qualquer express.json, com limite de corpo pequeno).
 *
 *  a) assinatura KursiPay-Signature verificada de forma rígida (lib/kursipay.ts) → senão 400 sem detalhes;   b) envelope validado com um esquema;
 *  c) evento de OUTRO ambiente (data.object.environment ≠ ambiente da chave) → 400 e alerta aos administradores;
 *  d) deduplicação pelo id do evento NA MESMA transação que o processamento (nunca se regista o id e se processa depois); 200 só depois do commit;
 *  e) payment.paid NUNCA credita pelo payload: confirma com GET /v1/payments/:id (chave secreta) o estado, valor, moeda, referência e ambiente contra o NOSSO registo; se o GET falhar, 5xx
 *     (a kursiPay reenvia) e o evento NÃO fica marcado como processado;   f) crédito numa transação com a linha do pedido bloqueada, uma só vez, com auditoria antes/depois e notificação;
 *  g) valor/moeda/referência diferentes, pedido desconhecido, conta inativa ou conta fora da lista de sandbox: NÃO credita, marca para revisão, alerta os administradores, 200;
 *  h) payment.paid depois de o pedido estar expirado/falhado é creditado (o dinheiro entrou);   i) payment.failed e payment.expired marcam o pedido sem mexer no saldo;
 *  j) payment.refunded: NUNCA mexe no saldo (não fazemos reembolsos: é anómalo), regista e alerta os superadmins;   k) payment.created e payout.*: regista e ignora.
 * O interruptor topup_kursipay_ativo controla só a CRIAÇÃO de pagamentos: o webhook processa sempre os pagamentos já existentes. Sem limitador por IP (os IPs de origem não são públicos).
 * Nunca se regista o corpo, os cabeçalhos nem segredos: só ids de evento/pagamento/pedido, o tipo e o resultado.
 */
import type { Request, Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, usersTable, topupRequestsTable, kursipayPagamentosTable, kursipayEventosTable, auditLogTable, notificationsTable } from "@workspace/db";
import { EnvelopeSchema, KursipayErro, lerConfigKursipay, obterPagamento, verificarAssinatura, type ConfigKursipay, type PagamentoKursipay } from "../lib/kursipay";
import { creditarCarregamento } from "../lib/creditarCarregamento";
import { lerSettingsKursipay } from "../lib/kursipayServico";
import { notificarAdmins, notificarSistema } from "../lib/takedown";
import { erroSeguro } from "../lib/erroSeguro";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const kz = (v: number) => `${v.toLocaleString("pt-PT")} Kz`;
/** Pedidos que ainda podem ser creditados: em curso, ou já dados como rejeitados (expirado/falhado) quando o dinheiro afinal entrou. */
const CREDITAVEIS = ["processando", "rejeitado"];

async function alertarSuperadmins(tx: Tx, mensagem: string, alvoId: number): Promise<void> {
  const sa = await tx.select({ id: usersTable.id }).from(usersTable).where(and(eq(usersTable.role, "superadmin"), eq(usersTable.ativo, true)));
  if (sa.length) await tx.insert(notificationsTable).values(sa.map((a) => ({ destinatarioId: a.id, tipo: "sistema" as const, alvoId, mensagem: mensagem.slice(0, 1000) })));
}

/** Regista o evento (chave única). false = já estava registado (duplicado). */
async function registarEvento(tx: Tx, ev: { id: string; type: string }, pagamentoId: string | null, ambiente: string | null, resultado: string): Promise<boolean> {
  const r = await tx.insert(kursipayEventosTable).values({ eventoId: ev.id, tipo: ev.type.slice(0, 40), kursipayPagamentoId: pagamentoId, ambiente, resultado })
    .onConflictDoNothing().returning({ id: kursipayEventosTable.eventoId });
  return r.length === 1;
}

type Linha = { id: number; topupRequestId: number; userId: number; kursipayId: string | null; ambiente: string; valorCentimos: number; moeda: string; estado: string; reference: string };
async function procurarRegisto(tx: Tx, payId: string, externalReference?: string | null): Promise<Linha | null> {
  const base = () => tx.select({ id: kursipayPagamentosTable.id, topupRequestId: kursipayPagamentosTable.topupRequestId, userId: kursipayPagamentosTable.userId, kursipayId: kursipayPagamentosTable.kursipayId, ambiente: kursipayPagamentosTable.ambiente, valorCentimos: kursipayPagamentosTable.valorCentimos, moeda: kursipayPagamentosTable.moeda, estado: kursipayPagamentosTable.estado, reference: topupRequestsTable.reference })
    .from(kursipayPagamentosTable).innerJoin(topupRequestsTable, eq(topupRequestsTable.id, kursipayPagamentosTable.topupRequestId));
  const [porId] = await base().where(eq(kursipayPagamentosTable.kursipayId, payId)).limit(1);
  if (porId) return porId;
  // O webhook pode chegar antes de guardarmos o id (a criação ainda em curso ou que falhou depois de a kursiPay a ter criado): encontra-se pela referência do nosso pedido.
  if (typeof externalReference === "string" && /^XCL-[A-Z0-9]{8}$/.test(externalReference)) {
    const [porRef] = await base().where(and(eq(topupRequestsTable.reference, externalReference), eq(topupRequestsTable.paymentMethod, "kursipay"), sql`${kursipayPagamentosTable.kursipayId} IS NULL`)).limit(1);
    if (porRef) return porRef;
  }
  return null;
}

export async function kursipayWebhookHandler(req: Request, res: Response): Promise<void> {
  const cfg = lerConfigKursipay();
  if (!cfg) { req.log?.error({ codigo: "kursipay_config" }, "kursiPay webhook recusado: configuração em falta ou inválida."); res.status(503).json({ error: "Webhook não configurado." }); return; }
  const rejeitar = (motivo: string) => { req.log?.warn({ codigo: "kursipay_webhook_recusado", motivo }, "kursiPay webhook recusado"); res.status(400).json({ error: "Pedido inválido." }); };

  // a) assinatura sobre o corpo CRU (sem corpo cru não há assinatura possível)
  const raw: unknown = req.body;
  if (!Buffer.isBuffer(raw) || raw.length === 0) return rejeitar("corpo");
  if (!verificarAssinatura(raw, req.headers["kursipay-signature"], cfg.segredoWebhook)) return rejeitar("assinatura");

  // b) envelope
  let json: unknown; try { json = JSON.parse(raw.toString("utf8")); } catch { return rejeitar("json"); }
  const parsed = EnvelopeSchema.safeParse(json); if (!parsed.success) return rejeitar("envelope");
  const ev = parsed.data; const obj = ev.data.object;

  // c) ambiente incoerente (nos dois sentidos): nunca se processa; alerta
  if (obj.environment !== undefined && obj.environment !== cfg.ambiente) {
    req.log?.warn({ codigo: "kursipay_ambiente_incoerente" }, "kursiPay webhook: evento de outro ambiente recusado");
    try { await db.transaction(async (tx) => { await notificarAdmins(tx, `kursiPay: recebido um evento do ambiente «${obj.environment}» (o servidor está em «${cfg.ambiente}»). Foi recusado e não creditou nada. Confirma a configuração do webhook na kursiPay.`, 0); }); } catch { /* sem alerta, a recusa mantém-se */ }
    res.status(400).json({ error: "Pedido inválido." }); return;
  }

  try {
    // Duplicado já processado: 200 sem trabalho (a deduplicação final é a da transação).
    const [dup] = await db.select({ id: kursipayEventosTable.eventoId }).from(kursipayEventosTable).where(eq(kursipayEventosTable.eventoId, ev.id)).limit(1);
    if (dup) { res.status(200).json({ received: true, duplicado: true }); return; }

    const tipo = ev.type;
    if (tipo === "payment.paid") { await processarPago(req, res, cfg, ev, obj.id); return; }

    const resultado = await db.transaction(async (tx) => {
      const pagId = tipo.startsWith("payment.") ? obj.id : null;
      if (!(await registarEvento(tx, ev, pagId, obj.environment ?? null, "processado"))) return "duplicado";
      if (tipo === "payment.created" || tipo.startsWith("payout.") || !["payment.failed", "payment.expired", "payment.refunded"].includes(tipo)) {
        await tx.update(kursipayEventosTable).set({ resultado: tipo === "payment.created" ? "ignorado_created" : tipo.startsWith("payout.") ? "ignorado_payout" : "ignorado_tipo" }).where(eq(kursipayEventosTable.eventoId, ev.id));
        return "ignorado";
      }
      const extRef = typeof obj.externalReference === "string" ? obj.externalReference : null;
      const reg = await procurarRegisto(tx, obj.id, extRef);
      if (tipo === "payment.refunded") {
        // NUNCA mexe no saldo: não fazemos reembolsos, por isso é anómalo. Regista e alerta os superadmins.
        if (reg) await tx.update(kursipayPagamentosTable).set({ estado: "refunded", atualizadoEm: new Date() }).where(eq(kursipayPagamentosTable.id, reg.id));
        await alertarSuperadmins(tx, `kursiPay: o pagamento ${obj.id}${reg ? ` (carregamento #${reg.topupRequestId})` : " (desconhecido)"} foi REEMBOLSADO na kursiPay. Nós não fazemos reembolsos: é anómalo. O saldo NÃO foi alterado; verifica o que se passou.`, reg?.topupRequestId ?? 0);
        await tx.update(kursipayEventosTable).set({ resultado: "refunded_alerta" }).where(eq(kursipayEventosTable.eventoId, ev.id));
        return "refunded";
      }
      // failed / expired: marca o pedido, sem mexer no saldo (e nunca desfaz um carregamento já creditado)
      if (!reg) { await tx.update(kursipayEventosTable).set({ resultado: "desconhecido" }).where(eq(kursipayEventosTable.eventoId, ev.id)); return "desconhecido"; }
      const novo = tipo === "payment.failed" ? "failed" : "expired";
      await tx.select({ id: topupRequestsTable.id }).from(topupRequestsTable).where(eq(topupRequestsTable.id, reg.topupRequestId)).for("update");
      await tx.update(topupRequestsTable).set({ status: "rejeitado", processadoEm: new Date(), notas: `kursiPay: pagamento ${novo === "failed" ? "recusado" : "expirado"}.` }).where(and(eq(topupRequestsTable.id, reg.topupRequestId), eq(topupRequestsTable.status, "processando")));
      await tx.update(kursipayPagamentosTable).set({ estado: novo, atualizadoEm: new Date() }).where(and(eq(kursipayPagamentosTable.id, reg.id), sql`${kursipayPagamentosTable.estado} <> 'paid'`));
      return novo;
    });
    req.log?.info({ evento: ev.id, tipo, resultado }, "kursiPay webhook");
    res.status(200).json({ received: true });
  } catch (err) {
    req.log?.error(erroSeguro(err), "kursiPay webhook: erro interno ao processar");
    res.status(500).json({ error: "Erro interno." });   // a kursiPay reenvia; nada ficou marcado (transação revertida)
  }
}

async function processarPago(req: Request, res: Response, cfg: ConfigKursipay, ev: { id: string; type: string }, payId: string): Promise<void> {
  // e) confirmação autoritativa. Falha (rede, 5xx, id inexistente…) → 5xx e o evento NÃO fica registado: a kursiPay reenvia.
  let conf: PagamentoKursipay;
  try { conf = await obterPagamento(cfg, payId); }
  catch (e) { const k = e instanceof KursipayErro ? e : null; req.log?.warn({ codigo: "kursipay_confirmacao_falhou", evento: ev.id, motivo: k?.codigo ?? "desconhecido", httpKursipay: k?.http ?? 0, campos: k?.campos }, "kursiPay webhook: não foi possível confirmar o pagamento: nada processado"); res.status(502).json({ error: "Não foi possível confirmar o pagamento." }); return; }
  if (conf.id !== payId) { req.log?.warn({ codigo: "kursipay_confirmacao_incoerente", evento: ev.id, motivo: "id_diferente" }, "kursiPay webhook: confirmação de outro pagamento"); res.status(502).json({ error: "Confirmação inválida." }); return; }
  if (conf.status !== "paid") { req.log?.warn({ codigo: "kursipay_nao_pago", evento: ev.id }, "kursiPay webhook: o payload diz «paid» mas a kursiPay não confirma: sem crédito"); res.status(409).json({ error: "Pagamento ainda não confirmado." }); return; }

  const settings = await lerSettingsKursipay();
  const resultado = await db.transaction(async (tx) => {
    // d) deduplicação NA MESMA transação que o crédito
    if (!(await registarEvento(tx, ev, payId, conf.environment, "processado"))) return { r: "duplicado" as const };
    const fechar = async (r: string) => { await tx.update(kursipayEventosTable).set({ resultado: r }).where(eq(kursipayEventosTable.eventoId, ev.id)); };
    const reg = await procurarRegisto(tx, payId, conf.externalReference ?? null);

    // g) casos em que NÃO se credita (revisão + alerta aos administradores; resposta 200)
    const revisao = async (motivo: string, regRev: Linha | null): Promise<{ r: string }> => {
      if (regRev) {
        await tx.update(topupRequestsTable).set({ status: "revisao_manual", processadoEm: new Date(), notas: `kursiPay: pagamento confirmado mas NÃO creditado (${motivo}). Tratar manualmente.` }).where(and(eq(topupRequestsTable.id, regRev.topupRequestId), inArray(topupRequestsTable.status, [...CREDITAVEIS, "revisao_manual"])));
        await tx.update(kursipayPagamentosTable).set({ estado: "revisao", kursipayId: regRev.kursipayId ?? payId, atualizadoEm: new Date() }).where(eq(kursipayPagamentosTable.id, regRev.id));
      }
      await notificarAdmins(tx, `kursiPay: pagamento ${payId} confirmado mas NÃO creditado (${motivo})${regRev ? ` — carregamento #${regRev.topupRequestId}` : ""}. Precisa de revisão manual.`, regRev?.topupRequestId ?? 0);
      await fechar(`revisao_${motivo}`.slice(0, 30));
      return { r: "revisao" };
    };
    if (!reg) return revisao("pedido_desconhecido", null);
    // Sem id da kursiPay gravado no nosso registo (ex.: o pagamento foi criado mas a gravação falhou): NUNCA se credita automaticamente; fica em revisão manual, com o id agora ligado.
    if (reg.kursipayId === null) return revisao("sem_id_registado", reg);
    if (conf.amount.currency !== "AOA" || reg.moeda !== "AOA") return revisao("moeda_diferente", reg);
    if (conf.amount.amount !== reg.valorCentimos) return revisao("valor_diferente", reg);
    if (conf.externalReference !== reg.reference) return revisao("referencia_diferente", reg);
    if (conf.environment !== cfg.ambiente || reg.ambiente !== cfg.ambiente) return revisao("ambiente_diferente", reg);
    // Proteção do sandbox: um pagamento de teste só credita contas da lista (nunca saldo real a um utilizador comum).
    if (cfg.ambiente === "sandbox" && !settings.sandboxIds.includes(reg.userId)) return revisao("sandbox_fora_da_lista", reg);

    const topupId = reg.topupRequestId;
    const credito = await creditarCarregamento(tx, { topupId, estadosEmCurso: CREDITAVEIS,
      notaCreditado: `Creditado automaticamente via kursiPay${cfg.ambiente === "sandbox" ? " (SANDBOX)" : ""} (estado confirmado na kursiPay).`,
      notaContaInativa: "Pagamento confirmado na kursiPay, mas a conta está inativa: NÃO creditado. Tratar manualmente." });
    if (credito.estado === "ja_processado") { await fechar("ja_processado"); return { r: "ja_processado" as const }; }
    await tx.update(kursipayPagamentosTable).set({ estado: credito.estado === "creditado" ? "paid" : "revisao", kursipayId: reg.kursipayId ?? payId, pagoEm: new Date(), atualizadoEm: new Date() }).where(eq(kursipayPagamentosTable.id, reg.id));
    if (credito.estado === "revisao_manual") {
      await notificarAdmins(tx, `kursiPay: pagamento ${payId} confirmado mas a conta do carregamento #${topupId} está inativa: NÃO creditado. Precisa de revisão manual.`, topupId);
      await fechar("revisao_conta_inativa"); return { r: "revisao" as const };
    }
    // f) auditoria (antes/depois; o crédito de sandbox fica marcado como tal) e notificação, na MESMA transação
    await tx.insert(auditLogTable).values({ adminId: credito.userId, action: "kursipay_creditado", targetType: "topup", targetId: topupId,
      details: { before: { saldo: credito.saldoAntes }, after: { saldo: credito.saldoDepois }, valor: credito.valor, ambiente: cfg.ambiente, sandbox: cfg.ambiente === "sandbox", kursipayId: payId, evento: ev.id } });
    await notificarSistema(tx, credito.userId, `O teu carregamento de ${kz(credito.valor)} foi creditado. O saldo já está na tua carteira.`);
    await fechar("creditado");
    return { r: "creditado" as const };
  });
  req.log?.info({ evento: ev.id, tipo: ev.type, resultado: resultado.r }, "kursiPay webhook");
  res.status(200).json({ received: true, ...(resultado.r === "duplicado" ? { duplicado: true } : {}) });
}
