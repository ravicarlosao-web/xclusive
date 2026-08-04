import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";
import { db, revokedTokensTable, usersTable } from "@workspace/db";
import { eq, lt } from "drizzle-orm";

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

/**
 * Revoga um token pelo jti. Limpa tokens expirados ~1% das vezes.
 */
export async function revokeToken(jti: string, userId: number, expiresAt: Date): Promise<void> {
  await db.insert(revokedTokensTable).values({ jti, userId, expiresAt });
  // Limpeza periódica de tokens expirados
  if (Math.random() < 0.01) {
    await db.delete(revokedTokensTable).where(lt(revokedTokensTable.expiresAt, new Date()));
  }
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
