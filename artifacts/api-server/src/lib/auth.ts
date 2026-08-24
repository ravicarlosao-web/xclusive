import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { db, revokedTokensTable, usersTable, activeSessionsTable } from "@workspace/db";
import { eq, lt, asc, inArray } from "drizzle-orm";

const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}
const SECRET: string = JWT_SECRET;

export const REFRESH_COOKIE = "xclusive_refresh";

export interface JwtPayload {
  userId: number;
  username: string;
  role?: string;
  type?: "access" | "refresh";
  jti: string;
  iat?: number;
  exp?: number;
}

/** Access token — curta duração (15 min). */
export function signAccessToken(payload: Omit<JwtPayload, "jti" | "type">): string {
  return jwt.sign({ ...payload, type: "access", jti: randomUUID() }, SECRET, { expiresIn: "15m" });
}

/** Refresh token — longa duração (7 dias), armazenado em httpOnly cookie. */
export function signRefreshToken(userId: number, username: string, role?: string): { token: string; jti: string } {
  const jti = randomUUID();
  const token = jwt.sign({ userId, username, role, type: "refresh", jti }, SECRET, { expiresIn: "7d" });
  return { token, jti };
}

/** @deprecated Usar signAccessToken. Mantido para compatibilidade. */
export const signToken = signAccessToken;

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, SECRET) as JwtPayload;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ── Gestão de sessões activas ─────────────────────────────────────────────────

const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS_PER_USER ?? "10", 10);

/**
 * Regista uma nova sessão activa e aplica o limite por utilizador.
 * Se o número de sessões ultrapassar MAX_SESSIONS, as mais antigas são
 * eliminadas (política LRU por data de criação).
 */
export async function createSession(
  userId: number,
  refreshJti: string,
  expiresAt: Date,
  userAgent?: string,
  ip?: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(activeSessionsTable).values({
      userId,
      refreshJti,
      expiresAt,
      userAgent: userAgent ?? null,
      ip: ip ?? null,
    });

    if (MAX_SESSIONS > 0) {
      const sessions = await tx
        .select({ id: activeSessionsTable.id })
        .from(activeSessionsTable)
        .where(eq(activeSessionsTable.userId, userId))
        .orderBy(asc(activeSessionsTable.criadaEm));

      if (sessions.length > MAX_SESSIONS) {
        const toEvict = sessions.slice(0, sessions.length - MAX_SESSIONS);
        await tx
          .delete(activeSessionsTable)
          .where(inArray(activeSessionsTable.id, toEvict.map((s) => s.id)));
      }
    }
  });
}

/** Remove a sessão associada a um refresh JTI (logout de um dispositivo). */
export async function deleteSession(refreshJti: string): Promise<void> {
  await db.delete(activeSessionsTable).where(eq(activeSessionsTable.refreshJti, refreshJti));
}

/**
 * Remove todas as sessões do utilizador e devolve os JTIs + expiresAt de cada
 * uma para que o chamador os possa inserir em revoked_tokens.
 */
export async function deleteAllUserSessions(
  userId: number,
): Promise<{ jti: string; expiresAt: Date }[]> {
  const sessions = await db
    .select({ jti: activeSessionsTable.refreshJti, expiresAt: activeSessionsTable.expiresAt })
    .from(activeSessionsTable)
    .where(eq(activeSessionsTable.userId, userId));

  if (sessions.length > 0) {
    await db.delete(activeSessionsTable).where(eq(activeSessionsTable.userId, userId));
  }

  return sessions;
}

/**
 * Revoga um token pelo jti de forma atómica (INSERT … ON CONFLICT DO NOTHING).
 *
 * Retorna:
 *   true  — token revogado agora (primeira vez que este jti é revogado).
 *   false — JTI já estava na tabela; indica replay de um token já consumido.
 *
 * Lança em caso de falha de DB — o chamador deve tratar como falha fechada (fail-closed).
 * Limpa tokens expirados ~1% das vezes como side-effect.
 */
export async function revokeToken(jti: string, userId: number, expiresAt: Date): Promise<boolean> {
  const inserted = await db
    .insert(revokedTokensTable)
    .values({ jti, userId, expiresAt })
    .onConflictDoNothing()
    .returning({ jti: revokedTokensTable.jti });

  // Limpeza periódica de tokens expirados (não afecta o resultado)
  if (Math.random() < 0.01) {
    await db.delete(revokedTokensTable).where(lt(revokedTokensTable.expiresAt, new Date()));
  }

  return inserted.length === 1; // true = revogado agora; false = já existia (possível replay)
}

export interface AuthRequest extends Request {
  userId?: number;
  username?: string;
  tokenJti?: string;
  tokenExp?: number;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  const token = authHeader.slice(7);
  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({ error: "Token inválido" });
    return;
  }

  // Rejeitar refresh tokens usados como access tokens
  if (payload.type === "refresh") {
    res.status(401).json({ error: "Token inválido" });
    return;
  }

  try {
    // Verificar revogação e estado da conta em paralelo (1 query cada)
    const [revokedRows, userRows] = await Promise.all([
      db.select({ jti: revokedTokensTable.jti })
        .from(revokedTokensTable)
        .where(eq(revokedTokensTable.jti, payload.jti))
        .limit(1),
      db.select({ ativo: usersTable.ativo })
        .from(usersTable)
        .where(eq(usersTable.id, payload.userId))
        .limit(1),
    ]);

    if (revokedRows[0]) {
      res.status(401).json({ error: "Sessão terminada. Faz login novamente." });
      return;
    }
    if (!userRows[0] || !userRows[0].ativo) {
      res.status(401).json({ error: "Conta suspensa ou não encontrada." });
      return;
    }
  } catch (err) {
    req.log?.warn({ err }, "DB indisponível durante verificação de auth — a negar pedido (fail-closed)");
    res.status(503).json({ error: "Serviço temporariamente indisponível." });
    return;
  }

  req.userId = payload.userId;
  req.username = payload.username;
  req.tokenJti = payload.jti;
  req.tokenExp = payload.exp;
  next();
}

/**
 * Middleware que verifica se o utilizador autenticado tem tipoConta === 'criador'.
 * Deve ser usado DEPOIS de requireAuth (assume req.userId já definido).
 * Retorna 403 para qualquer utilizador que não seja criador.
 */
export async function requireCreator(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const [user] = await db.select({ tipoConta: usersTable.tipoConta, verificado: usersTable.verificado })
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!))
      .limit(1);

    if (!user || user.tipoConta !== "criador") {
      res.status(403).json({ error: "Acesso reservado a criadores." });
      return;
    }
    
    if (!user.verificado) {
      res.status(403).json({ error: "A tua conta de criador ainda está pendente de aprovação. Aguarda a revisão do administrador." });
      return;
    }
  } catch (err) {
    req.log?.warn({ err }, "DB indisponível durante verificação de requireCreator — a negar pedido (fail-closed)");
    res.status(503).json({ error: "Serviço temporariamente indisponível." });
    return;
  }
  next();
}

export async function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const payload = verifyToken(authHeader.slice(7));
      // Ignorar token revogado silenciosamente
      const [revoked] = await db.select({ jti: revokedTokensTable.jti })
        .from(revokedTokensTable)
        .where(eq(revokedTokensTable.jti, payload.jti))
        .limit(1);
      if (!revoked) {
        req.userId = payload.userId;
        req.username = payload.username;
        req.tokenJti = payload.jti;
      }
    } catch {
      // ignore — token inválido ou DB indisponível
    }
  }
  next();
}
