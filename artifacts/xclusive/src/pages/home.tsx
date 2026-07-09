import { useCallback, useMemo, useRef, useState } from 'react';
import { useGetFeed, useGetStoriesFeed, useGetUserSuggestions, StoryGroup } from '@workspace/api-client-react';
import { PostCard } from '@/components/shared/PostCard';
import { StoryCircle } from '@/components/shared/StoryCircle';
import { StoryViewer } from '@/components/shared/StoryViewer';
import { PostSkeleton, StorySkeleton, SuggestionSkeleton } from '@/components/shared/SkeletonLoaders';
import { useAuth } from '@/contexts/AuthContext';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import { MOCK_FEED_POSTS } from '@/data/mockPosts';
import { MOCK_STORY_GROUPS } from '@/data/mockStories';
import { addLocalStory, deleteLocalStory, getLocalStoriesForUser, localStoryToStory, markStoryViewed } from '@/lib/localStories';
import { toast } from 'sonner';

const MAX_STORY_SIZE_MB = 50;

export default function Home() {
  const { user, isMockMode } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewerGroupIndex, setViewerGroupIndex] = useState<number | null>(null);
  // Bumps whenever local stories change, to force re-reading localStorage
  const [localStoriesVersion, setLocalStoriesVersion] = useState(0);

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

  // Em modo mock sem DB, usa stories demonstrativos de outros utilizadores
  const otherGroups: StoryGroup[] = isMockMode && !storiesData?.length
    ? MOCK_STORY_GROUPS
    : (storiesData ?? []);

  // O meu grupo de stories: combina stories locais (adicionadas nesta sessão)
  const myStories = useMemo(
    () => (user ? getLocalStoriesForUser(user.id).map(s => localStoryToStory(s, user)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, localStoriesVersion]
  );
  const myGroup: StoryGroup | null = user
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
    const tipo = file.type.startsWith('video/') ? 'video' : 'imagem';
    addLocalStory(user.id, URL.createObjectURL(file), tipo);
    setLocalStoriesVersion(v => v + 1);
    toast.success('Story adicionado! Visível apenas nesta sessão.');
  }

  function handleDeleteStory(userId: number, storyId: number) {
    deleteLocalStory(storyId);
    setLocalStoriesVersion(v => v + 1);
    setViewerGroupIndex(null);
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

        {/* Posts Feed */}
        <div className="flex flex-col">
          {isLoadingFeed && !isMockMode ? (
            Array(3).fill(0).map((_, i) => <PostSkeleton key={i} />)
          ) : posts.length > 0 ? (
            posts.map((post) => (
              <PostCard 
                key={post.id} 
                post={post}
                onLike={(id) => console.log('Like', id)}
                onUnlike={(id) => console.log('Unlike', id)}
                onSave={(id) => console.log('Save', id)}
                onUnsave={(id) => console.log('Unsave', id)}
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
          <div className="flex items-center justify-between mb-8">
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

        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-muted-foreground">Sugestões para ti</span>
          <Link href="/explorar" className="text-xs font-semibold hover:text-primary transition-colors">Ver todas</Link>
        </div>

        <div className="flex flex-col gap-2">
          {isLoadingSuggestions ? (
            Array(5).fill(0).map((_, i) => <SuggestionSkeleton key={i} />)
          ) : suggestionsData?.length ? (
            suggestionsData.slice(0, 5).map(suggestion => (
              <div key={suggestion.id} className="flex items-center justify-between py-2 group">
                <Link href={`/perfil/${suggestion.username}`} className="flex items-center gap-3">
                  <Avatar className="w-10 h-10 border border-border group-hover:scale-105 transition-transform">
                    <AvatarImage src={suggestion.avatarUrl || ''} />
                    <AvatarFallback>{suggestion.nomeExibicao?.[0]}</AvatarFallback>
                  </Avatar>
                  <div className="flex flex-col">
                    <span className="font-semibold text-sm hover:underline flex items-center gap-1">
                      {suggestion.username}
                      {suggestion.verificado && (
                        <svg className="w-3 h-3 text-primary fill-current" viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z"/></svg>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                      {suggestion.tipoConta === 'criador' ? 'Criador sugerido' : 'Novo no Xclusive'}
                    </span>
                  </div>
                </Link>
                <Button variant="ghost" size="sm" className="text-primary font-bold text-xs h-8 hover:text-white hover:bg-primary/20">
                  Seguir
                </Button>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">Sem sugestões de momento.</p>
          )}
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
    </div>
  );
}