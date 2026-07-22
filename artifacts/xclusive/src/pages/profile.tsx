import { useRoute } from 'wouter';
import { useGetUserProfile, useGetUserPosts, useFollowUser, useUnfollowUser } from '@workspace/api-client-react';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Grid, PlaySquare, Lock, Settings } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { SubscribeModal } from '@/components/wallet/SubscribeModal';
import { PostDetailModal } from '@/components/shared/PostDetailModal';
import type { Post } from '@workspace/api-client-react';

export default function Profile() {
  const [, params] = useRoute('/perfil/:username');
  const username = params?.username || '';
  const { user: me } = useAuth();
  
  const isMe = me?.username === username;

  const { data: profile, isLoading: isLoadingProfile } = useGetUserProfile(username, {
    query: { queryKey: ['/api/users', username], enabled: !!username }
  });

  const { data: postsData, isLoading: isLoadingPosts } = useGetUserPosts(username, {
    query: { queryKey: ['/api/users', username, 'posts'], enabled: !!username }
  });

  const followMutation = useFollowUser();
  const unfollowMutation = useUnfollowUser();

  const [isFollowingLocally, setIsFollowingLocally] = useState<boolean | undefined>(undefined);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [, setLocation] = useLocation();

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

  if (isLoadingProfile) {
    return (
      <div className="w-full max-w-screen-lg mx-auto">
        <Skeleton className="w-full h-48 sm:h-64 object-cover" />
        <div className="px-4 sm:px-8">
          <div className="relative flex justify-between items-end -mt-16 sm:-mt-20 mb-4">
            <Skeleton className="w-32 h-32 sm:w-40 sm:h-40 rounded-full border-4 border-background" />
          </div>
          <div className="space-y-4 max-w-xl">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
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

  return (
    <div className="w-full max-w-screen-lg mx-auto pb-20 sm:pb-0">
      {/* Cover Photo */}
      <div className="w-full h-48 sm:h-64 bg-secondary overflow-hidden relative">
        {profile.capaUrl ? (
          <img src={profile.capaUrl} alt="Cover" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-r from-secondary to-background" />
        )}
      </div>

      <div className="px-4 sm:px-8">
        {/* Header section with avatar and actions */}
        <div className="relative flex flex-col sm:flex-row justify-between items-start sm:items-end -mt-16 sm:-mt-20 mb-4 sm:mb-6 gap-4">
          <Avatar className="w-32 h-32 sm:w-40 sm:h-40 border-4 border-background shadow-xl">
            <AvatarImage src={profile.avatarUrl || ''} className="object-cover" />
            <AvatarFallback className="text-4xl">{profile.nomeExibicao[0]}</AvatarFallback>
          </Avatar>
          
          <div className="flex items-center gap-3 w-full sm:w-auto mt-2 sm:mt-0">
            {isMe ? (
              <>
                <Link href="/definicoes">
                  <Button variant="outline" className="font-semibold bg-secondary/50 border-border">
                    <Settings className="w-4 h-4 mr-2" /> Editar Perfil
                  </Button>
                </Link>
                {profile.tipoConta === 'criador' ? (
                  <Link href="/definicoes/monetizacao">
                    <Button className="font-semibold bg-primary hover:bg-primary/90 text-white">
                      Painel
                    </Button>
                  </Link>
                ) : (
                  <Link href="/tornar-criador">
                    <Button className="font-semibold bg-gradient-to-r from-primary to-orange-500 hover:opacity-90 text-white shadow-[0_0_20px_rgba(255,62,114,0.25)] gap-1.5">
                      <span className="text-base leading-none">⭐</span> Tornar-se Criador
                    </Button>
                  </Link>
                )}
              </>
            ) : (
              <>
                <Button 
                  onClick={handleFollowToggle}
                  variant={isFollowing ? "outline" : "default"}
                  className={`font-semibold flex-1 sm:flex-none ${!isFollowing ? 'bg-primary hover:bg-primary/90 text-white shadow-[0_0_20px_rgba(255,62,114,0.2)]' : ''}`}
                >
                  {isFollowing ? 'A seguir' : 'Seguir'}
                </Button>
                <Button
                  variant="secondary"
                  className="font-semibold flex-1 sm:flex-none"
                  onClick={() => setLocation('/mensagens')}
                >
                  Mensagem
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Profile Info */}
        <div className="mb-8 max-w-2xl">
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            {profile.nomeExibicao}
            {profile.verificado && (
              <svg className="w-6 h-6 text-primary fill-current" viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z"/></svg>
            )}
          </h1>
          <p className="text-muted-foreground font-medium mb-4">@{profile.username}</p>
          
          {profile.bio && (
            <p className="text-sm sm:text-base mb-4 whitespace-pre-wrap leading-relaxed">{profile.bio}</p>
          )}

          {profile.link && (
            <a href={profile.link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary hover:underline text-sm font-medium mb-6">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
              {profile.link.replace(/^https?:\/\//, '')}
            </a>
          )}

          <div className="flex gap-6 sm:gap-8 text-sm sm:text-base border-t border-b border-border py-4 mt-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:gap-1.5 text-center sm:text-left">
              <span className="font-bold text-lg sm:text-base">{profile.totalPublicacoes}</span>
              <span className="text-muted-foreground">publicações</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:gap-1.5 text-center sm:text-left cursor-pointer hover:opacity-80 transition-opacity">
              <span className="font-bold text-lg sm:text-base">{profile.totalSeguidores}</span>
              <span className="text-muted-foreground">fãs</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:gap-1.5 text-center sm:text-left cursor-pointer hover:opacity-80 transition-opacity">
              <span className="font-bold text-lg sm:text-base">{profile.totalSeguindo}</span>
              <span className="text-muted-foreground">a seguir</span>
            </div>
          </div>
        </div>

        {/* Content Tabs */}
        <Tabs defaultValue="posts" className="w-full">
          <TabsList className="w-full flex h-14 bg-transparent border-b border-border rounded-none p-0">
            <TabsTrigger value="posts" className="flex-1 h-full rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary text-muted-foreground">
              <Grid className="w-5 h-5 mr-2" />
              <span className="hidden sm:inline">Publicações</span>
            </TabsTrigger>
            <TabsTrigger value="reels" className="flex-1 h-full rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary text-muted-foreground">
              <PlaySquare className="w-5 h-5 mr-2" />
              <span className="hidden sm:inline">Reels</span>
            </TabsTrigger>
            {profile.tipoConta === 'criador' && (
              <TabsTrigger value="exclusive" className="flex-1 h-full rounded-none data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary text-muted-foreground">
                <Lock className="w-5 h-5 mr-2" />
                <span className="hidden sm:inline">Exclusivo</span>
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="posts" className="mt-6 focus-visible:outline-none">
            {isLoadingPosts ? (
              <div className="grid grid-cols-3 gap-1 sm:gap-4">
                {Array(6).fill(0).map((_, i) => (
                  <Skeleton key={i} className="aspect-square w-full rounded-md sm:rounded-xl" />
                ))}
              </div>
            ) : postsData?.posts && postsData.posts.length > 0 ? (
              <div className="grid grid-cols-3 gap-1 sm:gap-4">
                {postsData.posts.map((post) => (
                  <div key={post.id} className="relative aspect-square bg-secondary group cursor-pointer overflow-hidden rounded-sm sm:rounded-xl" onClick={() => setSelectedPost(post)}>
                    {post.media && post.media.length > 0 ? (
                      post.media[0].tipo === 'imagem' ? (
                        <img src={post.media[0].url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <video src={post.media[0].url} className="w-full h-full object-cover" />
                      )
                    ) : null}
                    
                    {post.exclusivo && (
                      <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-md rounded-full p-1.5">
                        <Lock className="w-4 h-4 text-white" />
                      </div>
                    )}
                    
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-6 text-white font-bold">
                      <div className="flex items-center gap-2">
                        <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                        {post.totalCurtidas}
                      </div>
                      <div className="flex items-center gap-2">
                        <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
                        {post.totalComentarios}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-20">
                <div className="w-20 h-20 bg-secondary rounded-full flex items-center justify-center mx-auto mb-6">
                  <Grid className="w-10 h-10 text-muted-foreground" />
                </div>
                <h3 className="text-xl font-bold mb-2">Ainda sem publicações</h3>
                <p className="text-muted-foreground">As fotos e vídeos que {profile.username} partilhar aparecerão aqui.</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="reels" className="mt-6 focus-visible:outline-none">
            {isLoadingPosts ? (
              <div className="grid grid-cols-3 gap-1 sm:gap-4">
                {Array(6).fill(0).map((_, i) => (
                  <Skeleton key={i} className="aspect-square w-full rounded-md sm:rounded-xl" />
                ))}
              </div>
            ) : (() => {
              const reelPosts = postsData?.posts?.filter(
                p => p.tipo === 'video' || p.media?.[0]?.tipo === 'video'
              ) ?? [];
              return reelPosts.length > 0 ? (
                <div className="grid grid-cols-3 gap-1 sm:gap-4">
                  {reelPosts.map((post) => (
                    <Link
                      key={post.id}
                      href={`/reels?id=${post.id}`}
                      className="relative aspect-square bg-secondary group cursor-pointer overflow-hidden rounded-sm sm:rounded-xl block"
                    >
                      <video
                        src={post.media?.[0]?.url}
                        className="w-full h-full object-cover"
                        muted
                        preload="metadata"
                      />
                      {/* Play icon overlay */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-10 h-10 bg-black/50 rounded-full flex items-center justify-center backdrop-blur-sm">
                          <PlaySquare className="w-5 h-5 text-white" />
                        </div>
                      </div>
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4 text-white font-bold text-sm">
                        <div className="flex items-center gap-1">
                          <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                          {post.totalCurtidas}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="text-center py-20">
                  <div className="w-20 h-20 bg-secondary rounded-full flex items-center justify-center mx-auto mb-6">
                    <PlaySquare className="w-10 h-10 text-muted-foreground" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">Ainda sem Reels</h3>
                  <p className="text-muted-foreground">Os vídeos que {profile.username} partilhar aparecerão aqui.</p>
                </div>
              );
            })()}
          </TabsContent>

          <TabsContent value="exclusive" className="mt-6">
             <div className="text-center py-20 max-w-md mx-auto border border-primary/20 rounded-2xl bg-primary/5 p-8 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary/20 rounded-full blur-3xl -mr-10 -mt-10" />
              <div className="absolute bottom-0 left-0 w-32 h-32 bg-primary/20 rounded-full blur-3xl -ml-10 -mb-10" />
              
              <div className="w-20 h-20 bg-background rounded-full flex items-center justify-center mx-auto mb-6 border border-primary/30 shadow-[0_0_20px_rgba(255,62,114,0.2)]">
                <Lock className="w-10 h-10 text-primary" />
              </div>
              <h3 className="text-2xl font-bold mb-2">Clube Exclusivo</h3>
              <p className="text-muted-foreground mb-8">
                Desbloqueia conteúdos privados, bastidores e interação direta com {profile.nomeExibicao}.
              </p>
              <Button
                className="w-full bg-primary hover:bg-primary/90 text-white font-bold h-12 shadow-[0_0_20px_rgba(255,62,114,0.3)]"
                onClick={() => setSubscribeOpen(true)}
              >
                Subscrever por 4.990 Kz / mês
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Post detail modal */}
      <PostDetailModal post={selectedPost} onClose={() => setSelectedPost(null)} />

      {/* Subscribe modal */}
      {profile && (
        <SubscribeModal
          open={subscribeOpen}
          onClose={() => setSubscribeOpen(false)}
          creatorUsername={profile.username}
          creatorNome={profile.nomeExibicao}
          creatorAvatar={profile.avatarUrl ?? null}
          creatorVerificado={profile.verificado}
          preco={4990}
          onSubscribed={() => setSubscribeOpen(false)}
        />
      )}
    </div>
  );
}