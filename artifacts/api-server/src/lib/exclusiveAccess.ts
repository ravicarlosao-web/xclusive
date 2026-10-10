import { db, purchasesTable, subscriptionsTable } from "@workspace/db";
import { and, eq, gt, isNull, or } from "drizzle-orm";

/**
 * Condição SQL única de "subscrição com acesso" (usada por posts, reels, stories e estatísticas):
 *  - 'ativa' sem data (conta gratuita, sem fim) ou com renovacao_em > agora;
 *  - 'cancelada' mas dentro do período pago (renovacao_em > agora).
 * 'expirada' nunca dá acesso. A data é verificada aqui, por isso o acesso acaba na hora certa
 * mesmo que o job de expiração ainda não tenha corrido.
 */
export function subscricaoComAcesso(now: Date = new Date()) {
  return or(
    and(eq(subscriptionsTable.estado, "ativa"), or(isNull(subscriptionsTable.renovacaoEm), gt(subscriptionsTable.renovacaoEm, now))),
    and(eq(subscriptionsTable.estado, "cancelada"), gt(subscriptionsTable.renovacaoEm, now)),
  );
}

/** O utilizador tem (ou é o próprio) subscrição com acesso ao conteúdo deste criador? */
export async function temSubscricaoAtiva(
  userId: number | undefined,
  criadorId: number,
  now: Date = new Date(),
): Promise<boolean> {
  if (userId === criadorId) return true;
  if (!userId) return false;
  const [sub] = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(and(
      eq(subscriptionsTable.subscriitorId, userId),
      eq(subscriptionsTable.criadorId, criadorId),
      subscricaoComAcesso(now),
    ))
    .limit(1);
  return !!sub;
}

/** Verifica se um utilizador pode ver o conteúdo exclusivo de um post. */
export async function temAcessoExclusivo(
  userId: number | undefined,
  autorId: number,
  postId: number,
): Promise<boolean> {
  if (userId === autorId) return true;
  if (!userId) return false;

  if (await temSubscricaoAtiva(userId, autorId)) return true;

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