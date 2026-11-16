/**
 * Armazenamento seguro: o ÚNICO sítio da app que toca em localStorage e sessionStorage (há um teste estático que o garante).
 *
 *  - Todos os acessos, incluindo o do próprio getter `window.localStorage` / `window.sessionStorage`, estão em try/catch: com o armazenamento
 *    bloqueado (SecurityError, modo privado antigo, cookies bloqueados, quota cheia) nada lança.
 *  - Fallback em memória, por área, enquanto a página não for recarregada: a sessão (token) e as escolhas ficam só em memória (ao recarregar,
 *    o utilizador volta a entrar). Com armazenamento a funcionar o comportamento é o de sempre, com as mesmas chaves.
 *  - Só texto (como o Web Storage). Quem guarda JSON faz JSON.stringify/parse (dentro do seu try/catch).
 */
type Area = 'local' | 'sessao';

const memoria: Record<Area, Map<string, string>> = { local: new Map(), sessao: new Map() };

/** A área do browser, ou null se o acesso lançar (ou não existir). */
function area(qual: Area): Storage | null {
  try {
    const s = qual === 'local' ? window.localStorage : window.sessionStorage;
    return s ?? null;
  } catch { return null; }
}

function ler(qual: Area, chave: string): string | null {
  try {
    const s = area(qual);
    if (s) {
      const v = s.getItem(chave);
      if (v !== null) return v;
    }
  } catch { /* usa a memória */ }
  return memoria[qual].get(chave) ?? null;
}

function escrever(qual: Area, chave: string, valor: string): void {
  const texto = String(valor);
  try {
    const s = area(qual);
    if (s) { s.setItem(chave, texto); memoria[qual].delete(chave); return; }
  } catch { /* usa a memória */ }
  memoria[qual].set(chave, texto);
}

function remover(qual: Area, chave: string): void {
  memoria[qual].delete(chave);
  try { area(qual)?.removeItem(chave); } catch { /* sem armazenamento: já removido da memória */ }
}

function chaves(qual: Area): string[] {
  const out = new Set<string>(memoria[qual].keys());
  try {
    const s = area(qual);
    if (s) for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k !== null) out.add(k); }
  } catch { /* só as da memória */ }
  return [...out];
}

export const lerLocal = (chave: string): string | null => ler('local', chave);
export const escreverLocal = (chave: string, valor: string): void => escrever('local', chave, valor);
export const removerLocal = (chave: string): void => remover('local', chave);
export const chavesLocal = (): string[] => chaves('local');

export const lerSessao = (chave: string): string | null => ler('sessao', chave);
export const escreverSessao = (chave: string, valor: string): void => escrever('sessao', chave, valor);
export const removerSessao = (chave: string): void => remover('sessao', chave);
