import { and, eq, inArray, isNotNull, lte, or } from "drizzle-orm";
import { db, notificationsTable, subscriptionsTable, usersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Job de expiração de subscrições.
 *
 * SÓ muda o estado ('ativa'/'cancelada' → 'expirada') do que passou da data e cria a notificação a
 * perguntar se o utilizador quer renovar. NUNCA cobra nada: a renovação é sempre manual
 * (POST /subscriptions/:id/renovar).
 *
 * - Idempotente: o que já está 'expirada' deixa de ser selecionado; estado e notificação saem da
 *   mesma transação (sem notificações duplicadas nem perdidas).
 * - Seguro com várias instâncias: pg_try_advisory_xact_lock — só uma corre de cada vez; as outras saltam.
 * - O acesso já acaba na data certa mesmo sem o job (ver exclusiveAccess.subscricaoComAcesso).
 */
const ADVISORY_LOCK_KEY = 727_001_001;
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

export async function runSubscriptionExpiry(now: Date = new Date()): Promise<{ expiradas: number; notificadas: number } | null> {
  return db.transaction(async (tx) => {
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_KEY}) AS ok`);
    if (!(lock.rows[0] as { ok: boolean } | undefined)?.ok) return null; // outra instância está a correr

    const due = await tx
      .select({
        id: subscriptionsTable.id,
        subscritorId: subscriptionsTable.subscriitorId,
        criadorId: subscriptionsTable.criadorId,
        estado: subscriptionsTable.estado,
      })
      .from(subscriptionsTable)
      .where(and(
        or(eq(subscriptionsTable.estado, "ativa"), eq(subscriptionsTable.estado, "cancelada")),
        isNotNull(subscriptionsTable.renovacaoEm),
        lte(subscriptionsTable.renovacaoEm, now),
      ))
      .for("update", { skipLocked: true });

    if (due.length === 0) return { expiradas: 0, notificadas: 0 };

    await tx.update(subscriptionsTable).set({ estado: "expirada" }).where(inArray(subscriptionsTable.id, due.map((d) => d.id)));

    // Notifica só quem NÃO cancelou (quem cancelou escolheu sair).
    const toNotify = due.filter((d) => d.estado === "ativa");
    if (toNotify.length > 0) {
      const creators = await tx
        .select({ id: usersTable.id, username: usersTable.username })
        .from(usersTable)
        .where(inArray(usersTable.id, [...new Set(toNotify.map((d) => d.criadorId))]));
      const usernameById = new Map(creators.map((c) => [c.id, c.username]));
      await tx.insert(notificationsTable).values(toNotify.map((d) => ({
        destinatarioId: d.subscritorId,
        tipo: "sistema" as const,
        atorId: d.criadorId,
        alvoId: d.id,
        mensagem: `A tua subscrição de @${usernameById.get(d.criadorId) ?? "criador"} terminou e o acesso ao conteúdo exclusivo foi desativado. Queres renovar? Abre /perfil/${usernameById.get(d.criadorId) ?? ""} e toca em Renovar.`,
      })));
    }
    return { expiradas: due.length, notificadas: toNotify.length };
  });
}

/** Arranca o job no próprio processo da API (sem processo novo). Chamado uma vez em index.ts. */
export function startSubscriptionExpiryJob(): void {
  const intervalMs = Number(process.env.SUBSCRIPTION_EXPIRY_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  const tick = () => {
    runSubscriptionExpiry()
      .then((r) => { if (r && r.expiradas > 0) logger.info(r, "Subscrições expiradas"); })
      .catch((err) => logger.error({ err }, "Falha no job de expiração de subscrições"));
  };
  tick();
  setInterval(tick, intervalMs).unref();
}
