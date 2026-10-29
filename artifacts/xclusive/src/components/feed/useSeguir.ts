import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFollowUser, useUnfollowUser } from '@workspace/api-client-react';

/** Seguir/deixar de seguir com resposta imediata (otimista). Partilhado por "Top Criadores" e "Sugestões para ti". */
export function useSeguir() {
  const queryClient = useQueryClient();
  const [mapa, setMapa] = useState<Record<number, boolean>>({});
  const seguir = useFollowUser();
  const deixar = useUnfollowUser();

  function alternar(id: number, username: string, jaSegue: boolean) {
    const agora = !(mapa[id] ?? jaSegue);
    setMapa((m) => ({ ...m, [id]: agora }));
    const refrescar = () => { queryClient.invalidateQueries({ queryKey: ['/api/feed'] }); };
    const reverter = () => setMapa((m) => ({ ...m, [id]: !agora }));
    if (agora) seguir.mutate({ username }, { onSuccess: refrescar, onError: reverter });
    else deixar.mutate({ username }, { onSuccess: refrescar, onError: reverter });
  }
  return { segue: (id: number, jaSegue: boolean) => mapa[id] ?? jaSegue, alternar };
}
