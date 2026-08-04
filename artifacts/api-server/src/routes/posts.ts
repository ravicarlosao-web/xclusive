import { Router } from "express";
import { db, postsTable, postMediaTable, likesTable, savedPostsTable, commentsTable, usersTable, followsTable, subscriptionsTable, purchasesTable } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, optionalAuth, type AuthRequest } from "../lib/auth";
import { validate } from "../lib/validate";

const createPostSchema = z.object({
  legenda: z.string().max(2200).optional(),
  localizacao: z.string().max(100).optional(),
  tipo: z.enum(["imagem", "video", "carrossel"]).optional(),
  media: z
    .array(z.object({ url: z.url(), tipo: z.enum(["imagem", "video"]).optional() }))
    .max(10)
    .optional(),
  exclusivo: z.boolean().optional(),
  precoDesbloqueio: z.number().min(0).max(10_000_000).optional(),
});

const createCommentSchema = z.object({
  texto: z.string().min(1, "Texto é obrigatório").max(2200),
  comentarioPaiId: z.number().int().positive().optional(),
});

const router = Router();

// Feed
router.get("/feed", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId;
  const page = Math.min(1000, Math.max(1, parseInt(String(req.query.page || "1"))));
  const limit = Math.min(20, parseInt(String(req.query.limit || "12")));
  const offset = (page - 1) * limit;

  const [{ totalCount }] = await db.select({ totalCount: sql<number>`count(*)::int` }).from(postsTable);
  const posts = await db.select().from(postsTable).orderBy(desc(postsTable.criadoEm)).limit(limit).offset(offset);

  const result = await Promise.all(posts.map(p => formatPost(p, userId)));

  res.json({ posts: result, total: totalCount || 0, page, hasMore: offset + posts.length < (totalCount || 0) });
});

// Criar post
router.post("/posts", requireAuth, validate(createPostSchema), async (req: AuthRequest, res): Promise<void> => {
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

router.post("/posts/:id/comments", requireAuth, validate(createCommentSchema), async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const { texto, comentarioPaiId } = req.body;

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

/** Verifica se um utilizador tem acesso a conteúdo exclusivo de um criador */
async function temAcessoExclusivo(userId: number | undefined, autorId: number, postId: number): Promise<boolean> {
  // Autor sempre tem acesso ao próprio conteúdo
  if (userId === autorId) return true;
  // Sem sessão → sem acesso
  if (!userId) return false;
  // Subscrição ativa ao criador
  const [sub] = await db.select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(and(
      eq(subscriptionsTable.subscriitorId, userId),
      eq(subscriptionsTable.criadorId, autorId),
      eq(subscriptionsTable.estado, "ativa"),
    ))
    .limit(1);
  if (sub) return true;
  // Compra PPV deste post específico
  const [ppv] = await db.select({ id: purchasesTable.id })
    .from(purchasesTable)
    .where(and(
      eq(purchasesTable.compradorId, userId),
      eq(purchasesTable.vendedorId, autorId),
      eq(purchasesTable.tipo, "ppv"),
      eq(purchasesTable.conteudoId, postId),
    ))
    .limit(1);
  return !!ppv;
}

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

  // Conteúdo exclusivo: ocultar media se utilizador não tem acesso
  const acesso = post.exclusivo ? await temAcessoExclusivo(userId, post.autorId, post.id) : true;
  const mediaSegura = acesso
    ? media.map(m => ({ id: m.id, url: m.url, tipo: m.tipo, ordem: m.ordem }))
    : media.map(m => ({ id: m.id, url: null, tipo: m.tipo, ordem: m.ordem, bloqueado: true }));

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
    media: mediaSegura,
    exclusivo: post.exclusivo,
    bloqueado: post.exclusivo && !acesso,
    precoDesbloqueio: post.precoDesbloqueio ? parseFloat(post.precoDesbloqueio) : null,
    totalCurtidas: likes || 0,
    totalComentarios: comments || 0,
    curtido,
    guardado,
    criadoEm: post.criadoEm.toISOString(),
  };
}

export default router;
