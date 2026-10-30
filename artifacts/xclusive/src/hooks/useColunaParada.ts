import { useEffect, useRef } from 'react';

/** Há dentro da coluna (entre o alvo e a coluna) algo que rola por si, p. ex. a lista de resultados da pesquisa? */
function alvoRolaPorSi(alvo: EventTarget | null, coluna: HTMLElement): boolean {
  for (let e = alvo instanceof Element ? alvo : null; e && e !== coluna; e = e.parentElement) {
    const oy = getComputedStyle(e).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 1) return true;
  }
  return false;
}

/**
 * Coluna direita parada (md+): a coluna é sticky dentro do contentor de scroll do centro, por isso a roda e o trackpad sobre ela
 * rolariam o centro; o listener (não passivo) impede-o. Exceções: Ctrl/⌘+roda (zoom do navegador), elementos que rolam por si e o
 * fallback de alturas muito baixas, em que a própria coluna rola (overscroll-behavior: contain impede de encadear no centro).
 */
export function useColunaParada<T extends HTMLElement = HTMLElement>(dep?: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const coluna = ref.current;
    if (!coluna) return;
    const aoRoda = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      if (coluna.scrollHeight > coluna.clientHeight + 1) return;
      if (alvoRolaPorSi(e.target, coluna)) return;
      e.preventDefault();
    };
    coluna.addEventListener('wheel', aoRoda, { passive: false });
    return () => coluna.removeEventListener('wheel', aoRoda);
  }, [dep]);
  return ref;
}
