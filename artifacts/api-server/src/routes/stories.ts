import { Router } from "express";
import { db, storiesTable, storyViewsTable, highlightsTable, highlightStoriesTable, usersTable, followsTable } from "@workspace/db";
import { eq, and, gt, sql, desc, inArray } from "drizzle-orm";
import { requireAuth, optionalAuth, type AuthRequest } from "../lib/auth";

const router = Router();

// Feed de stories
router.get("/stories/feed", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId;
  const now = new Date();

  let authorIds: number[] = [];
  if (userId) {
    const follows = await db.select({ seguidoId: followsTable.seguidoId }).from(followsTable).where(eq(followsTable.seguidorId, userId));
    authorIds = follows.map(f => f.seguidoId);
    if (!authorIds.includes(userId)) authorIds.push(userId);
  }

  const stories = authorIds.length > 0
    ? await db.select().from(storiesTable).where(and(gt(storiesTable.expiraEm, now), inArray(storiesTable.autorId, authorIds))).orderBy(desc(storiesTable.criadoEm))
    : await db.select().from(storiesTable).where(gt(storiesTable.expiraEm, now)).orderBy(desc(storiesTable.criadoEm)).limit(20);

  // Agrupar por utilizador
  const byUser = new Map<number, any[]>();
  for (const s of stories) {
    if (!byUser.has(s.autorId)) byUser.set(s.autorId, []);
    byUser.get(s.autorId)!.push(s);
  }

  const result = await Promise.all(Array.from(byUser.entries()).map(async ([authorId, userStories]) => {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, authorId));
    const formattedStories = await Promise.all(userStories.map(s => formatStory(s, userId)));
    const hasNaoVisto = formattedStories.some(s => !s.visto);

    return {
      utilizador: user ? {
        id: user.id, username: user.username, nomeExibicao: user.nomeExibicao,
        avatarUrl: user.avatarUrl, verificado: user.verificado, tipoConta: user.tipoConta,
        estaASeguir: false, segueVoce: false, totalSeguidores: 0,
      } : null,
      stories: formattedStories,
      hasNaoVisto,
    };
  }));

  res.json(result);
});

// Criar story
router.post("/stories", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { mediaUrl, tipo, duracao, audiencia } = req.body;
  if (!mediaUrl) { res.status(400).json({ error: "mediaUrl é obrigatório" }); return; }

  const expiraEm = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  const [story] = await db.insert(storiesTable).values({
    autorId: req.userId!,
    mediaUrl,
    tipo: tipo || "imagem",
    duracao: duracao || 5,
    audiencia: audiencia || "todos",
    expiraEm,
  }).returning();

  res.status(201).json(await formatStory(story, req.userId));
});

// Eliminar story
router.delete("/stories/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [story] = await db.select().from(storiesTable).where(eq(storiesTable.id, id));
  if (!story || story.autorId !== req.userId) { res.status(403).json({ error: "Sem permissão" }); return; }
  await db.delete(storiesTable).where(eq(storiesTable.id, id));
  res.sendStatus(204);
});

// Ver story
router.post("/stories/:id/view", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (req.userId) {
    const [existing] = await db.select().from(storyViewsTable).where(and(eq(storyViewsTable.storyId, id), eq(storyViewsTable.utilizadorId, req.userId)));
    if (!existing) {
      await db.insert(storyViewsTable).values({ storyId: id, utilizadorId: req.userId });
    }
  }
  res.json({ ok: true });
});

// Views da story
router.get("/stories/:id/views", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const views = await db.select({ v: storyViewsTable, u: usersTable })
    .from(storyViewsTable)
    .innerJoin(usersTable, eq(storyViewsTable.utilizadorId, usersTable.id))
    .where(eq(storyViewsTable.storyId, id))
    .orderBy(desc(storyViewsTable.vistoEm));

  res.json(views.map(({ v, u }) => ({
    utilizador: { id: u.id, username: u.username, nomeExibicao: u.nomeExibicao, avatarUrl: u.avatarUrl, verificado: u.verificado, tipoConta: u.tipoConta, estaASeguir: false, segueVoce: false, totalSeguidores: 0 },
    vistoEm: v.vistoEm.toISOString(),
  })));
});

// Highlights
router.post("/highlights", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { titulo, capaUrl, storyIds } = req.body;
  if (!titulo) { res.status(400).json({ error: "Título é obrigatório" }); return; }

  const [highlight] = await db.insert(highlightsTable).values({
    utilizadorId: req.userId!,
    titulo,
    capaUrl: capaUrl || null,
  }).returning();

  if (storyIds && Array.isArray(storyIds)) {
    for (const storyId of storyIds) {
      await db.insert(highlightStoriesTable).values({ highlightId: highlight.id, storyId });
    }
  }

  res.status(201).json({
    id: highlight.id,
    titulo: highlight.titulo,
    capaUrl: highlight.capaUrl,
    stories: [],
    criadoEm: highlight.criadoEm.toISOString(),
  });
});

router.get("/users/:username/highlights", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, raw.toLowerCase()));
  if (!user) { res.status(404).json({ error: "Não encontrado" }); return; }

  const highlights = await db.select().from(highlightsTable).where(eq(highlightsTable.utilizadorId, user.id)).orderBy(desc(highlightsTable.criadoEm));

  res.json(highlights.map(h => ({
    id: h.id,
    titulo: h.titulo,
    capaUrl: h.capaUrl,
    stories: [],
    criadoEm: h.criadoEm.toISOString(),
  })));
});

router.delete("/highlights/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [highlight] = await db.select().from(highlightsTable).where(eq(highlightsTable.id, id));
  if (!highlight || highlight.utilizadorId !== req.userId) { res.status(403).json({ error: "Sem permissão" }); return; }
  await db.delete(highlightsTable).where(eq(highlightsTable.id, id));
  res.sendStatus(204);
});

async function formatStory(story: any, viewerId?: number) {
  const [{ views }] = await db.select({ views: sql<number>`count(*)::int` }).from(storyViewsTable).where(eq(storyViewsTable.storyId, story.id));
  let visto = false;
  if (viewerId) {
    const [view] = await db.select().from(storyViewsTable).where(and(eq(storyViewsTable.storyId, story.id), eq(storyViewsTable.utilizadorId, viewerId)));
    visto = !!view;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, story.autorId));

  return {
    id: story.id,
    autor: user ? {
      id: user.id, username: user.username, nomeExibicao: user.nomeExibicao,
      avatarUrl: user.avatarUrl, verificado: user.verificado, tipoConta: user.tipoConta,
      estaASeguir: false, segueVoce: false, totalSeguidores: 0,
    } : null,
    mediaUrl: story.mediaUrl,
    tipo: story.tipo,
    duracao: story.duracao,
    audiencia: story.audiencia,
    expirado: new Date(story.expiraEm) < new Date(),
    visto,
    totalVisualizacoes: views || 0,
    expiraEm: story.expiraEm.toISOString(),
    criadoEm: story.criadoEm.toISOString(),
  };
}

export default router;
