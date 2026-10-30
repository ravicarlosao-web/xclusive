import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Compass } from 'lucide-react';
import { getExplore } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { PostCard } from '@/components/shared/PostCard';
import { PostSkeleton } from '@/components/shared/SkeletonLoaders';
import { FeedHeader } from '@/components/feed/FeedHeader';
import { ColunaDescobrir } from '@/components/feed/ColunaDescobrir';
import { useAuth } from '@/contexts/AuthContext';
import { MOCK_FEED_POSTS } from '@/data/mockPosts';

/**
 * Explorar: lista vertical de publicações (mais recentes primeiro, sem texto/enquetes), pelo mesmo desenho do Início
 * (PostCard 'feed', centro até 640 px) e com a mesma coluna direita. Páginas de 20 com "Carregar mais", como no perfil.
 * Sem contentor de scroll próprio: usa o do centro (AppLayout).
 */
export default function Explore() {
  const { isMockMode } = useAuth();

  const { data, isLoading, isError, isFetching, refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } = useInfiniteQuery({
    // A chave começa por /api/explore: o PostCard refaz-la depois de desbloquear/subscrever ou eliminar.
    queryKey: ['/api/explore', 'lista'],
    queryFn: ({ pageParam }) => getExplore({ page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (ultima) => (ultima.hasMore ? ultima.page + 1 : undefined),
  });

  const reais = useMemo(() => data?.pages.flatMap((p) => p.posts) ?? [], [data]);
  // Em modo mock sem BD, usa posts demonstrativos (como o Início)
  const posts = isMockMode && reais.length === 0 ? MOCK_FEED_POSTS : reais;

  return (
    <div className="flex justify-center w-full max-w-screen-xl mx-auto gap-12 px-0 sm:px-4 md:pr-1.5">
      {/* Coluna central: cabeçalho fixo e lista contínua de publicações */}
      <div className="w-full min-w-0 max-w-[640px] shrink sm:border-x sm:border-border min-h-[100dvh]">
        <FeedHeader titulo="Explorar" rotuloMenu="Mais opções de Explorar" textoAtualizar="Atualizar" onAtualizar={() => { void refetch(); }} aAtualizar={isFetching} />

        <div className="flex flex-col" data-testid="explorar-lista">
          {isLoading && !isMockMode ? (
            Array(3).fill(0).map((_, i) => <PostSkeleton key={i} />)
          ) : isError && !isMockMode && posts.length === 0 ? (
            <div role="alert" className="mx-4 my-6 rounded-xl border border-border bg-card p-10 text-center" data-testid="explorar-erro">
              <h2 className="mb-2 text-lg font-bold">Não foi possível carregar Explorar</h2>
              <p className="mb-4 text-muted-foreground">Verifica a ligação e tenta novamente.</p>
              <Button variant="outline" className="min-h-[44px]" onClick={() => { void refetch(); }}>Tentar novamente</Button>
            </div>
          ) : posts.length > 0 ? (
            posts.map((post) => <PostCard key={post.id} post={post} variante="feed" />)
          ) : (
            <div className="border-b border-border px-6 py-14 text-center" data-testid="explorar-vazio">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-secondary"><Compass className="h-7 w-7 text-muted-foreground" aria-hidden="true" /></div>
              <h2 className="mb-1 text-lg font-bold">Ainda não há publicações para explorar</h2>
              <p className="text-sm text-muted-foreground">Quando houver novas publicações, aparecem aqui.</p>
            </div>
          )}

          {!isMockMode && posts.length > 0 && (hasNextPage || isFetchNextPageError) && (
            <div className="flex flex-col items-center gap-2 border-b border-border p-4">
              {isFetchNextPageError && <p role="alert" className="text-sm text-muted-foreground" data-testid="explorar-erro-mais">Não foi possível carregar mais publicações.</p>}
              <Button variant="outline" className="min-h-[44px]" onClick={() => { void fetchNextPage(); }} disabled={isFetchingNextPage} data-testid="explorar-carregar-mais">
                {isFetchingNextPage ? 'A carregar…' : isFetchNextPageError ? 'Tentar novamente' : 'Carregar mais'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Coluna direita: a mesma do Início (pesquisa, SUGESTÕES/banner, Top Criadores, Sugestões para ti e botão) */}
      <ColunaDescobrir semDados={isMockMode} />
    </div>
  );
}
