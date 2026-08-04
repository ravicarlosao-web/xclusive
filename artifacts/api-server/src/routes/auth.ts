import { Router, type Response } from "express";
import { db, usersTable, followsTable, revokedTokensTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  signAccessToken, signRefreshToken, verifyToken,
  hashPassword, comparePassword, requireAuth, revokeToken,
  REFRESH_COOKIE, type AuthRequest, type JwtPayload,
} from "../lib/auth";
import { validate } from "../lib/validate";

// ── Cookie helpers ────────────────────────────────────────────────────────────
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api/auth",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, COOKIE_OPTS);
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { ...COOKIE_OPTS, maxAge: 0 });
}

const router = Router();

const registerSchema = z.object({
  nomeCompleto: z.string().min(2, "Nome deve ter pelo menos 2 caracteres").max(100),
  email: z.email("Email inválido").max(255),
  username: z
    .string()
    .min(3, "Username deve ter pelo menos 3 caracteres")
    .max(50)
    .regex(/^[a-zA-Z0-9_]+$/, "Username só pode conter letras, números e _"),
  password: z.string().min(8, "Password deve ter pelo menos 8 caracteres").max(128),
  dataNascimento: z.string().max(20).optional(),
  tipoConta: z.enum(["pessoal", "criador"]).optional(),
  pais: z.string().max(10).optional(),
  telefone: z.string().max(20).optional(),
});

const loginSchema = z.object({
  email: z.string().min(1, "Email ou username é obrigatório").max(255),
  password: z.string().min(1, "Password é obrigatória").max(128),
});

router.post("/auth/register", validate(registerSchema), async (req, res): Promise<void> => {
  const { nomeCompleto, email, username, password, dataNascimento, tipoConta } = req.body;

  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (existing) {
      res.status(400).json({ error: "Email ou username já em uso" });
      return;
    }

    const [existingUsername] = await db.select().from(usersTable).where(eq(usersTable.username, username));
    if (existingUsername) {
      res.status(400).json({ error: "Email ou username já em uso" });
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

    const accessToken = signAccessToken({ userId: user.id, username: user.username, role: user.role });
    const { token: refreshToken } = signRefreshToken(user.id, user.username, user.role);
    setRefreshCookie(res, refreshToken);

    res.status(201).json({
      token: accessToken,
      user: formatUser(user, 0, 0, 0),
    });
  } catch (err) {
    (req as any).log?.error({ err }, "Register: erro interno");
    res.status(500).json({ error: "Erro interno." });
  }
});

router.post("/auth/login", validate(loginSchema), async (req, res): Promise<void> => {
  const { email, password } = req.body;

  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase()));
    if (!user) {
      const [byUsername] = await db.select().from(usersTable).where(eq(usersTable.username, email.toLowerCase()));
      if (!byUsername) {
        res.status(401).json({ error: "Credenciais inválidas" });
        return;
      }
      const valid = await comparePassword(password, byUsername.passwordHash);
      if (!valid) { res.status(401).json({ error: "Credenciais inválidas" }); return; }
      const accessToken = signAccessToken({ userId: byUsername.id, username: byUsername.username, role: byUsername.role });
      const { token: refreshToken } = signRefreshToken(byUsername.id, byUsername.username, byUsername.role);
      setRefreshCookie(res, refreshToken);
      const [{ seguidores }] = await db.select({ seguidores: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidoId, byUsername.id));
      const [{ seguindo }] = await db.select({ seguindo: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidorId, byUsername.id));
      res.json({ token: accessToken, user: formatUser(byUsername, 0, seguidores || 0, seguindo || 0) });
      return;
    }

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Credenciais inválidas" });
      return;
    }

    const accessToken = signAccessToken({ userId: user.id, username: user.username, role: user.role });
    const { token: refreshToken } = signRefreshToken(user.id, user.username, user.role);
    setRefreshCookie(res, refreshToken);
    const [{ seguidores }] = await db.select({ seguidores: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidoId, user.id));
    const [{ seguindo }] = await db.select({ seguindo: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidorId, user.id));
    const [{ posts }] = await db.select({ posts: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.id, user.id));

    res.json({ token: accessToken, user: formatUser(user, posts || 0, seguidores || 0, seguindo || 0) });
  } catch (err) {
    (req as any).log?.error({ err }, "Login: erro interno");
    res.status(500).json({ error: "Erro interno." });
  }
});

// Logout não exige access token válido — aceita dois caminhos:
//   (a) access token presente e válido → revoga-o + revoga o refresh cookie
//   (b) access token ausente ou expirado → revoga apenas o refresh cookie
// Isto garante que um utilizador com o access token expirado (ou nenhum)
// consegue sempre invalidar o refresh token de 7 dias.
router.post("/auth/logout", async (req: AuthRequest, res): Promise<void> => {
  // Caminho (a): tentar revogar o access token se presente e válido
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const payload = verifyToken(authHeader.slice(7)) as JwtPayload;
      if (payload.type !== "refresh") {
        const expiresAt = payload.exp
          ? new Date(payload.exp * 1000)
          : new Date(Date.now() + 15 * 60 * 1000);
        await revokeToken(payload.jti, payload.userId, expiresAt);
      }
    } catch {
      // Token inválido ou expirado — ignorar; prosseguir com revogação do refresh
    }
  }

  // Caminho (b): revogar o refresh token do cookie (sempre, independente do access token)
  const refreshToken = (req as any).cookies?.[REFRESH_COOKIE];
  if (refreshToken) {
    try {
      const payload = verifyToken(refreshToken) as JwtPayload;
      if (payload.type === "refresh" && payload.jti) {
        const expiresAt = payload.exp
          ? new Date(payload.exp * 1000)
          : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await revokeToken(payload.jti, payload.userId, expiresAt);
      }
    } catch (err) {
      (req as any).log?.warn({ err }, "Logout: falha ao revogar refresh token");
    }
  }

  clearRefreshCookie(res);
  res.json({ ok: true });
});

router.post("/auth/refresh", async (req, res): Promise<void> => {
  const refreshToken = (req as any).cookies?.[REFRESH_COOKIE];
  if (!refreshToken) {
    res.status(401).json({ error: "Sessão expirada. Faz login novamente." });
    return;
  }

  let payload: JwtPayload;
  try {
    payload = verifyToken(refreshToken);
  } catch {
    clearRefreshCookie(res);
    res.status(401).json({ error: "Sessão inválida. Faz login novamente." });
    return;
  }

  if (payload.type !== "refresh") {
    clearRefreshCookie(res);
    res.status(401).json({ error: "Token inválido." });
    return;
  }

  // Rotação atómica: INSERT … ON CONFLICT DO NOTHING elimina a race condition.
  //
  // Dois pedidos simultâneos com o mesmo refresh token competem pelo mesmo JTI:
  //   • o Postgres garante que só um INSERT tem sucesso (constraint única em jti)
  //   • quem ganhou (inserted.length === 1) → revokeToken retorna true → emite novos tokens
  //   • quem perdeu (conflito)              → revokeToken retorna false → rejeitado com 401
  //
  // Qualquer falha de DB aborta o pedido — nunca emitir tokens sem revogar (fail-closed).
  let wasRevoked: boolean;
  try {
    const expiresAt = payload.exp
      ? new Date(payload.exp * 1000)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    wasRevoked = await revokeToken(payload.jti, payload.userId, expiresAt);
  } catch (err) {
    (req as any).log?.warn({ err }, "Refresh: falha de DB ao revogar token — a negar (fail-closed)");
    res.status(503).json({ error: "Serviço temporariamente indisponível." });
    return;
  }

  if (!wasRevoked) {
    // JTI já estava na tabela: token já foi consumido → possível replay
    clearRefreshCookie(res);
    res.status(401).json({ error: "Sessão terminada. Faz login novamente." });
    return;
  }

  const newAccessToken = signAccessToken({ userId: payload.userId, username: payload.username!, role: payload.role });
  const { token: newRefreshToken } = signRefreshToken(payload.userId, payload.username!, payload.role);
  setRefreshCookie(res, newRefreshToken);
  res.json({ token: newAccessToken });
});

router.get("/auth/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) { res.status(401).json({ error: "Utilizador não encontrado" }); return; }

    const [{ seguidores }] = await db.select({ seguidores: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidoId, user.id));
    const [{ seguindo }] = await db.select({ seguindo: sql<number>`count(*)::int` }).from(followsTable).where(eq(followsTable.seguidorId, user.id));

    res.json(formatUser(user, 0, seguidores || 0, seguindo || 0));
  } catch (err) {
    (req as any).log?.error({ err }, "Auth/me: erro interno");
    res.status(500).json({ error: "Erro interno." });
  }
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
