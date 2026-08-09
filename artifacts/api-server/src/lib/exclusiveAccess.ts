import { db, purchasesTable, subscriptionsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

/** Verifica se um utilizador pode ver o conteúdo exclusivo de um post. */
export async function temAcessoExclusivo(
  userId: number | undefined,
  autorId: number,
  postId: number,
): Promise<boolean> {
  if (userId === autorId) return true;
  if (!userId) return false;

  const [sub] = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.subscriitorId, userId),
        eq(subscriptionsTable.criadorId, autorId),
        eq(subscriptionsTable.estado, "ativa"),
      ),
    )
    .limit(1);
  if (sub) return true;

  const [ppv] = await db
    .select({ id: purchasesTable.id })
    .from(purchasesTable)
    .where(
      and(
        eq(purchasesTable.compradorId, userId),
        eq(purchasesTable.vendedorId, autorId),
        eq(purchasesTable.tipo, "ppv"),
        eq(purchasesTable.conteudoId, postId),
      ),
    )
    .limit(1);

  return !!ppv;
}