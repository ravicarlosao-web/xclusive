import { useCallback, useMemo, useRef, useState } from 'react';
import { useGetFeed, useGetStoriesFeed, useGetUserSuggestions, useFollowUser, useUnfollowUser, useDeleteStory, StoryGroup, getFreshAuthToken } from '@workspace/api-client-react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { Flame, Heart, WifiOff } from 'lucide-react';
import { PostCard } from '@/components/shared/PostCard';
import { StoryCircle } from '@/components/shared/StoryCircle';
import { StoryViewer } from '@/components/shared/StoryViewer';
import { PostSkeleton, StorySkeleton, SuggestionSkeleton } from '@/components/shared/SkeletonLoaders';
import { InlineComposer } from '@/components/shared/InlineComposer';
import { CreatePostModal } from '@/components/shared/CreatePostModal';
import { MobileDataWarningDialog } from '@/components/shared/MobileDataWarningDialog';
import { useAuth } from '@/contexts/AuthContext';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import { MOCK_FEED_POSTS } from '@/data/mockPosts';
import { MOCK_STORY_GROUPS } from '@/data/mockStories';
import { addLocalStory, deleteLocalStory, getLocalStoriesForUser, localStoryToStory, markStoryViewed } from '@/lib/localStories';
import { toast } from 'sonner';

const MAX_STORY_SIZE_MB = 500;

interface TopCreator {
  id: number;
  username: string;
  nomeExibicao: string;
  avatarUrl: string | null;
  verificado: boolean;
  tipoConta?: string;
  totalPublicacoes: number;
  totalCurtidas: number;
  totalSeguidores?: number;
  estaASeguir?: boolean;
}

function formatNumberCompact(num: number): string {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return (num || 0).toLocaleString('pt-PT');
}

export default function Home() {
  const { user, isMockMode } = useAuth();
  const queryClient = useQueryClient();
  const deleteStoryMutation = useDeleteStory();
  const [followingMap, setFollowingMap] = useState<Record<number, boolean>>({});
  const followMutation = useFollowUser();
  const unfollowMutation = useUnfollowUser();

  // Inline composer → full modal (for media posts)
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInitialFiles, setModalInitialFiles] = useState<File[]>([]);

  function handleOpenWithFiles(files: File[]) {
    setModalInitialFiles(files);
    setModalOpen(true);
  }

  function handleModalClose() {
    setModalOpen(false);
    setModalInitialFiles([]);
    queryClient.invalidateQueries({ queryKey: ['/api/feed', 1] });
  }

  const handleSuggestionFollow = (id: number, username: string) => {
    const isNowFollowing = !followingMap[id];
    setFollowingMap(prev => ({ ...prev, [id]: isNowFollowing }));
    if (isNowFollowing) {
      followMutation.mutate({ username });
    } else {
      unfollowMutation.mutate({ username });
    }
  };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewerGroupIndex, setViewerGroupIndex] = useState<number | null>(null);
  // Bumps whenever local stories change, to force re-reading localStorage
  const [localStoriesVersion, setLocalStoriesVersion] = useState(0);

  // Story video data warning state
  const [pendingStoryFile, setPendingStoryFile] = useState<File | null>(null);
  const [showStoryDataWarning, setShowStoryDataWarning] = useState(false);

  // Queries
  const { data: feedData, isLoading: isLoadingFeed } = useGetFeed(
    { page: 1, limit: 10 },
    { query: { queryKey: ['/api/feed', 1] } }
  );

  // Em modo mock sem DB, usa posts demonstrativos
  const posts = isMockMode && !feedData?.posts?.length
    ? MOCK_FEED_POSTS
    : (feedData?.posts ?? []);

  const { data: storiesData, isLoading: isLoadingStories } = useGetStoriesFeed({
    query: { queryKey: ['/api/stories/feed'] }
  });

  const { data: suggestionsData, isLoading: isLoadingSuggestions } = useGetUserSuggestions({
    query: { queryKey: ['/api/users/suggestions'] }
  });

  // Top Criadores — apenas dados reais da base de dados (sem fallback mock)
  const { data: topCreatorsData, isLoading: isLoadingTopCreators, isError: isTopCreatorsError } = useQuery<TopCreator[]>({
    queryKey: ['/api/users/top-creators'],
    queryFn: async () => {
      const token = localStorage.getItem('xclusive_token');
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
      const res = await fetch(`${base}/api/users/top-creators`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Falha ao carregar top criadores');
      return await res.json();
    },
    staleTime: 60_000,
    // Não executar em modo mock — sem base de dados real ligada
    enabled: !isMockMode,
    retry: 1,
  });

  // Apenas dados reais — nunca dados demonstrativos
  const topCreators: TopCreator[] = (!isMockMode && topCreatorsData) ? topCreatorsData : [];

  // Em modo mock sem DB, usa stories demonstrativos de outros utilizadores
  const otherGroups: StoryGroup[] = isMockMode && !storiesData?.length
    ? MOCK_STORY_GROUPS
    : (storiesData ?? []);

  // O meu grupo de stories: apenas para criadores
  const isCriador = user?.tipoConta === 'criador';
  const myStories = useMemo(
    () => (user && isCriador ? getLocalStoriesForUser(user.id).map(s => localStoryToStory(s, user)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, isCriador, localStoriesVersion]
  );
  const myGroup: StoryGroup | null = user && isCriador
    ? { utilizador: user, stories: myStories, hasNaoVisto: false }
    : null;

  // Lista usada pelo viewer: apenas grupos com pelo menos 1 story (eu primeiro, se tiver)
  const viewableGroups: StoryGroup[] = [
    ...(myGroup && myGroup.stories.length > 0 ? [myGroup] : []),
    ...otherGroups.filter(g => g.stories.length > 0),
  ];

  const handleAddStoryClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  async function uploadStory(file: File) {
    if (!user) return;
    const tipo = file.type.startsWith('video/') ? 'video' : 'imagem';

    if (isMockMode) {
      addLocalStory(user.id, URL.createObjectURL(file), tipo);
      setLocalStoriesVersion(v => v + 1);
      toast.success('Story adicionado! Visível apenas nesta sessão.');
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
        files?: { url: string; tipo: string }[];
        error?: string;
      } | null;
      if (!uploadResponse.ok) {
        throw new Error(uploadBody?.error || `Upload falhou: ${uploadResponse.status}`);
      }

      const uploadedFile = uploadBody?.files?.[0];
      if (!uploadedFile?.url) {
        throw new Error('O upload não devolveu um URL de media.');
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
        }),
      });
      const storyBody = await storyResponse.json().catch(() => null) as { error?: string } | null;
      if (!storyResponse.ok) {
        throw new Error(storyBody?.error || `Criação da story falhou: ${storyResponse.status}`);
      }

      await queryClient.invalidateQueries({ queryKey: ['/api/stories/feed'] });
      toast.success('Story publicado!');
    } catch (error) {
      console.error('[Stories] creation error:', error);
      toast.error(error instanceof Error ? error.message : 'Erro ao publicar story. Tenta novamente.');
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

    void uploadStory(file);
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
        onError: () => {
          toast.error('Não foi possível eliminar o story. Tenta novamente.');
        },
      });
    }
  }

  return (
    <div className="flex justify-center w-full max-w-screen-xl mx-auto gap-8 pt-4 sm:pt-8 px-0 sm:px-4">
      {/* Main Feed Column */}
      <div className="w-full max-w-[540px] flex-shrink-0">
        
        {/* Stories Section */}
        <div className="mb-8">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={handleStoryFileSelected}
          />
          <ScrollArea className="w-full whitespace-nowrap bg-background sm:bg-card sm:border sm:border-border sm:rounded-xl p-3 sm:p-4">
            <div className="flex w-max space-x-4">
              {/* My Story */}
              {myGroup && (
                <StoryCircle
                  group={myGroup}
                  isMe
                  onView={() => {
                    const idx = viewableGroups.findIndex(g => g.utilizador.id === myGroup.utilizador.id);
                    if (idx >= 0) setViewerGroupIndex(idx);
                  }}
                  onAdd={handleAddStoryClick}
                />
              )}

              {isLoadingStories ? (
                Array(5).fill(0).map((_, i) => <StorySkeleton key={i} />)
              ) : (
                otherGroups.map((group) => (
                  <StoryCircle
                    key={group.utilizador.id}
                    group={group}
                    onView={() => {
                      const idx = viewableGroups.findIndex(g => g.utilizador.id === group.utilizador.id);
                      if (idx >= 0) setViewerGroupIndex(idx);
                    }}
                  />
                ))
              )}
            </div>
            <ScrollBar orientation="horizontal" className="hidden" />
          </ScrollArea>
        </div>

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
          <InlineComposer
            user={user}
            onOpenWithFiles={handleOpenWithFiles}
          />
        )}

        {/* Posts Feed */}
        <div className="flex flex-col">
          {isLoadingFeed && !isMockMode ? (
            Array(3).fill(0).map((_, i) => <PostSkeleton key={i} />)
          ) : posts.length > 0 ? (
            posts.map((post) => (
              <PostCard 
                key={post.id} 
                post={post}
              />
            ))
          ) : (
            <div className="text-center p-12 bg-card border border-border rounded-xl">
              <h3 className="text-xl font-bold mb-2">Nada para ver aqui</h3>
              <p className="text-muted-foreground mb-6">Segue alguns criadores para começares a ver conteúdo no teu feed.</p>
              <Link href="/explorar">
                <Button className="bg-primary text-white hover:bg-primary/90">
                  Explorar Criadores
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Right Column (Desktop Only) */}
      <div className="hidden lg:block w-[320px] flex-shrink-0 pt-2">
        {user && (
          <div className="flex items-center justify-between mb-6">
            <Link href={`/perfil/${user.username}`} className="flex items-center gap-4 group">
              <Avatar className="w-14 h-14 border border-border group-hover:scale-105 transition-transform">
                <AvatarImage src={user.avatarUrl || ''} />
                <AvatarFallback>{user.nomeExibicao?.[0]}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col">
                <span className="font-bold text-sm hover:underline">{user.username}</span>
                <span className="text-sm text-muted-foreground">{user.nomeExibicao}</span>
              </div>
            </Link>
            <Link href="/login" className="text-xs font-bold text-primary hover:text-white transition-colors">
              Mudar
            </Link>
          </div>
        )}

        {/* Top Criadores Section */}
        <div className="mb-6 bg-card/70 border border-border/80 rounded-2xl p-3.5 shadow-sm">
          <div className="flex items-center justify-between mb-3 px-0.5">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-rose-500 to-amber-500 flex items-center justify-center shadow-[0_0_10px_rgba(244,63,94,0.35)]">
                <Flame className="w-3.5 h-3.5 text-white fill-current" />
              </div>
              <span className="text-sm font-bold tracking-tight text-foreground">Top Criadores</span>
            </div>
            <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
              Em alta
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            {isLoadingTopCreators ? (
              Array(3).fill(0).map((_, i) => <SuggestionSkeleton key={i} />)
            ) : isMockMode ? (
              /* Sem base de dados real ligada */
              <div className="flex flex-col items-center gap-2 py-4 px-2">
                <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                  <WifiOff className="w-4 h-4 text-muted-foreground" />
                </div>
                <p className="text-xs text-muted-foreground text-center leading-relaxed">
                  Sem ligação à base de dados.
                  <br />
                  Conecta ao servidor para ver o ranking real.
                </p>
              </div>
            ) : isTopCreatorsError ? (
              /* Erro ao carregar */
              <div className="flex flex-col items-center gap-2 py-4 px-2">
                <div className="w-8 h-8 rounded-full bg-destructive/10 flex items-center justify-center">
                  <WifiOff className="w-4 h-4 text-destructive/60" />
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Não foi possível carregar o ranking.
                </p>
              </div>
            ) : topCreators.length > 0 ? (
              topCreators.map((creator, index) => {
                const isFirst = index === 0;
                const isSecond = index === 1;
                const isThird = index === 2;

                const rankBadgeClass = isFirst
                  ? "bg-amber-400/20 text-amber-300 border-amber-400/50 shadow-[0_0_8px_rgba(251,191,36,0.3)]"
                  : isSecond
                  ? "bg-slate-300/20 text-slate-200 border-slate-300/40"
                  : isThird
                  ? "bg-amber-700/20 text-amber-400 border-amber-600/40"
                  : "bg-secondary text-muted-foreground border-border/60";

                const isFollowing = followingMap[creator.id] ?? creator.estaASeguir;

                return (
                  <div
                    key={creator.id}
                    className="flex items-center justify-between p-2 rounded-xl hover:bg-secondary/70 transition-colors group"
                  >
                    <Link href={`/perfil/${creator.username}`} className="flex items-center gap-2.5 min-w-0 flex-1">
                      {/* Rank Indicator */}
                      <span className={`w-5 h-5 rounded-full text-[11px] font-black flex items-center justify-center shrink-0 border ${rankBadgeClass}`}>
                        {index + 1}
                      </span>

                      {/* Avatar */}
                      <Avatar className={`w-9 h-9 border transition-transform group-hover:scale-105 shrink-0 ${isFirst ? 'border-amber-400/60 ring-1 ring-amber-400/30' : 'border-border'}`}>
                        <AvatarImage src={creator.avatarUrl || ''} />
                        <AvatarFallback className="text-xs font-bold">{creator.nomeExibicao?.[0] || creator.username[0]}</AvatarFallback>
                      </Avatar>

                      {/* Creator Info & Activity Metrics */}
                      <div className="flex flex-col min-w-0 flex-1 pr-1">
                        <div className="flex items-center gap-1">
                          <span className="font-semibold text-xs text-foreground truncate hover:underline group-hover:text-primary transition-colors">
                            {creator.username}
                          </span>
                          {creator.verificado && (
                            <svg className="w-3 h-3 text-primary fill-current shrink-0" viewBox="0 0 24 24">
                              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z"/>
                            </svg>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                          <span className="flex items-center gap-0.5 text-rose-400 font-medium">
                            <Heart className="w-2.5 h-2.5 fill-current" />
                            {formatNumberCompact(creator.totalCurtidas)}
                          </span>
                          <span className="text-muted-foreground/40">•</span>
                          <span className="text-[10px] text-muted-foreground/80 font-medium truncate">
                            {creator.totalPublicacoes} {creator.totalPublicacoes === 1 ? 'post' : 'posts'}
                          </span>
                        </div>
                      </div>
                    </Link>

                    {/* Follow Action Button */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`font-bold text-[11px] h-7 px-2.5 rounded-lg shrink-0 transition-colors ${
                        isFollowing
                          ? 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                          : 'text-primary hover:text-white hover:bg-primary/20 bg-primary/10'
                      }`}
                      onClick={() => handleSuggestionFollow(creator.id, creator.username)}
                    >
                      {isFollowing ? 'A seguir' : 'Seguir'}
                    </Button>
                  </div>
                );
              })
            ) : (
              /* DB ligada mas sem criadores com atividade */
              <p className="text-xs text-muted-foreground text-center py-3">
                Ainda não há criadores com publicações.
              </p>
            )}
          </div>
        </div>

        {/* Sugestões para ti */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3 px-1">
            <span className="text-sm font-semibold text-muted-foreground">Sugestões para ti</span>
            <Link href="/explorar" className="text-xs font-semibold hover:text-primary transition-colors">Ver todas</Link>
          </div>

          <div className="flex flex-col gap-1">
            {isLoadingSuggestions ? (
              Array(3).fill(0).map((_, i) => <SuggestionSkeleton key={i} />)
            ) : suggestionsData?.length ? (
              suggestionsData.slice(0, 4).map(suggestion => (
                <div key={suggestion.id} className="flex items-center justify-between py-1.5 px-1 group rounded-lg hover:bg-secondary/40 transition-colors">
                  <Link href={`/perfil/${suggestion.username}`} className="flex items-center gap-3 min-w-0 flex-1">
                    <Avatar className="w-8 h-8 border border-border group-hover:scale-105 transition-transform shrink-0">
                      <AvatarImage src={suggestion.avatarUrl || ''} />
                      <AvatarFallback className="text-xs">{suggestion.nomeExibicao?.[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col min-w-0">
                      <span className="font-semibold text-xs hover:underline flex items-center gap-1 truncate">
                        {suggestion.username}
                        {suggestion.verificado && (
                          <svg className="w-3 h-3 text-primary fill-current shrink-0" viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z"/></svg>
                        )}
                      </span>
                      <span className="text-[10px] text-muted-foreground truncate max-w-[130px]">
                        {suggestion.tipoConta === 'criador' ? 'Criador sugerido' : 'Novo no Xclusive'}
                      </span>
                    </div>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`font-bold text-xs h-7 px-2.5 transition-colors ${followingMap[suggestion.id] ? 'text-muted-foreground hover:text-foreground' : 'text-primary hover:text-white hover:bg-primary/20'}`}
                    onClick={() => handleSuggestionFollow(suggestion.id, suggestion.username)}
                  >
                    {followingMap[suggestion.id] ? 'A seguir' : 'Seguir'}
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground text-center py-2">Sem sugestões de momento.</p>
            )}
          </div>
        </div>

        <div className="mt-8 pt-4 border-t border-border">
          <div className="flex flex-wrap gap-x-3 gap-y-2 text-[11px] text-muted-foreground">
            <a href="#" className="hover:underline">Sobre</a>
            <a href="#" className="hover:underline">Ajuda</a>
            <a href="#" className="hover:underline">Imprensa</a>
            <a href="#" className="hover:underline">API</a>
            <a href="#" className="hover:underline">Carreiras</a>
            <a href="#" className="hover:underline">Privacidade</a>
            <a href="#" className="hover:underline">Termos</a>
          </div>
          <p className="text-[11px] text-muted-foreground mt-4 uppercase">
            &copy; {new Date().getFullYear()} Xclusive
          </p>
        </div>
      </div>

      {/* Full modal — opens when composer has media files */}
      <CreatePostModal
        open={modalOpen}
        onClose={handleModalClose}
        initialFiles={modalInitialFiles}
      />

      {/* Story Video Mobile Data Warning */}
      <MobileDataWarningDialog
        open={showStoryDataWarning}
        fileSizeBytes={pendingStoryFile?.size || 0}
        onConfirm={() => {
          setShowStoryDataWarning(false);
          if (pendingStoryFile) {
            void uploadStory(pendingStoryFile);
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