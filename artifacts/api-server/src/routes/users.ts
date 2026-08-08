import { Router } from "express";
import { db, usersTable, followsTable, postsTable, notificationsTable, postMediaTable, likesTable, commentsTable, kycSubmissionsTable } from "@workspace/db";
import { eq, and, ne, sql, not, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, optionalAuth, type AuthRequest } from "../lib/auth";
import { validate } from "../lib/validate";
import { createStorageKey, deleteFile, uploadFile } from "../lib/storage";

const updateProfileSchema = z.object({
  nomeExibicao: z.string().min(1).max(100).optional(),
  bio: z.string().max(500).optional(),
  link: z.union([z.url().max(500), z.literal("")]).optional(),
  avatarUrl: z.union([z.url().max(1000), z.literal("")]).optional(),
  capaUrl: z.union([z.url().max(1000), z.literal("")]).optional(),
  // tipoConta é intencionalmente excluído — a mudança pessoal→criador requer KYC
  // via POST /users/me/tornar-criador
  privado: z.boolean().optional(),
});

const kycSubmissionSchema = z.object({
  nomeCompleto: z.string().min(3).max(150),
  dataNascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Formato YYYY-MM-DD"),
  tipoDocumento: z.enum(["bi", "passaporte", "carta"]),
  numeroDocumento: z.string().min(3).max(50),
  paisEmissao: z.string().min(1).max(100),
  // As fotos chegam como data URLs capturados pela câmara.
  documentoFoto: z.string().min(1),
  selfieFoto: z.string().min(1),
  livenessFoto: z.string().min(1),
});

const router = Router();

/**
 * Verifica se o viewer tem acesso ao conteúdo de uma conta privada.
 * Retorna true se: conta é pública, viewer é o dono, ou viewer segue a conta.
 * Nota: estaASeguir já calculado na rota de perfil — passa-o directamente.
 * Para rotas que ainda não calcularam, usa checkFollow=true para fazer a query.
 */
async function canViewPrivateContent(
  user: { id: number; privado: boolean | null },
  viewerId: number | undefined,
  estaASeguirPrecomputed?: boolean,
): Promise<boolean> {
  if (!user.privado) return true;
  if (viewerId === user.id) return true;
  if (estaASeguirPrecomputed !== undefined) return estaASeguirPrecomputed;
  if (!viewerId) return false;
  const [follow] = await db
    .select()
    .from(followsTable)
    .where(and(eq(followsTable.seguidorId, viewerId), eq(followsTable.seguidoId, user.id)));
  return !!follow;
}

// Sugestões de utilizadores para seguir
router.get("/users/suggestions", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId;

  let excludeIds: number[] = userId ? [userId] : [];

  if (userId) {
    const follows = await db.select({ seguidoId: followsTable.seguidoId }).from(followsTable).where(eq(followsTable.seguidorId, userId));
    excludeIds = [userId, ...follows.map(f => f.seguidoId)];
  }

  const query = db.select().from(usersTable).limit(10);
  const users = excludeIds.length > 0
    ? await query.where(not(inArray(usersTable.id, excludeIds)))
    : await query;

  const result = await Promise.all(users.map(async (u) => {
    const [{ cnt }] = await db.select({ cnt: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidoId, u.id));
    return {
      id: u.id,
      username: u.username,
      nomeExibicao: u.nomeExibicao,
      avatarUrl: u.avatarUrl,
      verificado: u.verificado,
      tipoConta: u.tipoConta,
      estaASeguir: false,
      segueVoce: false,
      totalSeguidores: cnt || 0,
    };
  }));

  res.json(result);
});

// Atualizar perfil
router.patch("/users/me", requireAuth, validate(updateProfileSchema), async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  // tipoConta foi removido intencionalmente — use POST /users/me/tornar-criador
  const { nomeExibicao, bio, link, avatarUrl, capaUrl, privado } = req.body;

  const updates: Record<string, any> = {};
  if (nomeExibicao !== undefined) updates.nomeExibicao = nomeExibicao;
  if (bio !== undefined) updates.bio = bio;
  if (link !== undefined) updates.link = link;
  if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
  if (capaUrl !== undefined) updates.capaUrl = capaUrl;
  if (privado !== undefined) updates.privado = privado;

  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();

  const [{ seguidores }] = await db.select({ seguidores: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidoId, userId));
  const [{ seguindo }] = await db.select({ seguindo: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidorId, userId));
  const [{ posts }] = await db.select({ posts: sql<number>`count(*)::int` }).from(postsTable).where(eq(postsTable.autorId, userId));

  res.json({
    id: user.id,
    username: user.username,
    nomeExibicao: user.nomeExibicao,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    capaUrl: user.capaUrl,
    link: user.link,
    tipoConta: user.tipoConta,
    verificado: user.verificado,
    privado: user.privado,
    totalSeguidores: seguidores || 0,
    totalSeguindo: seguindo || 0,
    totalPublicacoes: posts || 0,
    estaASeguir: false,
    segueVoce: false,
    criadoEm: user.criadoEm.toISOString(),
  });
});

/**
 * POST /api/users/me/tornar-criador
 * Submete pedido KYC e promove a conta para "criador" (verificado=false, pendente revisão admin).
 * É a ÚNICA forma válida de alterar tipoConta pessoal→criador no backend.
 */
router.post("/users/me/tornar-criador", requireAuth, validate(kycSubmissionSchema), async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;

  // Verificar se já é criador
  const [current] = await db.select({ tipoConta: usersTable.tipoConta, verificado: usersTable.verificado })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!current) { res.status(404).json({ error: "Utilizador não encontrado" }); return; }
  if (current.tipoConta === "criador") {
    res.status(409).json({ error: "A conta já é do tipo criador." });
    return;
  }

  const { dataNascimento } = req.body;

  // Verificar idade mínima de 18 anos
  const hoje = new Date();
  const nascimento = new Date(dataNascimento);
  const idadeAnos = hoje.getFullYear() - nascimento.getFullYear()
    - (hoje < new Date(hoje.getFullYear(), nascimento.getMonth(), nascimento.getDate()) ? 1 : 0);
  if (idadeAnos < 18) {
    res.status(400).json({ error: "Tens de ter pelo menos 18 anos para te tornares criador." });
    return;
  }

  function decodeCapturedImage(value: string, field: string): { buffer: Buffer; contentType: string; extension: string } {
    const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
    if (!match) {
      throw new Error(`${field} tem um formato de imagem inválido.`);
    }
    const contentType = match[1];
    const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
    if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) {
      throw new Error(`${field} excede o tamanho permitido.`);
    }
    return { buffer, contentType, extension: contentType.split("/")[1] === "jpeg" ? "jpg" : contentType.split("/")[1] };
  }

  const uploadedKeys: string[] = [];
  try {
    const captured = [
      decodeCapturedImage(req.body.documentoFoto, "documentoFoto"),
      decodeCapturedImage(req.body.selfieFoto, "selfieFoto"),
      decodeCapturedImage(req.body.livenessFoto, "livenessFoto"),
    ];
    const prefixes = ["documento", "selfie", "liveness"];
    const keys = captured.map((file, index) => createStorageKey(`users/${userId}/kyc/${prefixes[index]}`, file.extension));

    for (let index = 0; index < captured.length; index++) {
      const file = captured[index];
      const key = keys[index];
      await uploadFile(file.buffer, key, file.contentType);
      uploadedKeys.push(key);
    }

    await db.transaction(async (tx) => {
      await tx.insert(kycSubmissionsTable).values({
        userId,
        nomeCompleto: req.body.nomeCompleto,
        dataNascimento: req.body.dataNascimento,
        tipoDocumento: req.body.tipoDocumento,
        numeroDocumento: req.body.numeroDocumento,
        paisEmissao: req.body.paisEmissao,
        documentoKey: keys[0],
        selfieKey: keys[1],
        livenessKey: keys[2],
      });

      // A conta passa a aparecer na fila de revisão, mas só fica verificada
      // depois da aprovação explícita de um administrador.
      await tx.update(usersTable)
        .set({ tipoConta: "criador", verificado: false })
        .where(eq(usersTable.id, userId));
    });
  } catch (error) {
    await Promise.allSettled(uploadedKeys.map((key) => deleteFile(key)));
    const message = error instanceof Error ? error.message : "Não foi possível guardar os documentos.";
    res.status(400).json({ error: message });
    return;
  }

  res.status(202).json({
    ok: true,
    tipoConta: "criador",
    verificado: false,
    mensagem: "Pedido de verificação submetido com sucesso. A tua conta ficará pendente de revisão — serás notificado quando for aprovada.",
  });
});

// Obter perfil por username
router.get("/users/:username", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const { username } = req.params;
  const viewerId = req.userId;

  const raw = Array.isArray(username) ? username[0] : username;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, raw.toLowerCase()));
  if (!user) { res.status(404).json({ error: "Utilizador não encontrado" }); return; }

  const [{ seguidores }] = await db.select({ seguidores: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidoId, user.id));
  const [{ seguindo }] = await db.select({ seguindo: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidorId, user.id));
  const [{ posts }] = await db.select({ posts: sql<number>`count(*)::int` }).from(postsTable).where(eq(postsTable.autorId, user.id));

  let estaASeguir = false;
  let segueVoce = false;
  if (viewerId && viewerId !== user.id) {
    const [f] = await db.select().from(followsTable).where(and(eq(followsTable.seguidorId, viewerId), eq(followsTable.seguidoId, user.id)));
    estaASeguir = !!f;
    const [fBack] = await db.select().from(followsTable).where(and(eq(followsTable.seguidorId, user.id), eq(followsTable.seguidoId, viewerId)));
    segueVoce = !!fBack;
  }

  const podeVerConteudo = await canViewPrivateContent(user, viewerId, estaASeguir);

  res.json({
    id: user.id,
    username: user.username,
    nomeExibicao: user.nomeExibicao,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    capaUrl: user.capaUrl,
    link: user.link,
    tipoConta: user.tipoConta,
    verificado: user.verificado,
    privado: user.privado,
    // Contagens ocultadas para contas privadas a não-seguidores
    totalSeguidores: podeVerConteudo ? (seguidores || 0) : null,
    totalSeguindo: podeVerConteudo ? (seguindo || 0) : null,
    totalPublicacoes: podeVerConteudo ? (posts || 0) : null,
    estaASeguir,
    segueVoce,
    criadoEm: user.criadoEm.toISOString(),
  });
});

// Seguir utilizador
router.post("/users/:username/follow", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const raw = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  const [target] = await db.select().from(usersTable).where(eq(usersTable.username, raw.toLowerCase()));
  if (!target || target.id === userId) { res.status(400).json({ error: "Inválido" }); return; }

  const [existing] = await db.select().from(followsTable).where(and(eq(followsTable.seguidorId, userId), eq(followsTable.seguidoId, target.id)));
  if (!existing) {
    await db.insert(followsTable).values({ seguidorId: userId, seguidoId: target.id });
    // Notificar o utilizador seguido
    await db.insert(notificationsTable).values({
      destinatarioId: target.id,
      tipo: "novo_seguidor",
      atorId: userId,
      alvoId: null,
    }).onConflictDoNothing();
  }
  res.json({ ok: true });
});

// Deixar de seguir
router.delete("/users/:username/follow", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const raw = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  const [target] = await db.select().from(usersTable).where(eq(usersTable.username, raw.toLowerCase()));
  if (!target) { res.status(404).json({ error: "Não encontrado" }); return; }

  await db.delete(followsTable).where(and(eq(followsTable.seguidorId, userId), eq(followsTable.seguidoId, target.id)));
  res.json({ ok: true });
});

// Seguidores
router.get("/users/:username/followers", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, raw.toLowerCase()));
  if (!user) { res.status(404).json({ error: "Não encontrado" }); return; }

  if (!await canViewPrivateContent(user, req.userId)) {
    res.status(403).json({ error: "Esta conta é privada." }); return;
  }

  const followers = await db.select({ u: usersTable }).from(followsTable).innerJoin(usersTable, eq(followsTable.seguidorId, usersTable.id)).where(eq(followsTable.seguidoId, user.id)).limit(50);
  const users = followers.map(f => ({
    id: f.u.id,
    username: f.u.username,
    nomeExibicao: f.u.nomeExibicao,
    avatarUrl: f.u.avatarUrl,
    verificado: f.u.verificado,
    tipoConta: f.u.tipoConta,
    estaASeguir: false,
    segueVoce: false,
    totalSeguidores: 0,
  }));
  res.json({ users, total: users.length, page: 1, hasMore: false });
});

// A seguir
router.get("/users/:username/following", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, raw.toLowerCase()));
  if (!user) { res.status(404).json({ error: "Não encontrado" }); return; }

  if (!await canViewPrivateContent(user, req.userId)) {
    res.status(403).json({ error: "Esta conta é privada." }); return;
  }

  const following = await db.select({ u: usersTable }).from(followsTable).innerJoin(usersTable, eq(followsTable.seguidoId, usersTable.id)).where(eq(followsTable.seguidorId, user.id)).limit(50);
  const users = following.map(f => ({
    id: f.u.id,
    username: f.u.username,
    nomeExibicao: f.u.nomeExibicao,
    avatarUrl: f.u.avatarUrl,
    verificado: f.u.verificado,
    tipoConta: f.u.tipoConta,
    estaASeguir: false,
    segueVoce: false,
    totalSeguidores: 0,
  }));
  res.json({ users, total: users.length, page: 1, hasMore: false });
});

// Posts do utilizador
router.get("/users/:username/posts", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, raw.toLowerCase()));
  if (!user) { res.status(404).json({ error: "Não encontrado" }); return; }

  if (!await canViewPrivateContent(user, req.userId)) {
    res.status(403).json({ error: "Esta conta é privada." }); return;
  }

  const posts = await db.select().from(postsTable).where(eq(postsTable.autorId, user.id)).orderBy(sql`${postsTable.criadoEm} DESC`).limit(30);

  const result = await Promise.all(posts.map(async (p) => {
    const media = await db.select().from(postMediaTable).where(eq(postMediaTable.postId, p.id)).orderBy(postMediaTable.ordem);
    const [{ likes }] = await db.select({ likes: sql<number>`count(*)::int` }).from(likesTable).where(and(eq(likesTable.alvoTipo, "post"), eq(likesTable.alvoId, p.id)));
    const [{ comments }] = await db.select({ comments: sql<number>`count(*)::int` }).from(commentsTable).where(eq(commentsTable.postId, p.id));
    return {
      id: p.id,
      autor: { id: user.id, username: user.username, nomeExibicao: user.nomeExibicao, avatarUrl: user.avatarUrl, verificado: user.verificado, tipoConta: user.tipoConta, estaASeguir: false, segueVoce: false, totalSeguidores: 0 },
      legenda: p.legenda,
      localizacao: p.localizacao,
      tipo: p.tipo,
      media: media.map(m => ({ id: m.id, url: m.url, tipo: m.tipo, ordem: m.ordem })),
      exclusivo: p.exclusivo,
      precoDesbloqueio: p.precoDesbloqueio ? parseFloat(p.precoDesbloqueio) : null,
      totalCurtidas: likes || 0,
      totalComentarios: comments || 0,
      curtido: false,
      guardado: false,
      criadoEm: p.criadoEm.toISOString(),
    };
  }));

  res.json({ posts: result, total: result.length, page: 1, hasMore: false });
});

// Reels do utilizador
router.get("/users/:username/reels", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, raw.toLowerCase()));
  if (!user) { res.status(404).json({ error: "Não encontrado" }); return; }

  if (!await canViewPrivateContent(user, req.userId)) {
    res.status(403).json({ error: "Esta conta é privada." }); return;
  }

  res.json({ reels: [], page: 1, hasMore: false });
});

export default router;
