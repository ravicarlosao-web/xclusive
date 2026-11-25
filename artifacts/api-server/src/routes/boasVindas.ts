import { Router } from "express";
import { requireAuth, requireCreator, type AuthRequest } from "../lib/auth";
import { lerConfigBoasVindas, guardarConfigBoasVindas, definirAtivaBoasVindas, apagarConfigBoasVindas, boasVindasLigadas, BoasVindasErro } from "../lib/boasVindas";
import { erroSeguro } from "../lib/erroSeguro";

/**
 * Mensagem de boas-vindas da criadora (só criadoras VERIFICADAS: requireCreator devolve 403 às restantes).
 *   GET    /api/creator/boas-vindas          → configuração atual
 *   PUT    /api/creator/boas-vindas          → guarda { texto?, midiaTipo?: "nenhuma"|"imagem", midiaUrl?, ativa? }
 *   PATCH  /api/creator/boas-vindas/ativa    → { ativa: boolean }
 *   DELETE /api/creator/boas-vindas          → apaga
 * Edições só valem para NOVOS seguidores. Ver lib/boasVindas.ts.
 */
const router = Router();

/** Acrescenta o estado do interruptor geral da plataforma (só para a UI avisar; a criadora guarda na mesma). */
async function comPlataforma<T extends object>(cfg: T): Promise<T & { plataformaAtiva: boolean }> {
  return { ...cfg, plataformaAtiva: await boasVindasLigadas() };
}

function responderErro(req: AuthRequest, res: any, err: unknown, acao: string): void {
  if (err instanceof BoasVindasErro) { res.status(err.httpStatus).json({ error: err.message, ...(err.codigo ? { codigo: err.codigo } : {}) }); return; }
  (req as any).log?.error(erroSeguro(err), `Erro ao ${acao} a mensagem de boas-vindas`);
  res.status(500).json({ error: "Erro interno." });
}

router.get("/creator/boas-vindas", requireAuth, requireCreator, async (req: AuthRequest, res): Promise<void> => {
  try { res.setHeader("Cache-Control", "no-store"); res.json(await comPlataforma(await lerConfigBoasVindas(req.userId!))); } catch (err) { responderErro(req, res, err, "ler"); }
});

router.put("/creator/boas-vindas", requireAuth, requireCreator, async (req: AuthRequest, res): Promise<void> => {
  try { res.setHeader("Cache-Control", "no-store"); res.json(await comPlataforma(await guardarConfigBoasVindas(req.userId!, req.body ?? {}))); } catch (err) { responderErro(req, res, err, "guardar"); }
});

router.patch("/creator/boas-vindas/ativa", requireAuth, requireCreator, async (req: AuthRequest, res): Promise<void> => {
  try {
    if (typeof req.body?.ativa !== "boolean") { res.status(400).json({ error: "O campo «ativa» tem de ser verdadeiro ou falso.", codigo: "ativa_invalida" }); return; }
    res.setHeader("Cache-Control", "no-store"); res.json(await comPlataforma(await definirAtivaBoasVindas(req.userId!, req.body.ativa)));
  } catch (err) { responderErro(req, res, err, "ativar/desativar"); }
});

router.delete("/creator/boas-vindas", requireAuth, requireCreator, async (req: AuthRequest, res): Promise<void> => {
  try { await apagarConfigBoasVindas(req.userId!); res.json({ ok: true }); } catch (err) { responderErro(req, res, err, "apagar"); }
});

export default router;
