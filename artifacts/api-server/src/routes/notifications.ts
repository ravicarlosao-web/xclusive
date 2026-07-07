import { Router } from "express";
import { db, notificationsTable, usersTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../lib/auth";

const router = Router();

router.get("/notifications", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const page = Math.max(1, parseInt(String(req.query.page || "1")));
  const limit = 20;
  const offset = (page - 1) * limit;

  const notifs = await db.select({ n: notificationsTable, ator: usersTable })
    .from(notificationsTable)
    .leftJoin(usersTable, eq(notificationsTable.atorId, usersTable.id))
    .where(eq(notificationsTable.destinatarioId, userId))
    .orderBy(desc(notificationsTable.criadoEm))
    .limit(limit)
    .offset(offset);

  res.json({
    notifications: notifs.map(({ n, ator }) => ({
      id: n.id,
      tipo: n.tipo,
      ator: ator ? {
        id: ator.id, username: ator.username, nomeExibicao: ator.nomeExibicao,
        avatarUrl: ator.avatarUrl, verificado: ator.verificado, tipoConta: ator.tipoConta,
        estaASeguir: false, segueVoce: false, totalSeguidores: 0,
      } : null,
      lida: n.lida,
      postId: n.alvoId,
      postThumbnail: n.postThumbnail,
      criadoEm: n.criadoEm.toISOString(),
    })),
    page,
    hasMore: notifs.length === limit,
  });
});

router.post("/notifications/read-all", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  await db.update(notificationsTable)
    .set({ lida: true })
    .where(and(eq(notificationsTable.destinatarioId, req.userId!), eq(notificationsTable.lida, false)));
  res.json({ ok: true });
});

router.get("/notifications/unread-count", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.destinatarioId, req.userId!), eq(notificationsTable.lida, false)));
  res.json({ count: count || 0 });
});

export default router;
