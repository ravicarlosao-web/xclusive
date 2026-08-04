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

export interface JwtPayload {
  userId: number;
  username: string;
  jti: string;
  iat?: number;
  exp?: number;
}

export function signToken(payload: Omit<JwtPayload, "jti">): string {
  return jwt.sign({ ...payload, jti: randomUUID() }, SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, SECRET) as JwtPayload;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
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
