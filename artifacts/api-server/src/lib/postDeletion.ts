import { and, eq } from "drizzle-orm";
import { db, likesTable, postMediaTable, postsTable } from "@workspace/db";
import { deleteFile, getStorageKeyFromPublicUrl } from "./storage";

/**
 * Removes all post-owned data and its Bunny media.
 *
 * post_media, comments and saved_posts have ON DELETE CASCADE constraints.
 * Likes use a polymorphic alvoId, so they must be removed explicitly.
 */
export async function deletePostWithMedia(postId: number): Promise<void> {
  const media = await db
    .select({ url: postMediaTable.url })
    .from(postMediaTable)
    .where(eq(postMediaTable.postId, postId));

  const storageKeys = media
    .map(({ url }) => getStorageKeyFromPublicUrl(url))
    .filter((key): key is string => Boolean(key));

  const storageResults = await Promise.allSettled(storageKeys.map((key) => deleteFile(key)));
  const failedStorageDeletes = storageResults.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  if (failedStorageDeletes.length > 0) {
    console.warn(`[Posts] ${failedStorageDeletes.length} media file(s) could not be deleted from Bunny Storage.`);
  }

  await db.delete(likesTable).where(and(
    eq(likesTable.alvoTipo, "post"),
    eq(likesTable.alvoId, postId),
  ));
  await db.delete(postsTable).where(eq(postsTable.id, postId));
}