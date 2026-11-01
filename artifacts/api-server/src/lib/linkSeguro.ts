/**
 * Link do perfil: só http:// e https:// (sem diferenciar maiúsculas). Usado ao guardar (schema) e ao DEVOLVER o perfil: links antigos
 * com outro esquema (javascript:, data:, file:…) saem como null, sem migração.
 */
export const LINK_PERFIL_MAX = 500;

export function linkSeguro(link: string | null | undefined): string | null {
  if (typeof link !== "string" || link === "" || link.length > LINK_PERFIL_MAX) return null;
  try {
    const u = new URL(link);
    return u.protocol === "http:" || u.protocol === "https:" ? link : null;
  } catch { return null; }
}
