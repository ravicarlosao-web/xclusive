import { Router } from "express";
import { db, usersTable, followsTable, postsTable } from "@workspace/db";
import { eq, and, ne, sql, not, inArray } from "drizzle-orm";
import { requireAuth, optionalAuth, type AuthRequest } from "../lib/auth";

const router = Router();

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
router.patch("/users/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const { nomeExibicao, bio, link, avatarUrl, capaUrl, tipoConta, privado } = req.body;

  const updates: Record<string, any> = {};
  if (nomeExibicao !== undefined) updates.nomeExibicao = nomeExibicao;
  if (bio !== undefined) updates.bio = bio;
  if (link !== undefined) updates.link = link;
  if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
  if (capaUrl !== undefined) updates.capaUrl = capaUrl;
  if (tipoConta !== undefined) updates.tipoConta = tipoConta;
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

  const posts = await db.select().from(postsTable).where(eq(postsTable.autorId, user.id)).orderBy(sql`${postsTable.criadoEm} DESC`).limit(30);

  const result = posts.map(p => ({
    id: p.id,
    autor: { id: user.id, username: user.username, nomeExibicao: user.nomeExibicao, avatarUrl: user.avatarUrl, verificado: user.verificado, tipoConta: user.tipoConta, estaASeguir: false, segueVoce: false, totalSeguidores: 0 },
    legenda: p.legenda,
    localizacao: p.localizacao,
    tipo: p.tipo,
    media: [],
    exclusivo: p.exclusivo,
    precoDesbloqueio: p.precoDesbloqueio ? parseFloat(p.precoDesbloqueio) : null,
    totalCurtidas: 0,
    totalComentarios: 0,
    curtido: false,
    guardado: false,
    criadoEm: p.criadoEm.toISOString(),
  }));

  res.json({ posts: result, total: result.length, page: 1, hasMore: false });
});

// Reels do utilizador
router.get("/users/:username/reels", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = Array.isArray(req.params.username) ? req.params.username[0] : req.params.username;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, raw.toLowerCase()));
  if (!user) { res.status(404).json({ error: "Não encontrado" }); return; }

  res.json({ reels: [], page: 1, hasMore: false });
});

export default router;
