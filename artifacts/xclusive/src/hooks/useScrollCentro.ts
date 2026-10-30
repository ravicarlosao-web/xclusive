import { useEffect } from 'react';
import { SELETOR_SCROLL, scrollerAtivo } from '@/lib/scrollCentro';

const TECLAS = new Set(['PageDown', 'PageUp', 'Home', 'End', ' ', 'ArrowDown', 'ArrowUp']);

/**
 * Comportamento do contentor de scroll do centro (md+): volta ao topo a cada mudança de rota, recebe o foco quando nada o tem
 * (assim Page Down, Espaço e setas funcionam) e trata essas teclas quando o foco está no corpo da página.
 */
export function useScrollCentro(rota: string) {
  useEffect(() => {
    document.querySelectorAll<HTMLElement>(SELETOR_SCROLL).forEach((el) => { el.scrollTop = 0; });
    const ativo = document.activeElement;
    if (!ativo || ativo === document.body) scrollerAtivo()?.focus({ preventScroll: true });
  }, [rota]);

  useEffect(() => {
    const aoTecla = (e: KeyboardEvent) => {
      if (!TECLAS.has(e.key) || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = scrollerAtivo();
      if (!el) return;
      // Sobreposição por cima do centro (StoryViewer, portais...): o foco pode ter ficado no contentor e o teclado não deve rolar o fundo
      const r = el.getBoundingClientRect();
      const topo = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!topo || !el.contains(topo)) {
        if (e.target instanceof Element && e.target.closest(SELETOR_SCROLL) && !e.target.closest('input, textarea, select, [contenteditable="true"]')) e.preventDefault();
        return;
      }
      if (e.target !== document.body || document.body.hasAttribute('data-scroll-locked') || el.scrollHeight <= el.clientHeight) return;
      e.preventDefault();
      const passo = e.key === 'ArrowDown' ? 60 : e.key === 'ArrowUp' ? -60 : (e.key === 'PageUp' ? -1 : 1) * el.clientHeight * 0.9;
      if (e.key === 'Home') el.scrollTo({ top: 0 });
      else if (e.key === 'End') el.scrollTo({ top: el.scrollHeight });
      else el.scrollBy({ top: passo });
    };
    window.addEventListener('keydown', aoTecla);
    return () => window.removeEventListener('keydown', aoTecla);
  }, []);
}
