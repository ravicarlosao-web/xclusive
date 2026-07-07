import { Router } from "express";
import { db, reelsTable, likesTable, commentsTable, usersTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth, optionalAuth, type AuthRequest } from "../lib/auth";

const router = Router();

// Feed de reels
router.get("/reels", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const page = Math.max(1, parseInt(String(req.query.page || "1")));
  const limit = Math.min(20, parseInt(String(req.query.limit || "10")));
  const offset = (page - 1) * limit;

  const reels = await db.select().from(reelsTable).orderBy(desc(reelsTable.criadoEm)).limit(limit).offset(offset);

  const result = await Promise.all(reels.map(r => formatReel(r, req.userId)));
  res.json({ reels: result, page, hasMore: result.length === limit });
});

// Criar reel
router.post("/reels", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { videoUrl, capaUrl, legenda, exclusivo } = req.body;
  if (!videoUrl) { res.status(400).json({ error: "videoUrl é obrigatório" }); return; }

  const [reel] = await db.insert(reelsTable).values({
    autorId: req.userId!,
    videoUrl,
    capaUrl: capaUrl || null,
    legenda: legenda || null,
    exclusivo: exclusivo || false,
  }).returning();

  res.status(201).json(await formatReel(reel, req.userId));
});

// Obter reel
router.get("/reels/:id", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [reel] = await db.select().from(reelsTable).where(eq(reelsTable.id, id));
  if (!reel) { res.status(404).json({ error: "Não encontrado" }); return; }
  res.json(await formatReel(reel, req.userId));
});

// Curtir reel
router.post("/reels/:id/like", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [existing] = await db.select().from(likesTable).where(and(eq(likesTable.utilizadorId, req.userId!), eq(likesTable.alvoTipo, "reel"), eq(likesTable.alvoId, id)));
  if (!existing) {
    await db.insert(likesTable).values({ utilizadorId: req.userId!, alvoTipo: "reel", alvoId: id });
  }
  res.json({ ok: true });
});

// Remover curtida reel
router.delete("/reels/:id/like", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  await db.delete(likesTable).where(and(eq(likesTable.utilizadorId, req.userId!), eq(likesTable.alvoTipo, "reel"), eq(likesTable.alvoId, id)));
  res.json({ ok: true });
});

async function formatReel(reel: any, userId?: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, reel.autorId));
  const [{ likes }] = await db.select({ likes: sql<number>`count(*)::int` }).from(likesTable).where(and(eq(likesTable.alvoTipo, "reel"), eq(likesTable.alvoId, reel.id)));
  const [{ comments }] = await db.select({ comments: sql<number>`count(*)::int` }).from(commentsTable).where(eq(commentsTable.postId, reel.id));
  let curtido = false;
  if (userId) {
    const [like] = await db.select().from(likesTable).where(and(eq(likesTable.utilizadorId, userId), eq(likesTable.alvoTipo, "reel"), eq(likesTable.alvoId, reel.id)));
    curtido = !!like;
  }

  return {
    id: reel.id,
    autor: user ? {
      id: user.id, username: user.username, nomeExibicao: user.nomeExibicao,
      avatarUrl: user.avatarUrl, verificado: user.verificado, tipoConta: user.tipoConta,
      estaASeguir: false, segueVoce: false, totalSeguidores: 0,
    } : null,
    videoUrl: reel.videoUrl,
    capaUrl: reel.capaUrl,
    legenda: reel.legenda,
    somTitulo: reel.somTitulo,
    somArtista: reel.somArtista,
    exclusivo: reel.exclusivo,
    totalCurtidas: likes || 0,
    totalComentarios: comments || 0,
    curtido,
    guardado: false,
    criadoEm: reel.criadoEm.toISOString(),
  };
}

export default router;
