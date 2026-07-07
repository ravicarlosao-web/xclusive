import { Router } from "express";
import { db, usersTable, followsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { signToken, hashPassword, comparePassword, requireAuth, type AuthRequest } from "../lib/auth";

const router = Router();

router.post("/auth/register", async (req, res): Promise<void> => {
  const { nomeCompleto, email, username, password, dataNascimento, tipoConta } = req.body;

  if (!nomeCompleto || !email || !username || !password) {
    res.status(400).json({ error: "Campos obrigatórios em falta" });
    return;
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(400).json({ error: "Email já em uso" });
    return;
  }

  const [existingUsername] = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (existingUsername) {
    res.status(400).json({ error: "Username já em uso" });
    return;
  }

  const passwordHash = await hashPassword(password);

  const [user] = await db.insert(usersTable).values({
    nomeExibicao: nomeCompleto,
    email,
    username: username.toLowerCase(),
    passwordHash,
    dataNascimento: dataNascimento || null,
    tipoConta: tipoConta || "pessoal",
  }).returning();

  const token = signToken({ userId: user.id, username: user.username });

  res.status(201).json({
    token,
    user: formatUser(user, 0, 0, 0),
  });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: "Email e password são obrigatórios" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
  if (!user) {
    const [byUsername] = await db.select().from(usersTable).where(eq(usersTable.username, email.toLowerCase()));
    if (!byUsername) {
      res.status(401).json({ error: "Credenciais inválidas" });
      return;
    }
    const valid = await comparePassword(password, byUsername.passwordHash);
    if (!valid) { res.status(401).json({ error: "Credenciais inválidas" }); return; }
    const token = signToken({ userId: byUsername.id, username: byUsername.username });
    const [{ seguidores }] = await db.select({ seguidores: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidoId, byUsername.id));
    const [{ seguindo }] = await db.select({ seguindo: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidorId, byUsername.id));
    res.json({ token, user: formatUser(byUsername, 0, seguidores || 0, seguindo || 0) });
    return;
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Credenciais inválidas" });
    return;
  }

  const token = signToken({ userId: user.id, username: user.username });
  const [{ seguidores }] = await db.select({ seguidores: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidoId, user.id));
  const [{ seguindo }] = await db.select({ seguindo: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidorId, user.id));
  const [{ posts }] = await db.select({ posts: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.id, user.id));

  res.json({ token, user: formatUser(user, posts || 0, seguidores || 0, seguindo || 0) });
});

router.post("/auth/logout", (_req, res): void => {
  res.json({ ok: true });
});

router.get("/auth/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(401).json({ error: "Utilizador não encontrado" }); return; }

  const [{ seguidores }] = await db.select({ seguidores: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidoId, user.id));
  const [{ seguindo }] = await db.select({ seguindo: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidorId, user.id));

  res.json(formatUser(user, 0, seguidores || 0, seguindo || 0));
});

function formatUser(user: any, totalPublicacoes: number, totalSeguidores: number, totalSeguindo: number) {
  return {
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
    totalSeguidores,
    totalSeguindo,
    totalPublicacoes,
    estaASeguir: false,
    segueVoce: false,
    criadoEm: user.criadoEm?.toISOString?.() || new Date().toISOString(),
  };
}

export default router;
