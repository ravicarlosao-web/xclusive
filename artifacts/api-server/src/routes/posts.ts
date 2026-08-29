import { Router } from "express";
import { db, postsTable, postMediaTable, likesTable, savedPostsTable, commentsTable, usersTable, followsTable, subscriptionsTable, purchasesTable, notificationsTable } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, optionalAuth, type AuthRequest } from "../lib/auth";
import { validate } from "../lib/validate";
import { deletePostWithMedia } from "../lib/postDeletion";
import { temAcessoExclusivo } from "../lib/exclusiveAccess";
import { getCommissionRate, calcComissao } from "../lib/commission";

const createPostSchema = z.object({
  legenda: z.string().max(2200).optional(),
  localizacao: z.string().max(100).optional(),
  tipo: z.enum(["imagem", "video", "carrossel", "texto"]).optional(),
  media: z
    .array(z.object({ url: z.url(), tipo: z.enum(["imagem", "video"]).optional() }))
    .max(10)
    .optional(),
  exclusivo: z.boolean().optional(),
  precoDesbloqueio: z.number().min(0).max(10_000_000).optional(),
}).refine(
  data => data.tipo === 'texto' ? (data.legenda && data.legenda.trim().length > 0) : true,
  { message: 'Posts de texto precisam de conteúdo na legenda.' }
);

const createCommentSchema = z.object({
  texto: z.string().min(1, "Texto é obrigatório").max(2200),
  comentarioPaiId: z.number().int().positive().optional(),
});

const router = Router();

/** Erros de pagamento lançados dentro de transações. */
class PaymentError extends Error {
  constructor(msg: string, public readonly httpStatus: number) {
    super(msg);
    this.name = "PaymentError";
  }
}

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

// Criar post (apenas criadores)
router.post("/posts", requireAuth, validate(createPostSchema), async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;

  const [author] = await db.select({ tipoConta: usersTable.tipoConta, verificado: usersTable.verificado }).from(usersTable).where(eq(usersTable.id, userId));
  if (!author || author.tipoConta !== 'criador') {
    res.status(403).json({ error: 'Apenas criadores podem publicar conteúdo.' });
    return;
  }
  if (!author.verificado) {
    res.status(403).json({ error: 'A tua conta de criador ainda está pendente de aprovação. Aguarda a revisão do administrador antes de publicares.' });
    return;
  }

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

// Desbloquear post PPV
router.post("/posts/:id/unlock", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const userId = req.userId!;

  try {
    // 1. Verificar se o post existe e é exclusivo
    const [post] = await db.select().from(postsTable).where(eq(postsTable.id, id)).limit(1);
    if (!post) { res.status(404).json({ error: "Post não encontrado." }); return; }
    if (!post.exclusivo || !post.precoDesbloqueio) { res.status(400).json({ error: "Este post não precisa de ser desbloqueado por PPV." }); return; }
    if (post.autorId === userId) { res.status(400).json({ error: "Não podes desbloquear o teu próprio post." }); return; }

    const precoNumber = Number(post.precoDesbloqueio);

    // 2. Transacção atómica de compra
    await db.transaction(async (tx) => {
      // a) Bloquear o comprador
      const [comprador] = await tx.select({ saldo: usersTable.saldo }).from(usersTable).where(eq(usersTable.id, userId)).for("update");
      if (!comprador) throw new PaymentError("Utilizador não encontrado.", 404);

      // b) Verificar se já tem acesso (AGORA DENTRO DO LOCK para evitar race conditions)
      const jaTemAcesso = await temAcessoExclusivo(userId, post.autorId, id);
      if (jaTemAcesso) throw new PaymentError("Já tens acesso a este post.", 400);

      if (Number(comprador.saldo) < precoNumber) throw new PaymentError("Saldo insuficiente. Carrega a tua carteira primeiro.", 402);

      // b) Calcular comissões
      const commissionRate = await getCommissionRate(tx);
      const { valorCriador, comissao } = calcComissao(precoNumber, commissionRate);

      // c) Debitar o comprador
      await tx.update(usersTable).set({ saldo: sql`${usersTable.saldo} - ${precoNumber}` }).where(eq(usersTable.id, userId));

      // d) Creditar o criador
      await tx.update(usersTable).set({ ganhos: sql`${usersTable.ganhos} + ${valorCriador}` }).where(eq(usersTable.id, post.autorId));

      // e) Registar a compra (PPV)
      await tx.insert(purchasesTable).values({
        compradorId: userId,
        vendedorId: post.autorId,
        tipo: "ppv",
        valor: String(precoNumber),
        comissao: String(comissao),
        conteudoId: id,
        descricao: `Desbloqueio PPV do post #${id}`,
      });
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof PaymentError) {
      res.status(err.httpStatus).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "Erro interno ao processar desbloqueio." });
  }
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
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, id));
  if (!post) { res.status(404).json({ error: "Post não encontrado" }); return; }

  const [requestingUser] = await db
    .select({ role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);
  const isAdmin = requestingUser?.role === "admin" || requestingUser?.role === "superadmin";
  if (post.autorId !== req.userId && !isAdmin) {
    res.status(403).json({ error: "Sem permissão" });
    return;
  }

  await deletePostWithMedia(id);
  res.sendStatus(204);
});

// Curtir
router.post("/posts/:id/like", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const userId = req.userId!;
  const [existing] = await db.select().from(likesTable).where(and(eq(likesTable.utilizadorId, userId), eq(likesTable.alvoTipo, "post"), eq(likesTable.alvoId, id)));
  if (!existing) {
    await db.insert(likesTable).values({ utilizadorId: userId, alvoTipo: "post", alvoId: id });
    // Notificar o autor do post (se não for o próprio)
    const [post] = await db.select({ autorId: postsTable.autorId }).from(postsTable).where(eq(postsTable.id, id));
    if (post && post.autorId !== userId) {
      await db.insert(notificationsTable).values({
        destinatarioId: post.autorId,
        tipo: "like_post",
        atorId: userId,
        alvoId: id,
      }).onConflictDoNothing();
    }
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
  const userId = req.userId!;
  const { texto, comentarioPaiId } = req.body;

  const [comment] = await db.insert(commentsTable).values({
    postId: id,
    autorId: userId,
    texto,
    comentarioPaiId: comentarioPaiId || null,
  }).returning();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

  // Notificar o autor do post (se não for o próprio)
  const [post] = await db.select({ autorId: postsTable.autorId }).from(postsTable).where(eq(postsTable.id, id));
  if (post && post.autorId !== userId) {
    await db.insert(notificationsTable).values({
      destinatarioId: post.autorId,
      tipo: "comentario",
      atorId: userId,
      alvoId: id,
    }).onConflictDoNothing();
  }

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
