import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { MINHAS_SUBS_KEY, ehSessaoMock, fetchMinhasSubscricoes, type MinhaSubscricao } from '@/lib/subscricoes';

/**
 * As minhas subscrições (estado real do servidor). Só com a API real: em sessão de demonstração
 * (modo mock) a query fica desligada e devolve lista vazia.
 */
export function useMinhasSubscricoes() {
  const { user } = useAuth();
  const mock = ehSessaoMock();
  const query = useQuery({
    queryKey: MINHAS_SUBS_KEY,
    queryFn: fetchMinhasSubscricoes,
    enabled: !!user && !mock,
    staleTime: 15_000,
    retry: 1,
  });
  const subscricoes: MinhaSubscricao[] = query.data ?? [];
  const porUsername = useMemo(() => new Map(subscricoes.map((s) => [s.criador.username, s])), [subscricoes]);
  return { subscricoes, porUsername, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch, mock };
}
