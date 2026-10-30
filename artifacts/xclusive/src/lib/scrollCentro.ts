/**
 * Em md+ o documento não faz scroll: quem rola é o contentor do centro (`#conteudo-scroll`) ou, nas páginas de duas colunas
 * (início, perfil), a própria coluna central. Todos levam `data-scroll-centro`; o mais interior é o ativo.
 */
export const SELETOR_SCROLL = '[data-scroll-centro]';

export function scrollerAtivo(): HTMLElement | null {
  const lista = document.querySelectorAll<HTMLElement>(SELETOR_SCROLL);
  return lista.length ? lista[lista.length - 1] : null;
}

/** "Ir ao topo": no contentor quando este rola (md+), no documento quando não (mobile). */
export function irAoTopo(behavior: ScrollBehavior = 'smooth') {
  const el = scrollerAtivo();
  if (el && el.scrollHeight > el.clientHeight + 1) el.scrollTo({ top: 0, behavior });
  else window.scrollTo({ top: 0, behavior });
}
