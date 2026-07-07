import { db, usersTable, followsTable, likesTable, savedPostsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

export async function getUserSummary(userId: number, viewerId?: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return null;

  let estaASeguir = false;
  let segueVoce = false;

  if (viewerId && viewerId !== userId) {
    const [follow] = await db
      .select()
      .from(followsTable)
      .where(and(eq(followsTable.seguidorId, viewerId), eq(followsTable.seguidoId, userId)));
    estaASeguir = !!follow;

    const [followBack] = await db
      .select()
      .from(followsTable)
      .where(and(eq(followsTable.seguidorId, userId), eq(followsTable.seguidoId, viewerId)));
    segueVoce = !!followBack;
  }

  const [{ count: seguidores }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(followsTable)
    .where(eq(followsTable.seguidoId, userId));

  return {
    id: user.id,
    username: user.username,
    nomeExibicao: user.nomeExibicao,
    avatarUrl: user.avatarUrl,
    verificado: user.verificado,
    tipoConta: user.tipoConta,
    estaASeguir,
    segueVoce,
    totalSeguidores: seguidores,
  };
}

export async function isPostLiked(postId: number, userId?: number): Promise<boolean> {
  if (!userId) return false;
  const [like] = await db
    .select()
    .from(likesTable)
    .where(and(eq(likesTable.utilizadorId, userId), eq(likesTable.alvoTipo, "post"), eq(likesTable.alvoId, postId)));
  return !!like;
}

export async function isPostSaved(postId: number, userId?: number): Promise<boolean> {
  if (!userId) return false;
  const [saved] = await db
    .select()
    .from(savedPostsTable)
    .where(and(eq(savedPostsTable.utilizadorId, userId), eq(savedPostsTable.postId, postId)));
  return !!saved;
}

export async function isReelLiked(reelId: number, userId?: number): Promise<boolean> {
  if (!userId) return false;
  const [like] = await db
    .select()
    .from(likesTable)
    .where(and(eq(likesTable.utilizadorId, userId), eq(likesTable.alvoTipo, "reel"), eq(likesTable.alvoId, reelId)));
  return !!like;
}
