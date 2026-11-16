/**
 * Token de pré-autenticação do 2.º passo (TOTP): emitido SÓ depois da palavra-passe certa de uma conta com TOTP ativo; vale 5 min e serve uma única vez, só em
 * POST /admin/auth/login/totp. NÃO é uma sessão.
 *
 * É assinado com uma chave DERIVADA (HMAC-SHA256 do SESSION_SECRET com uma etiqueta própria), não com o próprio SESSION_SECRET. Assim, qualquer verificação de sessão do resto
 * da API (requireAuth, requireAdmin, sockets, limitadores…) recusa-o por assinatura inválida, em vez de depender de cada uma conferir o campo `type`
 * (o requireAuth dos utilizadores só recusa `type === "refresh"`).
 * Uso único: o jti fica em revoked_tokens quando o 2.º passo tem sucesso; um token já usado é recusado.
 */
import jwt from "jsonwebtoken";
import { createHmac, randomUUID } from "node:crypto";
import { db, revokedTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const PREAUTH_TTL_SEGUNDOS = 5 * 60;
const FINALIDADE = "totp";

const chave = (): Buffer => {
  const segredo = process.env.SESSION_SECRET;
  if (!segredo) throw new Error("SESSION_SECRET environment variable is required");
  return createHmac("sha256", segredo).update("xclusive|admin-totp|pre-auth|v1").digest();
};

export function assinarPreAuth(userId: number): { token: string; jti: string } {
  const jti = randomUUID();
  const token = jwt.sign({ userId, jti, finalidade: FINALIDADE }, chave(), { algorithm: "HS256", expiresIn: PREAUTH_TTL_SEGUNDOS });
  return { token, jti };
}

export interface PreAuthValido { userId: number; jti: string; exp: number }

/** O conteúdo do token, ou null se estiver inválido, expirado, adulterado ou não for de finalidade «totp». */
export function lerPreAuth(token: unknown): PreAuthValido | null {
  if (typeof token !== "string" || token.length < 20 || token.length > 2000) return null;
  try {
    const p = jwt.verify(token, chave(), { algorithms: ["HS256"] }) as { userId?: unknown; jti?: unknown; finalidade?: unknown; exp?: unknown };
    if (p.finalidade !== FINALIDADE || !Number.isInteger(p.userId) || typeof p.jti !== "string" || typeof p.exp !== "number") return null;
    return { userId: p.userId as number, jti: p.jti, exp: p.exp };
  } catch {
    return null;
  }
}

export async function preAuthJaUsado(jti: string): Promise<boolean> {
  const [linha] = await db.select({ jti: revokedTokensTable.jti }).from(revokedTokensTable).where(eq(revokedTokensTable.jti, jti)).limit(1);
  return !!linha;
}

/** Marca como usado (atómico): false se alguém o usou entretanto. */
export async function consumirPreAuth(p: PreAuthValido): Promise<boolean> {
  const r = await db.insert(revokedTokensTable).values({ jti: p.jti, userId: p.userId, expiresAt: new Date(p.exp * 1000) }).onConflictDoNothing().returning({ jti: revokedTokensTable.jti });
  return r.length === 1;
}
