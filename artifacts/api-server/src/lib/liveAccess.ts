import { db, usersTable, liveTicketsTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";

export interface LiveAccessInfo {
  id: number;
  criadorId: number;
  tipo: "gratuita" | "paga";
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "superadmin";
}

/**
 * Regra única de acesso a uma live (verificada sempre na base de dados):
 *   - sem sessão                      → não
 *   - criadora                        → sim
 *   - gratuita                        → sim (qualquer utilizador com sessão)
 *   - paga: admin/superadmin          → sim
 *   - paga: tem bilhete dessa live    → sim
 */
export async function userHasLiveAccess(
  userId: number | undefined,
  live: LiveAccessInfo,
): Promise<boolean> {
  if (!userId) return false;
  if (userId === live.criadorId) return true;
  if (live.tipo === "gratuita") return true;

  const [[user], [ticket]] = await Promise.all([
    db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId)).limit(1),
    db
      .select({ id: liveTicketsTable.id })
      .from(liveTicketsTable)
      .where(and(eq(liveTicketsTable.liveId, live.id), eq(liveTicketsTable.userId, userId)))
      .limit(1),
  ]);
  return isAdminRole(user?.role) || !!ticket;
}

/** Versão em lote para listas: devolve o conjunto de IDs de lives a que o utilizador acede. */
export async function liveIdsWithAccess(
  userId: number | undefined,
  lives: LiveAccessInfo[],
): Promise<Set<number>> {
  const allowed = new Set<number>();
  if (!userId || lives.length === 0) return allowed;

  const paid = lives.filter((l) => l.tipo === "paga" && l.criadorId !== userId);
  for (const l of lives) {
    if (l.criadorId === userId || l.tipo === "gratuita") allowed.add(l.id);
  }
  if (paid.length === 0) return allowed;

  const [[user], tickets] = await Promise.all([
    db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId)).limit(1),
    db
      .select({ liveId: liveTicketsTable.liveId })
      .from(liveTicketsTable)
      .where(
        and(
          eq(liveTicketsTable.userId, userId),
          inArray(liveTicketsTable.liveId, paid.map((l) => l.id)),
        ),
      ),
  ]);
  if (isAdminRole(user?.role)) {
    for (const l of paid) allowed.add(l.id);
  } else {
    for (const t of tickets) allowed.add(t.liveId);
  }
  return allowed;
}
