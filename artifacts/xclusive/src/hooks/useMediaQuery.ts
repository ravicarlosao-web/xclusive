import { useSyncExternalStore } from 'react';

/** true enquanto a consulta de media (p. ex. '(min-width: 1024px)') se verifica; sem estado nem pedidos. */
export function useMediaQuery(consulta: string): boolean {
  return useSyncExternalStore(
    (aviso) => {
      const mql = window.matchMedia(consulta);
      mql.addEventListener('change', aviso);
      return () => mql.removeEventListener('change', aviso);
    },
    () => window.matchMedia(consulta).matches,
    () => false,
  );
}
