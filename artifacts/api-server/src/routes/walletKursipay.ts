/**
 * Carregamento de saldo pela kursiPay (rotas autenticadas, em /api/wallet):
 *   GET  /wallet/topup/kursipay/config   se a opção «Pagar online» está disponível para ESTA conta (chave ligada e elegível) e os limites
 *   POST /wallet/topup/kursipay          cria o pedido interno e o pagamento; devolve o URL absoluto do checkout
 *   GET  /wallet/topup/kursipay/:id      estado do pedido (do próprio utilizador), para o ecrã consultar enquanto está aberto
 * Sem KURSIPAY_SECRET_KEY / KURSIPAY_WEBHOOK_SECRET válidas respondem 503 (o resto da API funciona). Nada aqui imprime chaves.
 */
import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, topupRequestsTable, kursipayPagamentosTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../lib/auth";
import { lerConfigKursipay } from "../lib/kursipay";
import { criarCarregamentoKursipay, elegivel, elegivelDireto, elegivelHospedado, lerSettingsKursipay, type ResultadoCriar } from "../lib/kursipayServico";
import { VALOR_MIN } from "../lib/carregamento";
import { erroSeguro } from "../lib/erroSeguro";

const router = Router();
const INDISPONIVEL = { error: "O pagamento online não está disponível de momento. Usa a transferência bancária.", codigo: "servico_indisponivel" };

router.get("/wallet/topup/kursipay/config", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const cfg = lerConfigKursipay(); const s = await lerSettingsKursipay();
    const ativo = !!cfg && elegivel(s, cfg, req.userId!);
    const direto = !!cfg && elegivelDireto(s, cfg, req.userId!);   // cobrança direta: precisa também da chave kursipay_direto_ativo (em produção e em sandbox); NÃO depende da do hospedado
    const hospedado = !!cfg && elegivelHospedado(s, cfg, req.userId!);   // «Pagar online»: chave própria kursipay_hospedado_ativo (ausente = desligado)
    res.json({ ativo, hospedado, direto, ...(ativo ? { valorMin: VALOR_MIN, valorMax: s.valorMaxKz } : {}) });
  } catch (err) { req.log?.error(erroSeguro(err), "kursiPay: erro ao ler a configuração"); res.status(500).json({ error: "Erro ao obter a configuração." }); }
});

/** Responde a um resultado de criação (hospedado ou direto). Nunca devolve o telefone: no Express só o topupId. */
function responder(res: import("express").Response, r: ResultadoCriar): void {
  if (!r.ok) {
    if (r.erro.retryAfterS) res.setHeader("Retry-After", String(r.erro.retryAfterS));
    res.status(r.erro.http).json({ error: r.erro.mensagem, codigo: r.erro.codigo });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  if (r.metodo === "reference" && r.referencia) { res.status(201).json({ ok: true, topupId: r.topupId, metodo: r.metodo, entidade: r.referencia.entity, referencia: r.referencia.reference, valor: r.valor, validaAte: r.referencia.dueAt }); return; }
  if (r.metodo) { res.status(201).json({ ok: true, topupId: r.topupId, metodo: r.metodo }); return; }
  res.status(201).json({ ok: true, topupId: r.topupId, checkoutUrl: r.checkoutUrl });
}

// Checkout hospedado («Pagar online»): a kursiPay mostra a página de pagamento. A cobrança direta tem endpoints próprios (abaixo); aqui `method` não existe.
router.post("/wallet/topup/kursipay", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const cfg = lerConfigKursipay();
  if (!cfg) { res.status(503).json(INDISPONIVEL); return; }
  if (req.body?.method !== undefined) { res.status(400).json({ error: "Método de pagamento inválido.", codigo: "metodo_invalido" }); return; }
  try { responder(res, await criarCarregamentoKursipay(cfg, req.userId!, req.body?.amount)); }
  catch (err) {
    req.log?.error(erroSeguro(err), "kursiPay: erro ao criar o carregamento");
    res.status(500).json({ error: "Erro ao criar o pedido de carregamento." });
  }
});

// Cobrança DIRETA (sem sair do site). Express: {valor, telefone}; Referência: {valor}. Corpos e erros nunca incluem o telefone.
router.post("/wallet/topup/kursipay/express", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const cfg = lerConfigKursipay();
  if (!cfg) { res.status(503).json(INDISPONIVEL); return; }
  try { responder(res, await criarCarregamentoKursipay(cfg, req.userId!, req.body?.valor, { metodo: "multicaixa_express", telefone: req.body?.telefone })); }
  catch (err) { req.log?.error(erroSeguro(err), "kursiPay: erro ao criar o pagamento Express"); res.status(500).json({ error: "Erro ao criar o pedido de carregamento." }); }
});
router.post("/wallet/topup/kursipay/referencia", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const cfg = lerConfigKursipay();
  if (!cfg) { res.status(503).json(INDISPONIVEL); return; }
  try { responder(res, await criarCarregamentoKursipay(cfg, req.userId!, req.body?.valor, { metodo: "reference" })); }
  catch (err) { req.log?.error(erroSeguro(err), "kursiPay: erro ao criar a referência"); res.status(500).json({ error: "Erro ao criar o pedido de carregamento." }); }
});

/** Estado do pedido (só o dono): para o pop-up consultar de ~3 em 3 s. `resultado`: pago | recusado | pendente | revisao. */
router.get("/wallet/topup/kursipay/:id/estado", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "ID inválido." }); return; }
  try {
    const [r] = await db.select({ id: topupRequestsTable.id, status: topupRequestsTable.status, amount: topupRequestsTable.amount, estado: kursipayPagamentosTable.estado, modo: kursipayPagamentosTable.modo, metodo: kursipayPagamentosTable.metodo,
      entidade: kursipayPagamentosTable.entidade, referencia: kursipayPagamentosTable.referencia, validaAte: kursipayPagamentosTable.validaAte, telefoneMascarado: kursipayPagamentosTable.telefoneMascarado })
      .from(topupRequestsTable).innerJoin(kursipayPagamentosTable, eq(kursipayPagamentosTable.topupRequestId, topupRequestsTable.id))
      .where(and(eq(topupRequestsTable.id, id), eq(topupRequestsTable.userId, req.userId!))).limit(1);
    if (!r) { res.status(404).json({ error: "Pedido não encontrado." }); return; }
    const resultado = r.status === "aprovado" ? "pago" : r.status === "rejeitado" ? "recusado" : r.status === "revisao_manual" ? "revisao" : "pendente";
    res.setHeader("Cache-Control", "no-store");
    res.json({ id: r.id, status: r.status, resultado, pagamento: r.estado, modo: r.modo, metodo: r.metodo, valor: Number(r.amount),
      ...(r.metodo === "reference" && r.entidade && r.referencia ? { referencia: { entidade: r.entidade, referencia: r.referencia, validaAte: r.validaAte ? r.validaAte.toISOString() : null } } : {}),
      ...(r.metodo === "multicaixa_express" && r.telefoneMascarado ? { telefoneMascarado: r.telefoneMascarado } : {}) });
  } catch (err) { req.log?.error(erroSeguro(err), "kursiPay: erro ao ler o estado"); res.status(500).json({ error: "Erro ao obter o estado do pedido." }); }
});

router.get("/wallet/topup/kursipay/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "ID inválido." }); return; }
  try {
    const [r] = await db.select({ id: topupRequestsTable.id, status: topupRequestsTable.status, amount: topupRequestsTable.amount, estado: kursipayPagamentosTable.estado, externalRef: topupRequestsTable.externalRef })
      .from(topupRequestsTable).innerJoin(kursipayPagamentosTable, eq(kursipayPagamentosTable.topupRequestId, topupRequestsTable.id))
      .where(and(eq(topupRequestsTable.id, id), eq(topupRequestsTable.userId, req.userId!))).limit(1);
    if (!r) { res.status(404).json({ error: "Pedido não encontrado." }); return; }
    res.setHeader("Cache-Control", "no-store");
    const ref = r.externalRef as { entity?: unknown; reference?: unknown; dueAt?: unknown } | null;
    res.json({ id: r.id, status: r.status, amount: Number(r.amount), pagamento: r.estado, ...(ref && typeof ref.entity === "string" && typeof ref.reference === "string" ? { referencia: { entity: ref.entity, reference: ref.reference, dueAt: typeof ref.dueAt === "string" ? ref.dueAt : null } } : {}) });
  } catch (err) { req.log?.error(erroSeguro(err), "kursiPay: erro ao ler o estado"); res.status(500).json({ error: "Erro ao obter o estado do pedido." }); }
});

export default router;
