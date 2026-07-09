import { Comment, UserSummary } from '@workspace/api-client-react';

/**
 * Local-only comments (DB-less / mock mode), persisted per post in localStorage.
 * Mirrors the pattern used for local stories (`localStories.ts`).
 */
const LOCAL_COMMENTS_KEY = 'xclusive_local_comments';

interface StoredLocalComment {
  id: number;
  postId: number;
  autor: UserSummary;
  texto: string;
  criadoEm: string;
}

function readAll(): StoredLocalComment[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_COMMENTS_KEY) || '[]') as StoredLocalComment[];
  } catch {
    return [];
  }
}

function writeAll(comments: StoredLocalComment[]) {
  localStorage.setItem(LOCAL_COMMENTS_KEY, JSON.stringify(comments));
}

export function getLocalCommentsForPost(postId: number): Comment[] {
  return readAll()
    .filter(c => c.postId === postId)
    .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))
    .map(localCommentToComment);
}

export function addLocalComment(postId: number, texto: string, autor: UserSummary): Comment {
  const all = readAll();
  const comment: StoredLocalComment = {
    id: Date.now(),
    postId,
    autor,
    texto,
    criadoEm: new Date().toISOString(),
  };
  writeAll([...all, comment]);
  return localCommentToComment(comment);
}

export function deleteLocalComment(commentId: number) {
  writeAll(readAll().filter(c => c.id !== commentId));
}

function localCommentToComment(c: StoredLocalComment): Comment {
  return {
    id: c.id,
    autor: c.autor,
    texto: c.texto,
    comentarioPaiId: null,
    respostas: [],
    totalCurtidas: 0,
    curtido: false,
    criadoEm: c.criadoEm,
  };
}
