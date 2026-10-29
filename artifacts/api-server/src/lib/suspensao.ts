import { and, eq } from "drizzle-orm";
import { db, usersTable, activeSessionsTable, revokedTokensTable, auditLogTable } from "@workspace/db";
import { getIO } from "./socket";
import { logger } from "./logger";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Mensagem devolvida pelo login/refresh a uma conta suspensa (o ecrã acrescenta o contacto). */
export const MSG_CONTA_SUSPENSA = "A tua conta está suspensa.";
export const CODIGO_CONTA_SUSPENSA = "conta_suspensa";

/**
 * Suspende uma conta. UMA só implementação para todos os caminhos (PATCH de estado, soft delete do admin
 * e suspensão por denúncia). Corre DENTRO da transação do chamador:
 *   1. ativo = false (só conta como "mudou" se estava ativa);
 *   2. apaga as linhas de active_sessions do utilizador;
 *   3. revoga os JTIs dos refresh tokens dessas sessões em revoked_tokens;
 *   4. regista um audit "user_sessions_revoked" com o nº de sessões revogadas (se houver admin).
 * As sessões são revogadas mesmo que a conta já estivesse suspensa. Reativar é só `ativo = true`.
 * Os sockets ligados desligam-se DEPOIS do commit (`desligarSockets`).
 */
export async function suspenderConta(
  tx: Tx,
  userId: number,
  ctx: { adminId: number | null; ip?: string | null; origem: "admin" | "eliminacao" | "denuncia" | "infracao_mais18" | "encerramento" },
): Promise<{ mudou: boolean; sessoesRevogadas: number }> {
  const alterada = await tx.update(usersTable).set({ ativo: false })
    .where(and(eq(usersTable.id, userId), eq(usersTable.ativo, true)))
    .returning({ id: usersTable.id });

  const sessoes = await tx.delete(activeSessionsTable).where(eq(activeSessionsTable.userId, userId))
    .returning({ jti: activeSessionsTable.refreshJti, expiresAt: activeSessionsTable.expiresAt });

  if (sessoes.length > 0) {
    await tx.insert(revokedTokensTable)
      .values(sessoes.map((s) => ({ jti: s.jti, userId, expiresAt: s.expiresAt })))
      .onConflictDoNothing();
  }

  if (ctx.adminId !== null) {
    await tx.insert(auditLogTable).values({
      adminId: ctx.adminId, action: "user_sessions_revoked", targetType: "user", targetId: userId,
      details: { sessoesRevogadas: sessoes.length, origem: ctx.origem },
      ipAddress: ctx.ip ?? null,
    });
  }
  return { mudou: alterada.length > 0, sessoesRevogadas: sessoes.length };
}

/** Desliga os sockets do utilizador (chamar DEPOIS do commit). Nunca lança: falhar aqui não pode desfazer a suspensão. */
export function desligarSockets(userId: number): void {
  try {
    void getIO().fetchSockets()
      .then((lista) => { for (const s of lista) if (s.data?.userId === userId) s.disconnect(true); })
      .catch((err) => logger.warn({ err }, "Suspensão: falha ao desligar sockets"));
  } catch {
    // Socket.io não inicializado (ex.: testes): nada a desligar.
  }
}

/** Para chamadores sem acesso ao commit (suspensão por denúncia, dentro de retirarAlvo): desliga um instante depois. */
export function desligarSocketsDepois(userId: number, ms = 1500): void {
  setTimeout(() => desligarSockets(userId), ms).unref?.();
}
