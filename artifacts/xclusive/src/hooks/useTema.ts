import { useCallback, useSyncExternalStore } from 'react';

/** Chave guardada no navegador. Só o valor exato 'claro' tira o modo noturno; qualquer outra coisa (ou erro de acesso) = noturno. */
export const CHAVE_TEMA = 'xclusive_tema';

export type Tema = 'noturno' | 'diurno';

const ouvintes = new Set<() => void>();

function lerGuardado(): Tema {
  try {
    return localStorage.getItem(CHAVE_TEMA) === 'claro' ? 'diurno' : 'noturno';
  } catch {
    return 'noturno';
  }
}

/** O estado real é o do <html>: o script do index.html já o pôs certo antes do primeiro paint. */
function lerAplicado(): Tema {
  return document.documentElement.classList.contains('dark') ? 'noturno' : 'diurno';
}

function aplicar(tema: Tema): void {
  const el = document.documentElement;
  el.classList.toggle('dark', tema === 'noturno');
  el.style.colorScheme = tema === 'noturno' ? 'dark' : 'light';
}

function avisar(): void {
  ouvintes.forEach((f) => f());
}

function subscrever(f: () => void): () => void {
  ouvintes.add(f);
  return () => { ouvintes.delete(f); };
}

// Rede de segurança: se o script inline do index.html não tiver corrido (por ex. bloqueado por uma política de
// segurança), aplica aqui a escolha guardada. Com o script a funcionar isto não muda nada.
if (typeof document !== 'undefined' && lerGuardado() !== lerAplicado()) aplicar(lerGuardado());

// Outra aba mudou a escolha.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== CHAVE_TEMA) return;
    aplicar(lerGuardado());
    avisar();
  });
}

export function useTema() {
  const tema = useSyncExternalStore(subscrever, lerAplicado, () => 'noturno' as Tema);

  const definir = useCallback((novo: Tema) => {
    aplicar(novo);
    try {
      localStorage.setItem(CHAVE_TEMA, novo === 'diurno' ? 'claro' : 'escuro');
    } catch {
      /* sem armazenamento: a escolha vale só nesta sessão */
    }
    avisar();
  }, []);

  const alternar = useCallback(() => definir(lerAplicado() === 'noturno' ? 'diurno' : 'noturno'), [definir]);

  return { tema, noturno: tema === 'noturno', definir, alternar };
}
