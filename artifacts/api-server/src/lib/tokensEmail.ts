/**
 * Tokens de uso único por email. O token tem 32 bytes aleatórios (base64url, 43 caracteres); na BD fica SÓ o hash SHA-256.
 * O consumo é atómico: um UPDATE condicional (não usado e não expirado) — dois pedidos com o mesmo token nunca passam ambos.
 */
import crypto from "node:crypto";
import { db, emailTokensTable, usersTable } from "@workspace/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

export const TIPO_RECUPERAR = "recuperar_password";
export const TIPO_VERIFICAR = "verificar_email";
export type TipoToken = typeof TIPO_RECUPERAR | typeof TIPO_VERIFICAR;
export const VALIDADE_RECUPERACAO_MIN = 60;
export const MAX_EMAILS_POR_ENDERECO_HORA = 3;
export const VALIDADE_VERIFICACAO_MIN = 60;
/** Intervalo mínimo entre dois emails de verificação para a mesma conta (contado na BD). */
export const INTERVALO_MIN_REENVIO_S = 60;

type Q = Pick<typeof db, "insert" | "update" | "select" | "delete">;

export const novoToken = (): string => crypto.randomBytes(32).toString("base64url");
export const hashToken = (token: string): string => crypto.createHash("sha256").update(token).digest("hex");
/** 32 bytes em base64url = 43 caracteres (recusa à partida o que não pode ser um token nosso). */
export const tokenComFormato = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{43}$/.test(t);

// Cada token tem uma FINALIDADE (`tipo`): todas as operações filtram por ela. Um token de recuperação nunca verifica email e
// um de verificação nunca redefine a palavra-passe.

/** Cria um token (válido 60 minutos) e invalida os pendentes do MESMO tipo desta conta. Devolve o token em claro (só para o email). */
async function criarToken(q: Q, tipo: TipoToken, validadeMin: number, p: { userId: number; email: string; ip?: string | null }): Promise<string> {
  const agora = new Date();
  await q.update(emailTokensTable).set({ expiraEm: agora })
    .where(and(eq(emailTokensTable.userId, p.userId), eq(emailTokensTable.tipo, tipo), isNull(emailTokensTable.usadoEm), gt(emailTokensTable.expiraEm, agora)));
  const token = novoToken();
  await q.insert(emailTokensTable).values({
    userId: p.userId, tipo, tokenHash: hashToken(token), email: p.email.toLowerCase(),
    expiraEm: new Date(agora.getTime() + validadeMin * 60_000), ip: (p.ip ?? "").slice(0, 45) || null,
  });
  return token;
}

/** Consome o token do `tipo` (uso único, atómico). Devolve o userId, ou null se for inválido, expirado, usado ou de outro tipo. */
async function consumirToken(q: Q, tipo: TipoToken, token: string, extra?: ReturnType<typeof sql>): Promise<number | null> {
  const agora = new Date();
  const [linha] = await q.update(emailTokensTable).set({ usadoEm: agora })
    .where(and(eq(emailTokensTable.tokenHash, hashToken(token)), eq(emailTokensTable.tipo, tipo), isNull(emailTokensTable.usadoEm), gt(emailTokensTable.expiraEm, agora), ...(extra ? [extra] : [])))
    .returning({ userId: emailTokensTable.userId });
  return linha?.userId ?? null;
}

async function invalidarTokens(q: Q, tipo: TipoToken, userId: number): Promise<void> {
  const agora = new Date();
  await q.update(emailTokensTable).set({ expiraEm: agora })
    .where(and(eq(emailTokensTable.userId, userId), eq(emailTokensTable.tipo, tipo), isNull(emailTokensTable.usadoEm), gt(emailTokensTable.expiraEm, agora)));
}

/** Quantos emails do `tipo` já foram pedidos para este endereço na última hora (contado na BD). */
async function pedidosNaUltimaHoraDe(q: Q, tipo: TipoToken, email: string): Promise<number> {
  const [r] = await q.select({ n: sql<number>`count(*)::int` }).from(emailTokensTable)
    .where(and(eq(emailTokensTable.email, email.toLowerCase()), eq(emailTokensTable.tipo, tipo), gt(emailTokensTable.criadoEm, new Date(Date.now() - 3_600_000))));
  return r?.n ?? 0;
}

// ── Recuperação de palavra-passe (comportamento da 6B, inalterado) ──
export const criarTokenRecuperacao = (q: Q, p: { userId: number; email: string; ip?: string | null }) => criarToken(q, TIPO_RECUPERAR, VALIDADE_RECUPERACAO_MIN, p);
export const consumirTokenRecuperacao = (q: Q, token: string) => consumirToken(q, TIPO_RECUPERAR, token);
export const invalidarTokensRecuperacao = (q: Q, userId: number) => invalidarTokens(q, TIPO_RECUPERAR, userId);
export const pedidosNaUltimaHora = (q: Q, email: string) => pedidosNaUltimaHoraDe(q, TIPO_RECUPERAR, email);

// ── Verificação de email ──
export const criarTokenVerificacao = (q: Q, p: { userId: number; email: string; ip?: string | null }) => criarToken(q, TIPO_VERIFICAR, VALIDADE_VERIFICACAO_MIN, p);
export const invalidarTokensVerificacao = (q: Q, userId: number) => invalidarTokens(q, TIPO_VERIFICAR, userId);
export const verificacoesNaUltimaHora = (q: Q, email: string) => pedidosNaUltimaHoraDe(q, TIPO_VERIFICAR, email);

/** Consome um token de verificação SÓ se o endereço para que foi enviado ainda é o email atual da conta (se o email mudou, o token morre). */
export const consumirTokenVerificacao = (q: Q, token: string) =>
  consumirToken(q, TIPO_VERIFICAR, token, sql`${emailTokensTable.email} = (select lower(${usersTable.email}) from ${usersTable} where ${usersTable.id} = ${emailTokensTable.userId})`);

/** Segundos que faltam até se poder pedir novo email de verificação para esta conta (0 = já pode). Contado na BD. */
export async function segundosAteReenvio(q: Q, userId: number): Promise<number> {
  // Calculado na própria BD (criado_em e now() no mesmo relógio e fuso): não depende do fuso do processo Node.
  const [r] = await q.select({ s: sql<number>`greatest(0, ceil(extract(epoch from (max(${emailTokensTable.criadoEm}) + make_interval(secs => ${INTERVALO_MIN_REENVIO_S}) - now()))))::int` }).from(emailTokensTable)
    .where(and(eq(emailTokensTable.userId, userId), eq(emailTokensTable.tipo, TIPO_VERIFICAR)));
  return r?.s ?? 0;
}

/** Retira o token acabado de criar (o email não saiu): não conta para os limites. */
export async function descartarToken(q: Q, token: string): Promise<void> {
  await q.delete(emailTokensTable).where(eq(emailTokensTable.tokenHash, hashToken(token)));
}

/**
 * Anula a verificação do email da conta e invalida os tokens de verificação pendentes.
 * QUALQUER fluxo (hoje inexistente) que altere o email de uma conta TEM de chamar isto na mesma transação.
 */
export async function anularVerificacaoEmail(q: Q, userId: number): Promise<void> {
  await q.update(usersTable).set({ emailVerificadoEm: null }).where(eq(usersTable.id, userId));
  await invalidarTokens(q, TIPO_VERIFICAR, userId);
}
