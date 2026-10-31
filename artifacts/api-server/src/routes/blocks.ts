import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, usersTable, userBlocksTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../lib/auth";
import { urlMedia } from "../lib/storage";
import { erroSeguro } from "../lib/erroSeguro";

/**
 * Bloqueios entre utilizadores. Afetam SÓ mensagens e novas conversas (ver lib/permissaoMensagem.ts): não mexem em seguir,
 * comentários, lives, subscrições nem gorjetas, e o perfil do bloqueado continua visível. Bloquear NÃO cancela subscrições.
 *  - POST   /users/:username/block   idempotente; recusa bloquear-se a si próprio e contas de administração
 *  - DELETE /users/:username/block   idempotente
 *  - GET    /users/me/blocks         paginado (mais recentes primeiro)
 */
const router = Router();

const ROLES_ADMIN = ["admin", "superadmin"];
const LIMITE_MAX = 50;

const limiteBloqueios = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "Demasiados pedidos de bloqueio. Tenta novamente dentro de 1 minuto." },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ((req as AuthRequest).userId ? `bloq:${(req as AuthRequest).userId}` : ipKeyGenerator(req.ip ?? "")),
});

const usernameDe = (req: AuthRequest): string => {
  const raw = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  return String(raw ?? "").toLowerCase();
};

async function alvoPorUsername(username: string) {
  const [alvo] = await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable).where(eq(usersTable.username, username)).limit(1);
  return alvo ?? null;
}

router.post("/users/:username/block", requireAuth, limiteBloqueios, async (req: AuthRequest, res): Promise<void> => {
  try {
    const userId = req.userId!;
    const alvo = await alvoPorUsername(usernameDe(req));
    if (!alvo) { res.status(404).json({ error: "Utilizador não encontrado" }); return; }
    if (alvo.id === userId) { res.status(400).json({ error: "Não podes bloquear a tua própria conta." }); return; }
    const [eu] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    // Contas de administração nem bloqueiam nem são bloqueadas (ignoram o bloqueio: lib/permissaoMensagem.ts)
    if (ROLES_ADMIN.includes(alvo.role) || (eu && ROLES_ADMIN.includes(eu.role))) {
      res.status(403).json({ error: "Esta conta não pode ser bloqueada." });
      return;
    }
    await db.insert(userBlocksTable).values({ blockerId: userId, blockedId: alvo.id }).onConflictDoNothing();
    res.json({ ok: true, bloqueado: true });
  } catch (err) {
    req.log?.error(erroSeguro(err), "Erro ao bloquear utilizador");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.delete("/users/:username/block", requireAuth, limiteBloqueios, async (req: AuthRequest, res): Promise<void> => {
  try {
    const alvo = await alvoPorUsername(usernameDe(req));
    if (!alvo) { res.status(404).json({ error: "Utilizador não encontrado" }); return; }
    await db.delete(userBlocksTable).where(and(eq(userBlocksTable.blockerId, req.userId!), eq(userBlocksTable.blockedId, alvo.id)));
    res.json({ ok: true, bloqueado: false });
  } catch (err) {
    req.log?.error(erroSeguro(err), "Erro ao desbloquear utilizador");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.get("/users/me/blocks", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const userId = req.userId!;
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limit = Math.min(LIMITE_MAX, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));
    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(userBlocksTable).where(eq(userBlocksTable.blockerId, userId));
    const rows = await db.select({ u: usersTable })
      .from(userBlocksTable)
      .innerJoin(usersTable, eq(userBlocksTable.blockedId, usersTable.id))
      .where(eq(userBlocksTable.blockerId, userId))
      .orderBy(desc(userBlocksTable.criadoEm), desc(userBlocksTable.blockedId))
      .limit(limit)
      .offset((page - 1) * limit);
    res.set("Cache-Control", "no-store");
    res.json({
      users: rows.map(({ u }) => ({
        id: u.id, username: u.username, nomeExibicao: u.nomeExibicao, avatarUrl: urlMedia(u.avatarUrl),
        verificado: u.verificado, tipoConta: u.tipoConta, estaASeguir: false, totalSeguidores: 0,
      })),
      total: Number(total),
      page,
      hasMore: page * limit < Number(total),
    });
  } catch (err) {
    req.log?.error(erroSeguro(err), "Erro ao listar bloqueios");
    res.status(500).json({ error: "Erro interno." });
  }
});

export default router;
