import { Router } from "express";
import { and, desc, eq, count, inArray } from "drizzle-orm";
import { db, menorCasesTable, usersTable, reportsTable, auditLogTable } from "@workspace/db";
import { requireAdmin, type AdminRequest } from "../middlewares/requireAdmin.js";
import { abrirCaso, confirmarCaso, naoConfirmarCaso, registarAutoridade, MenorErro } from "../lib/menores";
import { desligarSockets } from "../lib/suspensao";
import { erroSeguro } from "../lib/erroSeguro";

/**
 * Casos de menor (interno, só admin). Nada daqui aparece em rotas públicas, notificações ao utilizador ou logs: os logs levam
 * só o nome do erro. Cada acesso a um caso ou às provas fica no audit_log (`menor_caso_visto`, IP só na BD).
 */
const router = Router();

const ip = (req: AdminRequest) => (req.ip ?? "").slice(0, 45) || null;
const idDe = (req: AdminRequest): number | null => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };
const texto = (v: unknown, min: number, max: number): string | null => { if (typeof v !== "string") return null; const t = v.trim(); return t.length >= min && t.length <= max ? t : null; };

function responderErro(err: unknown, req: AdminRequest, res: import("express").Response, quando: string): void {
  if (err instanceof MenorErro) { res.status(err.httpStatus).json({ error: err.message, ...(err.codigo ? { codigo: err.codigo } : {}) }); return; }
  const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  if (code === "23505") { res.status(409).json({ error: "Já existe um caso ativo para esta conta." }); return; }
  (req as any).log?.error(erroSeguro(err), quando);
  res.status(500).json({ error: "Erro interno." });
}

router.get("/admin/menores", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  try {
    const { page = "1", limit = "20", estado } = req.query as Record<string, string>;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
    if (estado && !["aberto", "confirmado", "arquivado"].includes(estado)) return void res.status(400).json({ error: "Estado inválido." });
    const where = estado ? eq(menorCasesTable.estado, estado) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      db.select({
        id: menorCasesTable.id, userId: menorCasesTable.userId, username: usersTable.username, estado: menorCasesTable.estado,
        abertoEm: menorCasesTable.abertoEm, decisaoEm: menorCasesTable.decisaoEm, reportId: menorCasesTable.reportId,
        abertoPor: menorCasesTable.abertoPor, autoridade: menorCasesTable.autoridade,
      }).from(menorCasesTable).innerJoin(usersTable, eq(menorCasesTable.userId, usersTable.id))
        .where(where).orderBy(desc(menorCasesTable.abertoEm), desc(menorCasesTable.id)).limit(limitNum).offset((pageNum - 1) * limitNum),
      db.select({ total: count() }).from(menorCasesTable).where(where),
    ]);
    res.set("Cache-Control", "no-store");
    res.json({
      data: rows.map(({ autoridade, ...r }) => ({ ...r, autoridadeComunicada: autoridade !== null })),
      total: Number(total), page: pageNum, limit: limitNum,
    });
  } catch (err) { responderErro(err, req, res, "Erro ao listar casos"); }
});

/** Detalhe do caso. O acesso fica registado na MESMA transação: se o registo falhar, o caso não é devolvido. */
router.get("/admin/menores/:id", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = idDe(req); if (!id) return void res.status(400).json({ error: "ID inválido" });
  try {
    const out = await db.transaction(async (tx) => {
      const [c] = await tx.select().from(menorCasesTable).where(eq(menorCasesTable.id, id)).limit(1);
      if (!c) throw new MenorErro("Caso não encontrado.", 404);
      await tx.insert(auditLogTable).values({ adminId: req.adminId!, action: "menor_caso_visto", targetType: "menor_caso", targetId: id, details: { parte: "caso" }, ipAddress: ip(req) });
      const [u] = await tx.select({ id: usersTable.id, username: usersTable.username, ativo: usersTable.ativo, banidaEm: usersTable.banidaEm, encerradaEm: usersTable.encerradaEm }).from(usersTable).where(eq(usersTable.id, c.userId));
      const [r] = c.reportId ? await tx.select({ id: reportsTable.id, status: reportsTable.status }).from(reportsTable).where(eq(reportsTable.id, c.reportId)) : [];
      const nomes = new Map((await tx.select({ id: usersTable.id, username: usersTable.username }).from(usersTable)
        .where(inArray(usersTable.id, [c.abertoPor, ...(c.decisaoPor ? [c.decisaoPor] : []), ...(c.autoridadeRegistadaPor ? [c.autoridadeRegistadaPor] : [])]))).map((x) => [x.id, x.username]));
      const linha = await tx.select({ action: auditLogTable.action, adminId: auditLogTable.adminId, criadoEm: auditLogTable.criadoEm }).from(auditLogTable)
        .where(and(eq(auditLogTable.targetType, "menor_caso"), eq(auditLogTable.targetId, id))).orderBy(auditLogTable.criadoEm, auditLogTable.id);
      const { acessosPreservados, ...resto } = c;
      return {
        ...resto,
        acessosPreservadosTotal: Array.isArray(acessosPreservados) ? acessosPreservados.length : 0,
        conta: u ? { id: u.id, username: u.username, estado: u.banidaEm ? "banida" : u.encerradaEm ? "encerrada" : u.ativo ? "ativo" : "suspenso" } : null,
        denuncia: r ? { id: r.id, status: r.status } : null,
        abertoPorUsername: nomes.get(c.abertoPor) ?? null,
        decisaoPorUsername: c.decisaoPor ? nomes.get(c.decisaoPor) ?? null : null,
        autoridadeRegistadaPorUsername: c.autoridadeRegistadaPor ? nomes.get(c.autoridadeRegistadaPor) ?? null : null,
        linhaDoTempo: linha.map((l) => ({ acao: l.action, adminUsername: nomes.get(l.adminId) ?? null, em: l.criadoEm, adminId: l.adminId })),
      };
    });
    res.set("Cache-Control", "no-store");
    res.json(out);
  } catch (err) { responderErro(err, req, res, "Erro ao obter caso"); }
});

/** Cópia dos acessos (IP e user-agent das sessões). Dados pessoais: cada leitura fica no audit_log. */
router.get("/admin/menores/:id/acessos", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = idDe(req); if (!id) return void res.status(400).json({ error: "ID inválido" });
  try {
    const acessos = await db.transaction(async (tx) => {
      const [c] = await tx.select({ a: menorCasesTable.acessosPreservados }).from(menorCasesTable).where(eq(menorCasesTable.id, id)).limit(1);
      if (!c) throw new MenorErro("Caso não encontrado.", 404);
      await tx.insert(auditLogTable).values({ adminId: req.adminId!, action: "menor_caso_visto", targetType: "menor_caso", targetId: id, details: { parte: "acessos" }, ipAddress: ip(req) });
      return c.a;
    });
    res.set("Cache-Control", "no-store");
    res.json({ acessos });
  } catch (err) { responderErro(err, req, res, "Erro ao obter acessos do caso"); }
});

router.post("/admin/menores", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const userId = Number(req.body?.userId);
  const descricao = texto(req.body?.descricao, 10, 2000);
  const reportId = req.body?.reportId === undefined || req.body?.reportId === null ? null : Number(req.body.reportId);
  if (!Number.isInteger(userId) || userId <= 0) return void res.status(400).json({ error: "Conta inválida." });
  if (!descricao) return void res.status(400).json({ error: "Indica a descrição do caso (entre 10 e 2000 caracteres)." });
  if (reportId !== null && (!Number.isInteger(reportId) || reportId <= 0)) return void res.status(400).json({ error: "Denúncia inválida." });
  try {
    const r = await abrirCaso({ userId, adminId: req.adminId!, descricao, reportId, ip: ip(req) });
    desligarSockets(userId);
    res.status(201).json({ id: r.id });
  } catch (err) { responderErro(err, req, res, "Erro ao abrir caso"); }
});

router.post("/admin/menores/:id/confirmar", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = idDe(req); if (!id) return void res.status(400).json({ error: "ID inválido" });
  const motivo = texto(req.body?.motivo, 10, 500);
  if (!motivo) return void res.status(400).json({ error: "Indica o motivo da decisão (entre 10 e 500 caracteres)." });
  try {
    const r = await confirmarCaso({ casoId: id, adminId: req.adminId!, motivo, ip: ip(req) });
    desligarSockets(r.userId);
    res.json({ ok: true });
  } catch (err) { responderErro(err, req, res, "Erro ao confirmar caso"); }
});

router.post("/admin/menores/:id/arquivar", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = idDe(req); if (!id) return void res.status(400).json({ error: "ID inválido" });
  const motivo = texto(req.body?.motivo, 10, 500);
  if (!motivo) return void res.status(400).json({ error: "Indica o motivo da decisão (entre 10 e 500 caracteres)." });
  try {
    const r = await naoConfirmarCaso({ casoId: id, adminId: req.adminId!, motivo, ip: ip(req) });
    res.json({ ok: true, contaReativada: r.reativada });
  } catch (err) { responderErro(err, req, res, "Erro ao arquivar caso"); }
});

router.patch("/admin/menores/:id/autoridade", requireAdmin, async (req: AdminRequest, res): Promise<void> => {
  const id = idDe(req); if (!id) return void res.status(400).json({ error: "ID inválido" });
  const autoridade = texto(req.body?.autoridade, 3, 150);
  const referencia = req.body?.referencia === undefined || req.body?.referencia === null || req.body?.referencia === "" ? null : texto(req.body.referencia, 1, 100);
  const quando = typeof req.body?.comunicadaEm === "string" ? new Date(req.body.comunicadaEm) : null;
  if (!autoridade) return void res.status(400).json({ error: "Indica a autoridade (entre 3 e 150 caracteres)." });
  if (req.body?.referencia && referencia === null) return void res.status(400).json({ error: "A referência deve ter no máximo 100 caracteres." });
  if (!quando || Number.isNaN(quando.getTime())) return void res.status(400).json({ error: "Indica a data da comunicação." });
  if (quando.getTime() > Date.now() + 5 * 60 * 1000) return void res.status(400).json({ error: "A data da comunicação não pode estar no futuro." });
  try {
    await registarAutoridade({ casoId: id, adminId: req.adminId!, autoridade, comunicadaEm: quando, referencia, ip: ip(req) });
    res.json({ ok: true });
  } catch (err) { responderErro(err, req, res, "Erro ao registar a comunicação à autoridade"); }
});

export default router;
