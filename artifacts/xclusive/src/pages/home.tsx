import { useCallback, useRef, useState } from 'react';
import { useGetFeed, useGetStoriesFeed, useDeleteStory, StoryGroup, getFreshAuthToken } from '@workspace/api-client-react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { PostCard } from '@/components/shared/PostCard';
import { StoryViewer } from '@/components/shared/StoryViewer';
import { PostSkeleton } from '@/components/shared/SkeletonLoaders';
import { FeedHeader } from '@/components/feed/FeedHeader';
import { FeedTabs, type FiltroFeed } from '@/components/feed/FeedTabs';
import { StoriesLiveRow, type LiveAtiva } from '@/components/feed/StoriesLiveRow';
import { PesquisaFeed } from '@/components/feed/PesquisaFeed';
import { BannerSugestoes } from '@/components/feed/BannerSugestoes';
import { TopCriadores } from '@/components/feed/TopCriadores';
import { SugestoesParaTi } from '@/components/feed/SugestoesParaTi';
import { InlineComposer } from '@/components/shared/InlineComposer';
import { CreatePostModal } from '@/components/shared/CreatePostModal';
import { StoryPreviewModal } from '@/components/shared/StoryPreviewModal';
import { MobileDataWarningDialog } from '@/components/shared/MobileDataWarningDialog';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import { ChevronRight } from 'lucide-react';
import { useColunaParada } from '@/hooks/useColunaParada';
import { useAjusteColuna } from '@/hooks/useAjusteColuna';
import { MOCK_FEED_POSTS } from '@/data/mockPosts';
import { MOCK_STORY_GROUPS } from '@/data/mockStories';
import { addLocalStory, deleteLocalStory, getLocalStoriesForUser, localStoryToStory, markStoryViewed } from '@/lib/localStories';
import { toast } from 'sonner';

const MAX_STORY_SIZE_MB = 500;

export default function Home() {
  const { user, isMockMode } = useAuth();
  const colunaRef = useColunaParada<HTMLElement>();
  const { cartoes } = useAjusteColuna(colunaRef);
  const queryClient = useQueryClient();
  const deleteStoryMutation = useDeleteStory();
  // Separador ativo do feed: uma só chamada por separador (sem polling).
  const [filtro, setFiltro] = useState<FiltroFeed>('tudo');

  // Inline composer → full modal (for media posts)
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInitialFiles, setModalInitialFiles] = useState<File[]>([]);
  const [modalPasso, setModalPasso] = useState<'enquete' | undefined>(undefined);

  function handleOpenWithFiles(files: File[]) {
    setModalInitialFiles(files);
    setModalOpen(true);
  }

  function handleModalClose() {
    setModalOpen(false);
    setModalInitialFiles([]);
    setModalPasso(undefined);
    queryClient.invalidateQueries({ queryKey: ['/api/feed'] });
  }
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewerGroupIndex, setViewerGroupIndex] = useState<number | null>(null);
  // Bumps whenever local stories change, to force re-reading localStorage
  const [localStoriesVersion, setLocalStoriesVersion] = useState(0);

  // Story video data warning state
  const [pendingStoryFile, setPendingStoryFile] = useState<File | null>(null);
  const [showStoryDataWarning, setShowStoryDataWarning] = useState(false);

  // Story preview modal state
  const [storyPreviewFile, setStoryPreviewFile] = useState<File | null>(null);
  const [storyPreviewUrl, setStoryPreviewUrl] = useState<string | null>(null);

  // Queries
  const { data: feedData, isLoading: isLoadingFeed, isError: isFeedError, isFetching: isFetchingFeed, refetch: refetchFeed } = useGetFeed(
    { page: 1, limit: 10, filtro },
    { query: { queryKey: ['/api/feed', filtro, 1] } }
  );

  // Em modo mock sem DB, usa posts demonstrativos
  const posts = isMockMode && !feedData?.posts?.length
    ? MOCK_FEED_POSTS
    : (feedData?.posts ?? []);

  const { data: storiesData, isLoading: isLoadingStories } = useGetStoriesFeed({
    query: { queryKey: ['/api/stories/feed'] }
  });

  // Lives ativas: aparecem na linha de stories (item "AO VIVO"). Mantém-se o intervalo de 30 s que já existia (nenhum novo).
  const { data: activeStreams } = useQuery<LiveAtiva[]>({
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
    enabled: !isMockMode,
    retry: 1,
  });
  const liveStreams = activeStreams ?? [];

  // O meu grupo de stories: apenas para criadores
  const isCriador = user?.tipoConta === 'criador';
  const serverMyGroup = storiesData?.find(g => g.utilizador?.id === user?.id);
  const serverMyStories = serverMyGroup?.stories ?? [];
  const localMyStories = user && isCriador ? getLocalStoriesForUser(user.id).map(s => localStoryToStory(s, user)) : [];
  const myStories = serverMyStories.length > 0 ? serverMyStories : localMyStories;

  const myGroup: StoryGroup | null = user && isCriador
    ? {
        utilizador: user,
        stories: myStories,
        hasNaoVisto: serverMyGroup?.hasNaoVisto ?? (myStories.length > 0),
      }
    : null;

  // Em modo mock sem DB, usa stories demonstrativos de outros utilizadores (excluindo eu próprio)
  const otherGroups: StoryGroup[] = (isMockMode && !storiesData?.length
    ? MOCK_STORY_GROUPS
    : (storiesData ?? [])).filter(g => g.utilizador?.id !== user?.id);

  // Lista usada pelo viewer: apenas grupos com pelo menos 1 story (eu primeiro, se tiver)
  const viewableGroups: StoryGroup[] = [
    ...(myGroup && myGroup.stories.length > 0 ? [myGroup] : []),
    ...otherGroups.filter(g => g.stories.length > 0),
  ];

  const handleAddStoryClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  async function uploadStory(file: File, audiencia: 'todos' | 'proximos' = 'todos', mais18: boolean) {
    if (!user) return;
    const tipo = file.type.startsWith('video/') ? 'video' : 'imagem';

    if (isMockMode) {
      addLocalStory(user.id, URL.createObjectURL(file), tipo);
      setLocalStoriesVersion(v => v + 1);
      toast.success('Story publicado com sucesso!', {
        description: audiencia === 'proximos' ? 'Visível para Amigos Chegados' : 'Visível para todos os seguidores',
      });
      return;
    }

    try {
      const formData = new FormData();
      formData.append('files', file);
      const token = await getFreshAuthToken(true);
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
      const authHeaders: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};

      const uploadResponse = await fetch(`${base}/api/upload`, {
        method: 'POST',
        headers: authHeaders,
        credentials: 'same-origin',
        body: formData,
      });
      const uploadBody = await uploadResponse.json().catch(() => null) as {
        files?: { url: string; urlVisualizacao?: string; tipo: string }[];
        error?: string;
      } | null;
      if (!uploadResponse.ok) {
        throw new Error(uploadBody?.error || 'Não foi possível enviar o ficheiro.');
      }

      const uploadedFile = uploadBody?.files?.[0];
      if (!uploadedFile?.url) {
        throw new Error('Não foi possível enviar o ficheiro.');
      }

      const freshStoryToken = await getFreshAuthToken();
      const storyHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(freshStoryToken ? { Authorization: `Bearer ${freshStoryToken}` } : {}),
      };

      const storyResponse = await fetch(`${base}/api/stories`, {
        method: 'POST',
        headers: storyHeaders,
        credentials: 'same-origin',
        body: JSON.stringify({
          mediaUrl: uploadedFile.url,
          tipo: uploadedFile.tipo === 'video' ? 'video' : tipo,
          audiencia,
          mais18,
        }),
      });
      const storyBody = await storyResponse.json().catch(() => null) as { error?: string } | null;
      if (!storyResponse.ok) {
        throw new Error(storyBody?.error || `Criação da story falhou: ${storyResponse.status}`);
      }

      // Adiciona também localmente para feedback instantâneo no círculo do criador
      addLocalStory(user.id, uploadedFile.urlVisualizacao ?? uploadedFile.url, tipo);
      setLocalStoriesVersion(v => v + 1);

      await queryClient.invalidateQueries({ queryKey: ['/api/stories/feed'] });
      toast.success('Story publicado com sucesso!', {
        description: audiencia === 'proximos' ? 'Visível para Amigos Chegados' : 'Visível para todos os teus seguidores',
      });
    } catch (error) {
      console.error('[Stories] creation error:', error);
      toast.error(error instanceof Error ? error.message : 'Erro ao publicar story. Tenta novamente.');
      throw error;
    }
  }

  function handleStoryFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !user) return;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      toast.error('Usa uma imagem ou vídeo para o teu story.');
      return;
    }
    if (file.size > MAX_STORY_SIZE_MB * 1024 * 1024) {
      toast.error(`Ficheiro demasiado grande. Máximo ${MAX_STORY_SIZE_MB}MB.`);
      return;
    }

    // Check if video file > 20MB for data warning
    if (file.type.startsWith('video/') && file.size > 20 * 1024 * 1024) {
      setPendingStoryFile(file);
      setShowStoryDataWarning(true);
      return;
    }

    // Open preview modal instead of uploading directly
    const url = URL.createObjectURL(file);
    setStoryPreviewFile(file);
    setStoryPreviewUrl(url);
  }

  function handleDeleteStory(userId: number, storyId: number) {
    const localStories = user ? getLocalStoriesForUser(user.id) : [];
    const isLocal = localStories.some(s => s.id === storyId);

    if (isLocal) {
      deleteLocalStory(storyId);
      setLocalStoriesVersion(v => v + 1);
      setViewerGroupIndex(null);
    } else {
      deleteStoryMutation.mutate({ id: storyId }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/stories/feed'] });
          setViewerGroupIndex(null);
        },
        onError: (err) => {
          // Story retirado ou em análise: o servidor explica porquê (eliminacao_bloqueada).
          const bloqueada = (err as { data?: { codigo?: string; error?: string } } | null)?.data;
          toast.error(bloqueada?.codigo === 'eliminacao_bloqueada' && bloqueada.error ? bloqueada.error : 'Não foi possível eliminar o story. Tenta novamente.');
        },
      });
    }
  }

  const abrirGrupo = (utilizadorId: number) => {
    const idx = viewableGroups.findIndex((g) => g.utilizador.id === utilizadorId);
    if (idx >= 0) setViewerGroupIndex(idx);
  };

  // Estados vazios, por separador
  const VAZIO: Record<FiltroFeed, { titulo: string; texto: string; acao: 'explorar' | 'tudo' }> = {
    tudo: { titulo: 'Nada para ver aqui', texto: 'Segue alguns criadores para começares a ver conteúdo no teu feed.', acao: 'explorar' },
    seguindo: { titulo: 'Ainda não segues ninguém', texto: 'Quando seguires criadores, as publicações deles aparecem aqui.', acao: 'explorar' },
    'para-ti': { titulo: 'Ainda não há nada para ti', texto: 'Segue criadores para personalizares esta lista.', acao: 'explorar' },
    'em-alta': { titulo: 'Nada em alta de momento', texto: 'Ainda não há publicações com gostos ou comentários nas últimas 72 horas. Volta mais tarde ou vê tudo o que foi publicado.', acao: 'tudo' },
  };
  const vazio = VAZIO[filtro];

  return (
    <div className="flex justify-center w-full max-w-screen-xl mx-auto gap-12 px-0 sm:px-4 md:pr-1.5">
      {/* Coluna central: cabeçalho fixo, stories + lives, compositor, separadores e posts */}
      <div className="w-full min-w-0 max-w-[640px] shrink sm:border-x sm:border-border min-h-[100dvh]">
        <FeedHeader onAtualizar={() => { void refetchFeed(); }} aAtualizar={isFetchingFeed} />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={handleStoryFileSelected}
        />
        <StoriesLiveRow
          meuGrupo={myGroup}
          grupos={otherGroups}
          lives={liveStreams}
          aCarregar={isLoadingStories}
          onAdicionar={handleAddStoryClick}
          onVerGrupo={abrirGrupo}
          meuId={user?.id}
        />

        {viewerGroupIndex !== null && (
          <StoryViewer
            groups={viewableGroups}
            initialGroupIndex={viewerGroupIndex}
            onClose={() => setViewerGroupIndex(null)}
            onStoryViewed={(_, storyId) => markStoryViewed(storyId)}
            onDeleteStory={handleDeleteStory}
            currentUserId={user?.id}
          />
        )}

        {/* Inline Composer — only for creators */}
        {user?.tipoConta === 'criador' && (
          <div className="border-b border-border">
            <InlineComposer
              user={user}
              onOpenWithFiles={handleOpenWithFiles}
              onAbrirEnquete={() => { setModalPasso('enquete'); setModalOpen(true); }}
            />
          </div>
        )}

        <FeedTabs ativo={filtro} onMudar={setFiltro} />

        {/* Posts do separador ativo */}
        <div id="feed-painel" role="tabpanel" aria-labelledby={`feed-tab-${filtro}`} className="flex flex-col" data-testid="feed-painel">
          {isLoadingFeed && !isMockMode ? (
            Array(3).fill(0).map((_, i) => <PostSkeleton key={i} />)
          ) : isFeedError && !isMockMode ? (
            <div role="alert" className="mx-4 my-6 text-center p-10 bg-card border border-border rounded-xl" data-testid="feed-erro">
              <h3 className="text-lg font-bold mb-2">Não foi possível carregar o feed</h3>
              <p className="text-muted-foreground mb-4">Verifica a ligação e tenta novamente.</p>
              <Button variant="outline" onClick={() => { void refetchFeed(); }}>Tentar novamente</Button>
            </div>
          ) : posts.length > 0 ? (
            posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                variante="feed"
              />
            ))
          ) : (
            <div className="mx-4 my-6 text-center p-12 bg-card border border-border rounded-xl" data-testid="feed-vazio">
              <h3 className="text-xl font-bold mb-2">{vazio.titulo}</h3>
              <p className="text-muted-foreground mb-6">{vazio.texto}</p>
              {vazio.acao === 'explorar' ? (
                <Link href="/explorar">
                  <Button variant="outline" className="min-h-[44px]">Explorar criadores</Button>
                </Link>
              ) : (
                <Button variant="outline" className="min-h-[44px]" onClick={() => setFiltro('tudo')} data-testid="feed-vazio-voltar-tudo">Ver tudo</Button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Coluna direita (só em ecrãs grandes): pesquisa, sugestões, top criadores e descobrir */}
      <aside ref={colunaRef} aria-label="Descobrir" className="coluna-direita hidden lg:flex flex-col lg:sticky lg:top-0 lg:h-[100dvh] lg:self-start w-[320px] xl:w-[400px] flex-shrink-0">
        <PesquisaFeed desativada={isMockMode} />
        <BannerSugestoes />
        <TopCriadores ativo={!isMockMode} />
        <SugestoesParaTi ativo={!isMockMode} porPagina={cartoes} />
        <Link href="/explorar" className="cd-descubra shrink-0">
          <Button className="h-[var(--cd-btn,48px)] w-full gap-2 rounded-xl bg-primary text-sm font-bold tracking-wide text-primary-foreground hover:bg-primary/90" data-testid="descubra-mais">DESCUBRA MAIS CRIADORES <ChevronRight className="h-4 w-4" aria-hidden="true" /></Button>
        </Link>
      </aside>

      {/* Full modal — opens when composer has media files */}
      <CreatePostModal
        open={modalOpen}
        onClose={handleModalClose}
        initialFiles={modalInitialFiles}
        defaultStep={modalPasso}
      />

      {/* Story Preview Modal — Instagram-style editor before publishing */}
      {storyPreviewFile && storyPreviewUrl && user && (
        <StoryPreviewModal
          file={storyPreviewFile}
          previewUrl={storyPreviewUrl}
          user={user}
          onPublish={async (file, _legenda, audiencia, mais18) => {
            await uploadStory(file, audiencia, mais18);
          }}
          onClose={() => {
            if (storyPreviewUrl) URL.revokeObjectURL(storyPreviewUrl);
            setStoryPreviewFile(null);
            setStoryPreviewUrl(null);
          }}
        />
      )}

      {/* Story Video Mobile Data Warning */}
      <MobileDataWarningDialog
        open={showStoryDataWarning}
        fileSizeBytes={pendingStoryFile?.size || 0}
        onConfirm={() => {
          setShowStoryDataWarning(false);
          if (pendingStoryFile) {
            const url = URL.createObjectURL(pendingStoryFile);
            setStoryPreviewFile(pendingStoryFile);
            setStoryPreviewUrl(url);
            setPendingStoryFile(null);
          }
        }}
        onCancel={() => {
          setShowStoryDataWarning(false);
          setPendingStoryFile(null);
        }}
      />
    </div>
  );
}