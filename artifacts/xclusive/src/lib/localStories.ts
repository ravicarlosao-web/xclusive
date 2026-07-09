import { Story } from '@workspace/api-client-react';

/**
 * Local-only stories for the current session (DB-less / mock mode).
 * Mirrors the pattern used for local posts: media is stored as an object
 * URL (`URL.createObjectURL()`), so it survives page navigation but not a
 * full page reload.
 */
const LOCAL_STORIES_KEY = 'xclusive_local_stories';
const VIEWED_STORIES_KEY = 'xclusive_viewed_stories';
const STORY_TTL_MS = 1000 * 60 * 60 * 24; // 24h, like real stories

interface StoredLocalStory {
  id: number;
  userId: number;
  mediaUrl: string;
  tipo: 'imagem' | 'video';
  criadoEm: string;
}

function readAll(): StoredLocalStory[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_STORIES_KEY) || '[]') as StoredLocalStory[];
    const cutoff = Date.now() - STORY_TTL_MS;
    return raw.filter(s => new Date(s.criadoEm).getTime() > cutoff);
  } catch {
    return [];
  }
}

function writeAll(stories: StoredLocalStory[]) {
  localStorage.setItem(LOCAL_STORIES_KEY, JSON.stringify(stories));
}

export function getLocalStoriesForUser(userId: number): StoredLocalStory[] {
  return readAll().filter(s => s.userId === userId).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
}

export function addLocalStory(userId: number, mediaUrl: string, tipo: 'imagem' | 'video'): StoredLocalStory {
  const all = readAll();
  const story: StoredLocalStory = {
    id: Date.now(),
    userId,
    mediaUrl,
    tipo,
    criadoEm: new Date().toISOString(),
  };
  writeAll([...all, story]);
  return story;
}

export function deleteLocalStory(storyId: number) {
  const all = readAll();
  const target = all.find(s => s.id === storyId);
  if (target?.mediaUrl.startsWith('blob:')) {
    URL.revokeObjectURL(target.mediaUrl);
  }
  writeAll(all.filter(s => s.id !== storyId));
}

export function localStoryToStory(s: StoredLocalStory, autor: Story['autor']): Story {
  return {
    id: s.id,
    autor,
    mediaUrl: s.mediaUrl,
    tipo: s.tipo,
    duracao: 5,
    audiencia: 'todos',
    expirado: false,
    visto: true,
    totalVisualizacoes: 0,
    expiraEm: new Date(new Date(s.criadoEm).getTime() + STORY_TTL_MS).toISOString(),
    criadoEm: s.criadoEm,
  };
}

// ─── Viewed tracking (so the pink "unseen" ring turns gray after viewing) ───

function readViewed(): number[] {
  try { return JSON.parse(localStorage.getItem(VIEWED_STORIES_KEY) || '[]'); } catch { return []; }
}

export function markStoryViewed(storyId: number) {
  const viewed = readViewed();
  if (!viewed.includes(storyId)) {
    localStorage.setItem(VIEWED_STORIES_KEY, JSON.stringify([...viewed, storyId]));
  }
}

export function isStoryViewed(storyId: number): boolean {
  return readViewed().includes(storyId);
}
