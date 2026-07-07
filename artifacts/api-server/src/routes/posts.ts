import { Router } from "express";
import { db, postsTable, postMediaTable, likesTable, savedPostsTable, commentsTable, usersTable, followsTable } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { requireAuth, optionalAuth, type AuthRequest } from "../lib/auth";

const router = Router();

// Feed
router.get("/feed", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId;
  const page = Math.max(1, parseInt(String(req.query.page || "1")));
  const limit = Math.min(20, parseInt(String(req.query.limit || "12")));
  const offset = (page - 1) * limit;

  const [{ totalCount }] = await db.select({ totalCount: sql<number>`count(*)::int` }).from(postsTable);
  const posts = await db.select().from(postsTable).orderBy(desc(postsTable.criadoEm)).limit(limit).offset(offset);

  const result = await Promise.all(posts.map(p => formatPost(p, userId)));

  res.json({ posts: result, total: totalCount || 0, page, hasMore: offset + posts.length < (totalCount || 0) });
});

// Criar post
router.post("/posts", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const { legenda, localizacao, tipo, media, exclusivo, precoDesbloqueio } = req.body;

  const [post] = await db.insert(postsTable).values({
    autorId: userId,
    legenda: legenda || null,
    localizacao: localizacao || null,
    tipo: tipo || "imagem",
    exclusivo: exclusivo || false,
    precoDesbloqueio: precoDesbloqueio ? String(precoDesbloqueio) : null,
  }).returning();

  if (media && Array.isArray(media)) {
    for (let i = 0; i < media.length; i++) {
      await db.insert(postMediaTable).values({
        postId: post.id,
        url: media[i].url,
        tipo: media[i].tipo || "imagem",
        ordem: i,
      });
    }
  }

  const formatted = await formatPost(post, userId);
  res.status(201).json(formatted);
});

// Obter post
router.get("/posts/:id", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, id));
  if (!post) { res.status(404).json({ error: "Não encontrado" }); return; }

  res.json(await formatPost(post, req.userId));
});

// Eliminar post
router.delete("/posts/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, id));
  if (!post || post.autorId !== req.userId) { res.status(403).json({ error: "Sem permissão" }); return; }
  await db.delete(postsTable).where(eq(postsTable.id, id));
  res.sendStatus(204);
});

// Curtir
router.post("/posts/:id/like", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const userId = req.userId!;
  const [existing] = await db.select().from(likesTable).where(and(eq(likesTable.utilizadorId, userId), eq(likesTable.alvoTipo, "post"), eq(likesTable.alvoId, id)));
  if (!existing) {
    await db.insert(likesTable).values({ utilizadorId: userId, alvoTipo: "post", alvoId: id });
  }
  res.json({ ok: true });
});

// Remover curtida
router.delete("/posts/:id/like", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  await db.delete(likesTable).where(and(eq(likesTable.utilizadorId, req.userId!), eq(likesTable.alvoTipo, "post"), eq(likesTable.alvoId, id)));
  res.json({ ok: true });
});

// Guardar
router.post("/posts/:id/save", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const userId = req.userId!;
  const [existing] = await db.select().from(savedPostsTable).where(and(eq(savedPostsTable.utilizadorId, userId), eq(savedPostsTable.postId, id)));
  if (!existing) {
    await db.insert(savedPostsTable).values({ utilizadorId: userId, postId: id });
  }
  res.json({ ok: true });
});

// Remover guardado
router.delete("/posts/:id/save", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  await db.delete(savedPostsTable).where(and(eq(savedPostsTable.utilizadorId, req.userId!), eq(savedPostsTable.postId, id)));
  res.json({ ok: true });
});

// Comentários
router.get("/posts/:id/comments", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);

  const comments = await db.select({ c: commentsTable, u: usersTable })
    .from(commentsTable)
    .innerJoin(usersTable, eq(commentsTable.autorId, usersTable.id))
    .where(and(eq(commentsTable.postId, id), sql`${commentsTable.comentarioPaiId} IS NULL`))
    .orderBy(desc(commentsTable.criadoEm))
    .limit(30);

  const result = comments.map(({ c, u }) => ({
    id: c.id,
    autor: { id: u.id, username: u.username, nomeExibicao: u.nomeExibicao, avatarUrl: u.avatarUrl, verificado: u.verificado, tipoConta: u.tipoConta, estaASeguir: false, segueVoce: false, totalSeguidores: 0 },
    texto: c.texto,
    comentarioPaiId: c.comentarioPaiId,
    respostas: [],
    totalCurtidas: 0,
    curtido: false,
    criadoEm: c.criadoEm.toISOString(),
  }));

  res.json({ comments: result, total: result.length, page: 1, hasMore: false });
});

router.post("/posts/:id/comments", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const { texto, comentarioPaiId } = req.body;

  if (!texto) { res.status(400).json({ error: "Texto é obrigatório" }); return; }

  const [comment] = await db.insert(commentsTable).values({
    postId: id,
    autorId: req.userId!,
    texto,
    comentarioPaiId: comentarioPaiId || null,
  }).returning();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));

  res.status(201).json({
    id: comment.id,
    autor: { id: user.id, username: user.username, nomeExibicao: user.nomeExibicao, avatarUrl: user.avatarUrl, verificado: user.verificado, tipoConta: user.tipoConta, estaASeguir: false, segueVoce: false, totalSeguidores: 0 },
    texto: comment.texto,
    comentarioPaiId: comment.comentarioPaiId,
    respostas: [],
    totalCurtidas: 0,
    curtido: false,
    criadoEm: comment.criadoEm.toISOString(),
  });
});

router.delete("/comments/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [comment] = await db.select().from(commentsTable).where(eq(commentsTable.id, id));
  if (!comment || comment.autorId !== req.userId) { res.status(403).json({ error: "Sem permissão" }); return; }
  await db.delete(commentsTable).where(eq(commentsTable.id, id));
  res.sendStatus(204);
});

async function formatPost(post: any, userId?: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, post.autorId));
  const media = await db.select().from(postMediaTable).where(eq(postMediaTable.postId, post.id)).orderBy(postMediaTable.ordem);
  const [{ likes }] = await db.select({ likes: sql<number>`count(*)::int` }).from(likesTable).where(and(eq(likesTable.alvoTipo, "post"), eq(likesTable.alvoId, post.id)));
  const [{ comments }] = await db.select({ comments: sql<number>`count(*)::int` }).from(commentsTable).where(eq(commentsTable.postId, post.id));

  let curtido = false;
  let guardado = false;
  if (userId) {
    const [like] = await db.select().from(likesTable).where(and(eq(likesTable.utilizadorId, userId), eq(likesTable.alvoTipo, "post"), eq(likesTable.alvoId, post.id)));
    curtido = !!like;
    const [saved] = await db.select().from(savedPostsTable).where(and(eq(savedPostsTable.utilizadorId, userId), eq(savedPostsTable.postId, post.id)));
    guardado = !!saved;
  }

  return {
    id: post.id,
    autor: user ? {
      id: user.id, username: user.username, nomeExibicao: user.nomeExibicao,
      avatarUrl: user.avatarUrl, verificado: user.verificado, tipoConta: user.tipoConta,
      estaASeguir: false, segueVoce: false, totalSeguidores: 0,
    } : null,
    legenda: post.legenda,
    localizacao: post.localizacao,
    tipo: post.tipo,
    media: media.map(m => ({ id: m.id, url: m.url, tipo: m.tipo, ordem: m.ordem })),
    exclusivo: post.exclusivo,
    precoDesbloqueio: post.precoDesbloqueio ? parseFloat(post.precoDesbloqueio) : null,
    totalCurtidas: likes || 0,
    totalComentarios: comments || 0,
    curtido,
    guardado,
    criadoEm: post.criadoEm.toISOString(),
  };
}

export default router;
