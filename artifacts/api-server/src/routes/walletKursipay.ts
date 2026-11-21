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
import { criarCarregamentoKursipay, elegivel, lerSettingsKursipay } from "../lib/kursipayServico";
import { VALOR_MIN } from "../lib/carregamento";
import { erroSeguro } from "../lib/erroSeguro";

const router = Router();
const INDISPONIVEL = { error: "O pagamento online não está disponível de momento. Usa a transferência bancária.", codigo: "servico_indisponivel" };

router.get("/wallet/topup/kursipay/config", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const cfg = lerConfigKursipay(); const s = await lerSettingsKursipay();
    const ativo = !!cfg && elegivel(s, cfg, req.userId!);
    res.json({ ativo, ...(ativo ? { valorMin: VALOR_MIN, valorMax: s.valorMaxKz } : {}) });
  } catch (err) { req.log?.error(erroSeguro(err), "kursiPay: erro ao ler a configuração"); res.status(500).json({ error: "Erro ao obter a configuração." }); }
});

router.post("/wallet/topup/kursipay", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const cfg = lerConfigKursipay();
  if (!cfg) { res.status(503).json(INDISPONIVEL); return; }
  try {
    const r = await criarCarregamentoKursipay(cfg, req.userId!, req.body?.amount);
    if (!r.ok) {
      if (r.erro.retryAfterS) res.setHeader("Retry-After", String(r.erro.retryAfterS));
      res.status(r.erro.http).json({ error: r.erro.mensagem, codigo: r.erro.codigo });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({ ok: true, topupId: r.topupId, checkoutUrl: r.checkoutUrl });
  } catch (err) {
    req.log?.error(erroSeguro(err), "kursiPay: erro ao criar o carregamento");
    res.status(500).json({ error: "Erro ao criar o pedido de carregamento." });
  }
});

router.get("/wallet/topup/kursipay/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "ID inválido." }); return; }
  try {
    const [r] = await db.select({ id: topupRequestsTable.id, status: topupRequestsTable.status, amount: topupRequestsTable.amount, estado: kursipayPagamentosTable.estado })
      .from(topupRequestsTable).innerJoin(kursipayPagamentosTable, eq(kursipayPagamentosTable.topupRequestId, topupRequestsTable.id))
      .where(and(eq(topupRequestsTable.id, id), eq(topupRequestsTable.userId, req.userId!))).limit(1);
    if (!r) { res.status(404).json({ error: "Pedido não encontrado." }); return; }
    res.setHeader("Cache-Control", "no-store");
    res.json({ id: r.id, status: r.status, amount: Number(r.amount), pagamento: r.estado });
  } catch (err) { req.log?.error(erroSeguro(err), "kursiPay: erro ao ler o estado"); res.status(500).json({ error: "Erro ao obter o estado do pedido." }); }
});

export default router;
