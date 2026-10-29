import { useRoute } from 'wouter';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useGetUserProfile, getUserPosts, useFollowUser, useUnfollowUser, useCreateConversation, getFreshAuthToken } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Grid, Image as ImagemIcone, Settings, Radio, Star, BarChart, UserPlus, UserCheck, MessageCircle, Forward } from 'lucide-react';
import { BotaoTema } from '@/components/shared/BotaoTema';
import { ReportDialog } from '@/components/shared/ReportDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { PostCard } from '@/components/shared/PostCard';
import { PostSkeleton } from '@/components/shared/SkeletonLoaders';
import { PerfilBanner } from '@/components/perfil/PerfilBanner';
import { PerfilIdentidade, BotaoRedondo } from '@/components/perfil/PerfilIdentidade';
import { PerfilColuna } from '@/components/perfil/PerfilColuna';
import { PerfilCabecalhoFixo } from '@/components/perfil/PerfilCabecalhoFixo';
import { OutrasCriadoras } from '@/components/perfil/OutrasCriadoras';
import { GradeMidia, GradeEsqueleto, FiltrosMidia, temMidia, passaFiltro, type FiltroMidia } from '@/components/perfil/GradeMidia';
import { Link, useLocation } from 'wouter';
import { ExclusivoCard } from '@/components/subscricoes/ExclusivoCard';
import { PostDetailModal } from '@/components/shared/PostDetailModal';
import { FollowListModal } from '@/components/shared/FollowListModal';
import type { Post } from '@workspace/api-client-react';

export default function Profile() {
  const [, params] = useRoute('/perfil/:username');
  const username = params?.username || '';
  const { user: me, isMockMode } = useAuth();
  
  const isMe = me?.username === username;

  const { data: profile, isLoading: isLoadingProfile, isError: isProfileError, error: profileError, refetch: refetchProfile } = useGetUserProfile(username, {
    query: { queryKey: ['/api/users', username], enabled: !!username }
  });

  // Publicações por páginas ("Carregar mais"). A chave começa por /api/users/:u/posts: o PostCard e o ExclusivoCard invalidam-na.
  const {
    data: paginas, isLoading: isLoadingPosts, isError: isPostsError, error: postsError, hasNextPage, isFetchingNextPage, fetchNextPage, refetch: refetchPosts,
  } = useInfiniteQuery({
    queryKey: [`/api/users/${username}/posts`, 'perfil'],
    queryFn: ({ pageParam }) => getUserPosts(username, { page: pageParam, limit: 10 }),
    initialPageParam: 1,
    getNextPageParam: (ultima) => (ultima.hasMore ? ultima.page + 1 : undefined),
    enabled: !!username,
    retry: 1,
  });
  const publicacoes = useMemo(() => {
    const vistos = new Set<number>();
    return (paginas?.pages ?? []).flatMap((p) => p.posts).filter((p) => (vistos.has(p.id) ? false : (vistos.add(p.id), true)));
  }, [paginas]);

  // Separador ativo, filtro da mídia e nº de páginas pedidas automaticamente nesta ação (a mídia só pede dados quando se abre).
  const [aba, setAba] = useState('posts');
  const [autoPaginas, setAutoPaginas] = useState(0);
  const [filtroMidia, setFiltroMidia] = useState<FiltroMidia>('tudo');
  const [midiaAberta, setMidiaAberta] = useState(false);
  useEffect(() => { if (aba === 'midia') setMidiaAberta(true); }, [aba]);
  // Mídia: mesma rota, páginas de 20 para a grelha encher; só pede depois de abrir o separador (sem polling).
  const midia = useInfiniteQuery({
    queryKey: [`/api/users/${username}/posts`, 'midia'],
    queryFn: ({ pageParam }) => getUserPosts(username, { page: pageParam, limit: 20 }),
    initialPageParam: 1,
    getNextPageParam: (ultima) => (ultima.hasMore ? ultima.page + 1 : undefined),
    enabled: !!username && midiaAberta,
    retry: 1,
  });
  const celulas = useMemo(() => {
    const vistos = new Set<number>();
    return (midia.data?.pages ?? []).flatMap((p) => p.posts).filter((p) => temMidia(p) && (vistos.has(p.id) ? false : (vistos.add(p.id), true)));
  }, [midia.data]);
  const celulasFiltradas = celulas.filter((p) => passaFiltro(p, filtroMidia));

  const followMutation = useFollowUser();
  const unfollowMutation = useUnfollowUser();
  const createConversationMutation = useCreateConversation();

  const [isFollowingLocally, setIsFollowingLocally] = useState<boolean | undefined>(undefined);
  const [reportOpen, setReportOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [followModal, setFollowModal] = useState<{ type: 'followers' | 'following' } | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  // Pesquisa no cliente (coluna direita): filtra por legenda as publicações já carregadas.
  const [pesquisa, setPesquisa] = useState('');
  const [termo, setTermo] = useState('');
  useEffect(() => { const t = setTimeout(() => setTermo(pesquisa.trim()), 250); return () => clearTimeout(t); }, [pesquisa]);
  useEffect(() => { setPesquisa(''); }, [username]);
  // Miniaturas que falharam a carregar saem do bloco RECENTE (não ficam quebradas).
  const [imagensFalhadas, setImagensFalhadas] = useState<Set<number>>(new Set());
  // Cabeçalho compacto: surge quando o banner sai do ecrã.
  const bannerRef = useRef<HTMLDivElement>(null);
  const [compacto, setCompacto] = useState(false);

  // Verificar se este criador tem uma live activa
  const { data: activeStreams } = useQuery<Array<{
    id: number;
    criadorId: number;
    criador: { username: string; nomeExibicao: string | null; avatarUrl: string | null };
  }>>( {
    queryKey: ['/api/live/active'],
    queryFn: async () => {
      const token = await getFreshAuthToken();
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
      const res = await fetch(`${base}/api/live/active`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Erro ao carregar lives');
      return res.json();
    },
    refetchInterval: 30_000,
    retry: 1,
    enabled: !!username,
  });

  // Stream activo deste criador (se existir)
  const activeStream = activeStreams?.find((s) => s.criador.username === username) ?? null;

  // Derive final following state
  const isFollowing = isFollowingLocally !== undefined ? isFollowingLocally : profile?.estaASeguir;

  const handleFollowToggle = () => {
    if (isFollowing) {
      setIsFollowingLocally(false);
      unfollowMutation.mutate({ username });
    } else {
      setIsFollowingLocally(true);
      followMutation.mutate({ username });
    }
  };

  const handleStartConversation = async () => {
    if (createConversationMutation.isPending) return;
    const participanteId = profile?.id;
    if (!participanteId) return;

    try {
      const conversation = await createConversationMutation.mutateAsync({
        data: { participanteId },
      });
      setLocation(`/mensagens/${conversation.id}`);
    } catch (error) {
      console.error('[Messages] conversation creation error:', error);
    }
  };

  const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const filtradas = termo ? publicacoes.filter((p) => norm(p.legenda ?? '').includes(norm(termo))) : publicacoes;
  const privada = (postsError as { status?: number } | null)?.status === 403;

  // Mídia: se o filtro atual ainda não tem células mas há mais páginas, vai buscá-las (máx. 5 por ação, sem polling).
  const LIMITE_AUTO = 5;
  useEffect(() => { setAutoPaginas(0); }, [aba, username, filtroMidia]);
  useEffect(() => {
    if (aba !== 'midia' || !midiaAberta || midia.isLoading || midia.isError || midia.isFetchingNextPage) return;
    if (celulasFiltradas.length === 0 && midia.hasNextPage && autoPaginas < LIMITE_AUTO) { setAutoPaginas((n) => n + 1); void midia.fetchNextPage(); }
  }, [aba, midiaAberta, midia.isLoading, midia.isError, midia.isFetchingNextPage, midia.hasNextPage, celulasFiltradas.length, autoPaginas, midia]);
  const aProcurarMidia = aba === 'midia' && celulasFiltradas.length === 0 && !!midia.hasNextPage && autoPaginas < LIMITE_AUTO;
  const midiaPrivada = (midia.error as { status?: number } | null)?.status === 403;
  useEffect(() => {
    const el = bannerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const o = new IntersectionObserver(([e]) => setCompacto(!e.isIntersecting));
    o.observe(el);
    return () => o.disconnect();
  }, [profile?.id]);

  const voltar = () => { if (window.history.length > 1) window.history.back(); else setLocation('/home'); };
  const copiarLigacao = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/perfil/${username}`);
      toast({ title: 'Ligação copiada', description: 'A ligação foi copiada para a área de transferência.' });
    } catch {
      toast({ variant: 'destructive', title: 'Não foi possível copiar a ligação' });
    }
  };

  if (isLoadingProfile) {
    return (
      <div className="flex justify-center w-full max-w-screen-xl mx-auto gap-12 px-0 sm:px-4" data-testid="perfil-a-carregar">
        <div className="w-full min-w-0 max-w-[640px] shrink sm:border-x sm:border-border min-h-[100dvh]">
          <Skeleton className="aspect-[10/3] min-h-[132px] w-full rounded-none" />
          <div className="px-4 pb-4">
            <Skeleton className="-mt-10 h-20 w-20 rounded-full ring-4 ring-background sm:-mt-12 sm:h-24 sm:w-24" />
            <Skeleton className="mt-3 h-7 w-48" />
            <Skeleton className="mt-2 h-4 w-32" />
            <Skeleton className="mt-3 h-12 w-full" />
          </div>
          <PostSkeleton />
        </div>
      </div>
    );
  }

  if (isProfileError && (profileError as { status?: number } | null)?.status !== 404) {
    return (
      <div role="alert" className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4" data-testid="perfil-erro">
        <h2 className="text-2xl font-bold mb-2">Não foi possível carregar o perfil</h2>
        <p className="text-muted-foreground mb-6">Verifica a ligação e tenta novamente.</p>
        <Button variant="outline" className="min-h-[44px]" onClick={() => { void refetchProfile(); }}>Tentar novamente</Button>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <h2 className="text-2xl font-bold mb-2">Utilizador não encontrado</h2>
        <p className="text-muted-foreground mb-6">O perfil que procuras não existe ou foi removido.</p>
        <Link href="/home">
          <Button>Voltar ao Início</Button>
        </Link>
      </div>
    );
  }

  const ehCriadorVisto = profile.tipoConta === 'criador' && !isMe;
  const stats = { publicacoes: profile.totalPublicacoes ?? null, fas: profile.totalSeguidores ?? null, seguindo: profile.totalSeguindo ?? null };
  const botaoMais = (
    <Button variant="outline" className="min-h-[44px]" onClick={() => { setAutoPaginas(0); void fetchNextPage(); }} disabled={isFetchingNextPage} data-testid="perfil-carregar-mais">
      {isFetchingNextPage ? 'A carregar…' : 'Carregar mais'}
    </Button>
  );
  // Com pesquisa ativa e mais páginas por carregar, a lista é parcial: avisa-o de forma discreta.
  const carregarMais = hasNextPage ? (
    termo && aba === 'posts' ? (
      <div className="flex flex-col items-center gap-2 border-b border-border p-4" data-testid="perfil-pesquisa-parcial">
        <p className="text-xs text-muted-foreground">A pesquisar nas publicações carregadas</p>
        {botaoMais}
      </div>
    ) : <div className="flex justify-center border-b border-border p-4">{botaoMais}</div>
  ) : null;
  const vazio = (Icone: typeof Grid, titulo: string, texto: string) => (
    <div className="border-b border-border px-6 py-14 text-center" data-testid="perfil-vazio">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-secondary"><Icone className="h-7 w-7 text-muted-foreground" aria-hidden="true" /></div>
      <h3 className="mb-1 text-lg font-bold">{titulo}</h3>
      <p className="text-sm text-muted-foreground">{texto}</p>
    </div>
  );
  const tabCls = 'h-full flex-1 rounded-none border-b-2 border-transparent text-sm font-bold uppercase tracking-wide text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none';

  return (
    <div className="flex justify-center w-full max-w-screen-xl mx-auto gap-12 px-0 sm:px-4 pb-20 sm:pb-0">
      {/* Coluna central: banner, identidade, assinatura, separadores e lista contínua */}
      <div className="w-full min-w-0 max-w-[640px] shrink sm:border-x sm:border-border min-h-[100dvh]">
        <PerfilCabecalhoFixo visivel={compacto} nome={profile.nomeExibicao} verificado={profile.verificado} onVoltar={voltar}
          onCopiarLigacao={() => { void copiarLigacao(); }} onDenunciar={isMe ? undefined : () => setReportOpen(true)} />
        <div ref={bannerRef}>
        <PerfilBanner
          capaUrl={profile.capaUrl}
          nome={profile.nomeExibicao}
          verificado={profile.verificado}
          stats={stats}
          onVoltar={voltar}
          onAbrirFas={() => setFollowModal({ type: 'followers' })}
          onAbrirSeguindo={() => setFollowModal({ type: 'following' })}
          onCopiarLigacao={() => { void copiarLigacao(); }}
          onDenunciar={isMe ? undefined : () => setReportOpen(true)}
        />
        </div>

        <PerfilIdentidade
          nome={profile.nomeExibicao}
          username={profile.username}
          avatarUrl={profile.avatarUrl}
          verificado={profile.verificado}
          bio={profile.bio}
          link={profile.link}
          aoVivo={!!activeStream}
          acoes={isMe ? (
            <>
              <BotaoRedondo rotulo="Editar Perfil" href="/definicoes" testid="perfil-editar"><Settings className="h-5 w-5" aria-hidden="true" /></BotaoRedondo>
              {profile.tipoConta === 'criador' ? (
                <BotaoRedondo rotulo="Painel" href="/definicoes/monetizacao" destaque="primario" testid="perfil-painel"><BarChart className="h-5 w-5" aria-hidden="true" /></BotaoRedondo>
              ) : (
                <BotaoRedondo rotulo="Tornar-se Criador" href="/tornar-criador" destaque="primario" testid="perfil-tornar-criador"><Star className="h-5 w-5" aria-hidden="true" /></BotaoRedondo>
              )}
              <BotaoTema className="border border-border bg-background hover:bg-secondary" />
            </>
          ) : (
            <>
              <BotaoRedondo rotulo={isFollowing ? 'A seguir' : 'Seguir'} ativo={!!isFollowing} onClick={handleFollowToggle} destaque={isFollowing ? undefined : 'primario'} testid="perfil-seguir">
                {isFollowing ? <UserCheck className="h-5 w-5" aria-hidden="true" /> : <UserPlus className="h-5 w-5" aria-hidden="true" />}
              </BotaoRedondo>
              <BotaoRedondo rotulo="Mensagem" onClick={handleStartConversation} desativado={createConversationMutation.isPending} testid="perfil-mensagem"><MessageCircle className="h-5 w-5" aria-hidden="true" /></BotaoRedondo>
              {activeStream && <BotaoRedondo rotulo="Ver Live" onClick={() => setLocation(`/live/${activeStream.id}`)} destaque="live" testid="perfil-ver-live"><Radio className="h-5 w-5" aria-hidden="true" /></BotaoRedondo>}
              <BotaoRedondo rotulo="Partilhar (copiar ligação)" onClick={() => { void copiarLigacao(); }} testid="perfil-partilhar"><Forward className="h-5 w-5" aria-hidden="true" /></BotaoRedondo>
            </>
          )}
        />
        {!isMe && <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} targetType="user" targetId={profile.id} />}

        {/* Assinatura: o que antes era a aba "Exclusivo" (mesmo componente, mesma lógica e condições) */}
        {ehCriadorVisto && (
          <section aria-labelledby="perfil-assinatura-titulo" className="border-t border-border px-4 py-4" data-testid="perfil-assinatura">
            <h2 id="perfil-assinatura-titulo" className="mb-3 text-xs font-extrabold uppercase tracking-wide text-foreground">Assinatura</h2>
            <ExclusivoCard username={profile.username} nomeExibicao={profile.nomeExibicao} avatarUrl={profile.avatarUrl ?? null} verificado={profile.verificado} />
          </section>
        )}

        <Tabs value={aba} onValueChange={setAba} className="w-full border-t border-border">
          <TabsList className="grid h-12 w-full grid-cols-2 rounded-none border-b border-border bg-transparent p-0">
            <TabsTrigger value="posts" className={tabCls} data-testid="perfil-aba-publicacoes">Publicações{profile.totalPublicacoes != null ? ` ${profile.totalPublicacoes}` : ''}</TabsTrigger>
            <TabsTrigger value="midia" className={tabCls} data-testid="perfil-aba-midia">Mídia</TabsTrigger>
          </TabsList>

          <TabsContent value="posts" className="mt-0 focus-visible:outline-none">
            <h2 className="border-b border-border px-4 py-3 text-xs font-extrabold uppercase tracking-wide text-foreground">Recente</h2>
            {isLoadingPosts ? (
              <div data-testid="perfil-posts-a-carregar">{Array(2).fill(0).map((_, i) => <PostSkeleton key={i} />)}</div>
            ) : isPostsError ? (
              privada ? vazio(Grid, 'Esta conta é privada', `Segue ${profile.username} para veres as publicações.`) : (
                <div role="alert" className="border-b border-border px-6 py-12 text-center" data-testid="perfil-posts-erro">
                  <h3 className="mb-1 text-lg font-bold">Não foi possível carregar as publicações</h3>
                  <p className="mb-4 text-sm text-muted-foreground">Verifica a ligação e tenta novamente.</p>
                  <Button variant="outline" className="min-h-[44px]" onClick={() => { void refetchPosts(); }}>Tentar novamente</Button>
                </div>
              )
            ) : publicacoes.length === 0 ? (
              vazio(Grid, 'Ainda sem publicações', `As fotos e vídeos que ${profile.username} partilhar aparecerão aqui.`)
            ) : filtradas.length === 0 ? (
              <div className="border-b border-border px-6 py-12 text-center" data-testid="perfil-sem-resultados">
                <h3 className="mb-1 text-lg font-bold">{hasNextPage ? 'Sem resultados nas publicações carregadas' : 'Sem resultados'}</h3>
                <p className="mb-4 text-sm text-muted-foreground">{hasNextPage ? `Ainda há publicações por carregar; «${termo}» pode estar nelas.` : `Nenhuma publicação contém «${termo}».`}</p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {hasNextPage && botaoMais}
                  <Button variant="outline" className="min-h-[44px]" onClick={() => setPesquisa('')}>Limpar pesquisa</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col" data-testid="perfil-lista">
                {filtradas.map((post) => <PostCard key={post.id} post={post} variante="feed" />)}
              </div>
            )}
            {!isLoadingPosts && !isPostsError && !(termo && filtradas.length === 0) && carregarMais}
          </TabsContent>

          <TabsContent value="midia" className="mt-0 focus-visible:outline-none" data-testid="perfil-midia">
            <h2 className="border-b border-border px-4 py-3 text-xs font-extrabold uppercase tracking-wide text-foreground">Recente</h2>
            <FiltrosMidia filtro={filtroMidia} onMudar={setFiltroMidia} />
            {!midiaAberta || midia.isLoading || aProcurarMidia ? (
              <GradeEsqueleto />
            ) : midia.isError ? (
              midiaPrivada ? vazio(Grid, 'Esta conta é privada', `Segue ${profile.username} para veres a mídia.`) : (
                <div role="alert" className="border-b border-border px-6 py-12 text-center" data-testid="perfil-midia-erro">
                  <h3 className="mb-1 text-lg font-bold">Não foi possível carregar a mídia</h3>
                  <p className="mb-4 text-sm text-muted-foreground">Verifica a ligação e tenta novamente.</p>
                  <Button variant="outline" className="min-h-[44px]" onClick={() => { void midia.refetch(); }}>Tentar novamente</Button>
                </div>
              )
            ) : celulasFiltradas.length > 0 ? (
              <GradeMidia posts={celulasFiltradas} onAbrir={setSelectedPost} />
            ) : midia.hasNextPage ? (
              vazio(ImagemIcone, 'Sem resultados na mídia carregada', 'Ainda há publicações por carregar; carrega mais para continuar a procurar.')
            ) : (
              vazio(ImagemIcone, filtroMidia === 'tudo' ? 'Ainda sem fotos nem vídeos' : filtroMidia === 'foto' ? 'Ainda sem fotos' : 'Ainda sem vídeos', `A mídia que ${profile.username} partilhar aparecerá aqui.`)
            )}
            {midiaAberta && !midia.isLoading && !midia.isError && midia.hasNextPage && (
              <div className="flex justify-center border-b border-border p-4">
                <Button variant="outline" className="min-h-[44px]" onClick={() => { setAutoPaginas(0); void midia.fetchNextPage(); }} disabled={midia.isFetchingNextPage} data-testid="midia-carregar-mais">
                  {midia.isFetchingNextPage ? 'A carregar…' : 'Carregar mais'}
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Coluna direita (só em ecrãs grandes): pesquisa e RECENTE */}
      <aside aria-label="Pesquisa e publicações recentes" className="hidden lg:block w-[320px] xl:w-[400px] flex-shrink-0 pt-6" data-testid="perfil-coluna">
        <PerfilColuna
          pesquisa={pesquisa}
          onPesquisa={setPesquisa}
          publicacoes={publicacoes.filter((p) => !imagensFalhadas.has(p.id))}
          onAbrir={setSelectedPost}
          onImagemFalhou={(id) => setImagensFalhadas((s) => new Set(s).add(id))}
        />
        <OutrasCriadoras ativo={!isMockMode} perfilUsername={profile.username} meuUsername={me?.username} />
      </aside>

      {/* Post detail modal */}
      <PostDetailModal post={selectedPost} onClose={() => setSelectedPost(null)} />

      {/* Follow list modal */}
      {followModal && (
        <FollowListModal
          open={!!followModal}
          onClose={() => setFollowModal(null)}
          username={username}
          type={followModal.type}
          total={(followModal.type === 'followers' ? profile.totalSeguidores : profile.totalSeguindo) ?? 0}
        />
      )}
    </div>
  );
}
