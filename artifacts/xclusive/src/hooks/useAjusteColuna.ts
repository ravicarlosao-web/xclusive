import { RefObject, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

/** Estados por ordem de compactação (do menos ao mais notório): em cada um procura-se o MAIOR tamanho que cabe (u de 0 a 3). */
const ESTADOS: Array<{ linhas: 5 | 4 | 3; cartoes: 2 | 1 }> = [
  { linhas: 5, cartoes: 2 },
  { linhas: 5, cartoes: 1 },
  { linhas: 4, cartoes: 1 },
  { linhas: 3, cartoes: 1 },
];
/** u: 0 = tamanhos originais; 0–1 espaçamentos; 1–2 banner; 2–3 cartões e linhas. */
const U_MAX = 3;
const PASSO = 0.05;

/**
 * Ajuste POR MEDIÇÃO da coluna direita (início e perfil, lg+): com o conteúdo real já renderizado (linhas do Top Criadores,
 * cartões de Sugestões, RECENTE...), escolhe o primeiro estado que cabe e, nele, o maior tamanho que cabe (pesquisa binária
 * sobre as variáveis --t1..--t3 do CSS). Nunca esconde um bloco; se nem o mínimo cabe, a coluna rola por dentro (CSS).
 * Determinístico (parte sempre do zero), por isso não oscila; as alterações que o próprio ajuste faz ao DOM são descartadas
 * (takeRecords) para não provocarem nova avaliação. Reavalia em resize/zoom (ResizeObserver), mudanças de conteúdo
 * (MutationObserver: dados, seguir, carrossel) e quando as fontes carregam. Sem pedidos nem temporizadores.
 */
export function useAjusteColuna(ref: RefObject<HTMLElement | null>, dep?: unknown) {
  const [cartoes, setCartoes] = useState<1 | 2>(2);
  const cartoesAtual = useRef<1 | 2>(2);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let ocupado = false;
    let vivo = true;

    const aplicar = (u: number, linhas: number) => {
      const t = (a: number) => String(Math.min(1, Math.max(0, u - a)));
      el.style.setProperty('--t1', t(0));
      el.style.setProperty('--t2', t(1));
      el.style.setProperty('--t3', t(2));
      if (linhas < 5) el.setAttribute('data-linhas', String(linhas)); else el.removeAttribute('data-linhas');
    };
    // Mede pelo último bloco em fluxo (e não por scrollHeight, que contaria a lista de resultados da pesquisa, absoluta)
    const cabe = () => {
      const ultimo = el.lastElementChild as HTMLElement | null;
      if (!ultimo) return true;
      const r = el.getBoundingClientRect();
      const fundo = ultimo.getBoundingClientRect().bottom - r.top + el.scrollTop + parseFloat(getComputedStyle(el).paddingBottom);
      return fundo <= el.clientHeight + 0.5;
    };
    const mudarCartoes = (k: 1 | 2) => {
      if (cartoesAtual.current === k) return;
      cartoesAtual.current = k;
      flushSync(() => setCartoes(k));
    };

    const mo = new MutationObserver(() => avaliar());
    const avaliar = () => {
      if (ocupado || !vivo || el.clientHeight === 0) return;
      ocupado = true;
      try {
        let fim = ESTADOS[ESTADOS.length - 1];
        let uFim = U_MAX;
        for (const e of ESTADOS) {
          mudarCartoes(e.cartoes);
          aplicar(U_MAX, e.linhas);
          if (!cabe()) continue;
          fim = e;
          aplicar(0, e.linhas);
          if (cabe()) { uFim = 0; break; }
          let lo = 0, hi = U_MAX;
          while (hi - lo > PASSO) {
            const m = (lo + hi) / 2;
            aplicar(m, e.linhas);
            if (cabe()) hi = m; else lo = m;
          }
          uFim = hi;
          break;
        }
        mudarCartoes(fim.cartoes);
        aplicar(uFim, fim.linhas);
      } finally {
        mo.takeRecords();
        ocupado = false;
      }
    };

    const ro = new ResizeObserver(() => avaliar());
    ro.observe(el);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    void document.fonts?.ready.then(() => avaliar());
    document.fonts?.addEventListener?.('loadingdone', avaliar);
    return () => {
      vivo = false;
      ro.disconnect();
      mo.disconnect();
      document.fonts?.removeEventListener?.('loadingdone', avaliar);
    };
  }, [ref, dep]);

  return { cartoes };
}
