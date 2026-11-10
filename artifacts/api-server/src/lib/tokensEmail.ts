/**
 * Tokens de uso único por email. O token tem 32 bytes aleatórios (base64url, 43 caracteres); na BD fica SÓ o hash SHA-256.
 * O consumo é atómico: um UPDATE condicional (não usado e não expirado) — dois pedidos com o mesmo token nunca passam ambos.
 */
import crypto from "node:crypto";
import { db, emailTokensTable } from "@workspace/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

export const TIPO_RECUPERAR = "recuperar_password";
export const VALIDADE_RECUPERACAO_MIN = 60;
export const MAX_EMAILS_POR_ENDERECO_HORA = 3;

type Q = Pick<typeof db, "insert" | "update" | "select">;

export const novoToken = (): string => crypto.randomBytes(32).toString("base64url");
export const hashToken = (token: string): string => crypto.createHash("sha256").update(token).digest("hex");
/** 32 bytes em base64url = 43 caracteres (recusa à partida o que não pode ser um token nosso). */
export const tokenComFormato = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{43}$/.test(t);

/** Cria um token de recuperação (válido 60 minutos) e invalida os pendentes do mesmo tipo desta conta. Devolve o token em claro (só para o email). */
export async function criarTokenRecuperacao(q: Q, p: { userId: number; email: string; ip?: string | null }): Promise<string> {
  const agora = new Date();
  await q.update(emailTokensTable).set({ expiraEm: agora })
    .where(and(eq(emailTokensTable.userId, p.userId), eq(emailTokensTable.tipo, TIPO_RECUPERAR), isNull(emailTokensTable.usadoEm), gt(emailTokensTable.expiraEm, agora)));
  const token = novoToken();
  await q.insert(emailTokensTable).values({
    userId: p.userId, tipo: TIPO_RECUPERAR, tokenHash: hashToken(token), email: p.email.toLowerCase(),
    expiraEm: new Date(agora.getTime() + VALIDADE_RECUPERACAO_MIN * 60_000), ip: (p.ip ?? "").slice(0, 45) || null,
  });
  return token;
}

/** Consome o token (uso único, atómico). Devolve o userId, ou null se for inválido, expirado ou já usado. */
export async function consumirTokenRecuperacao(q: Q, token: string): Promise<number | null> {
  const agora = new Date();
  const [linha] = await q.update(emailTokensTable).set({ usadoEm: agora })
    .where(and(eq(emailTokensTable.tokenHash, hashToken(token)), eq(emailTokensTable.tipo, TIPO_RECUPERAR), isNull(emailTokensTable.usadoEm), gt(emailTokensTable.expiraEm, agora)))
    .returning({ userId: emailTokensTable.userId });
  return linha?.userId ?? null;
}

/** Invalida todos os tokens de recuperação pendentes da conta (depois de a palavra-passe ser alterada). */
export async function invalidarTokensRecuperacao(q: Q, userId: number): Promise<void> {
  const agora = new Date();
  await q.update(emailTokensTable).set({ expiraEm: agora })
    .where(and(eq(emailTokensTable.userId, userId), eq(emailTokensTable.tipo, TIPO_RECUPERAR), isNull(emailTokensTable.usadoEm), gt(emailTokensTable.expiraEm, agora)));
}

/** Quantos emails de recuperação já foram pedidos para este endereço na última hora (contado na BD). */
export async function pedidosNaUltimaHora(q: Q, email: string): Promise<number> {
  const [r] = await q.select({ n: sql<number>`count(*)::int` }).from(emailTokensTable)
    .where(and(eq(emailTokensTable.email, email.toLowerCase()), eq(emailTokensTable.tipo, TIPO_RECUPERAR), gt(emailTokensTable.criadoEm, new Date(Date.now() - 3_600_000))));
  return r?.n ?? 0;
}
