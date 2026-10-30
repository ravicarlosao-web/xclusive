import { useSyncExternalStore } from 'react';

const CONSULTA = '(min-width: 768px)';

const subscrever = (aviso: () => void) => {
  const mql = window.matchMedia(CONSULTA);
  mql.addEventListener('change', aviso);
  return () => mql.removeEventListener('change', aviso);
};

/** true em md para cima (o mesmo ponto de corte do menu lateral); usa matchMedia, sem estado nem pedidos. */
export function useDesktop(): boolean {
  return useSyncExternalStore(subscrever, () => window.matchMedia(CONSULTA).matches, () => false);
}
