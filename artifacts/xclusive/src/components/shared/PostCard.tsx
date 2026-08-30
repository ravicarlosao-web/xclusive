import { Post, useLikePost, useUnlikePost, useSavePost, useUnsavePost, useDeletePost } from '@workspace/api-client-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Heart, MessageCircle, Send, Bookmark, MoreHorizontal, Coins, Play, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { TipModal } from './TipModal';
import { UnlockPostModal } from '@/components/wallet/UnlockPostModal';
import { SubscribeModal } from '@/components/wallet/SubscribeModal';
import { CommentsSection } from './CommentsSection';
import { MOCK_COMMENTS } from '@/data/mockComments';
import { getLocalCommentsForPost } from '@/lib/localComments';

interface PostCardProps {
  post: Post;
  onLike?: (postId: number) => void;
  onUnlike?: (postId: number) => void;
  onSave?: (postId: number) => void;
  onUnsave?: (postId: number) => void;
}

export function PostCard({ post, onLike, onUnlike, onSave, onUnsave }: PostCardProps) {
  const { user, isSubscribed, isPostUnlocked } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const queryClient = useQueryClient();
  const { mutate: apiLike } = useLikePost();
  const { mutate: apiUnlike } = useUnlikePost();
  const { mutate: apiSave } = useSavePost();
  const { mutate: apiUnsave } = useUnsavePost();
  const { mutate: apiDeletePost, isPending: isDeletingPost } = useDeletePost();

  function invalidateFeed() {
    queryClient.invalidateQueries({ queryKey: ['/api/feed'] });
    queryClient.invalidateQueries({ queryKey: [`/api/users/${post.autor.username}/posts`] });
  }

  const handleShare = async () => {
    const url = `${window.location.origin}/perfil/${post.autor.username}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: post.autor.nomeExibicao || post.autor.username, url });
      } catch {
        // utilizador cancelou — sem ação
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast({ title: 'Link copiado!', description: 'O link do perfil foi copiado para a área de transferência.' });
    }
  };
  const [isLiked, setIsLiked] = useState(post.curtido);
  const [likesCount, setLikesCount] = useState(post.totalCurtidas);
  const [isSaved, setIsSaved] = useState(post.guardado);
  const [showHeartAnimation, setShowHeartAnimation] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [gorjetasCount, setGorjetasCount] = useState(0);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsCount, setCommentsCount] = useState(
    post.totalComentarios + getLocalCommentsForPost(post.id).length,
  );
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const [localUnlocked, setLocalUnlocked] = useState(false);
  const [localSubscribed, setLocalSubscribed] = useState(false);
  const lastClickTime = useRef(0);

  const isOwnPost = user?.username === post.autor.username;
  const canDeletePost = user?.id === post.autor.id;
  const isTextPost = post.tipo === 'texto';
  const isVideo = !isTextPost && (post.tipo === 'video' || post.media?.[0]?.tipo === 'video');

  // Adaptive aspect ratio: detected from actual media dimensions
  // Clamped between 9:16 (tall portrait) and 16:9 (wide landscape)
  const [mediaAspect, setMediaAspect] = useState<number | null>(null);
  const handleVideoMeta = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (v.videoWidth && v.videoHeight) {
      const ratio = v.videoWidth / v.videoHeight;
      setMediaAspect(Math.min(Math.max(ratio, 9 / 16), 16 / 9));
    }
  };
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth && img.naturalHeight) {
      const ratio = img.naturalWidth / img.naturalHeight;
      setMediaAspect(Math.min(Math.max(ratio, 9 / 16), 16 / 9));
    }
  };

  // Check if user already has access
  const hasSubscription = localSubscribed || isSubscribed(post.autor.username);
  const hasUnlocked = localUnlocked || isPostUnlocked(post.id);
  
  let isLocked = post.bloqueado ?? (post.exclusivo && !isOwnPost);
  if (post.precoDesbloqueio ? hasUnlocked : hasSubscription) {
    isLocked = false;
  }
  const feedVideoRef = useRef<HTMLVideoElement>(null);

  // For video previews in the feed: play only when card is visible and post is not locked
  useEffect(() => {
    if (!isVideo || isLocked || !feedVideoRef.current) return;
    const video = feedVideoRef.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [isVideo, isLocked]);

  const handleLikeToggle = () => {
    if (isLiked) {
      setIsLiked(false);
      setLikesCount(prev => prev - 1);
      apiUnlike({ id: post.id }, {
        onSuccess: invalidateFeed,
        onError: () => { setIsLiked(true); setLikesCount(prev => prev + 1); },
      });
      onUnlike?.(post.id);
    } else {
      setIsLiked(true);
      setLikesCount(prev => prev + 1);
      apiLike({ id: post.id }, {
        onSuccess: invalidateFeed,
        onError: () => { setIsLiked(false); setLikesCount(prev => prev - 1); },
      });
      onLike?.(post.id);
    }
  };

  const handleSaveToggle = () => {
    if (isSaved) {
      setIsSaved(false);
      apiUnsave({ id: post.id }, {
        onSuccess: invalidateFeed,
        onError: () => setIsSaved(true),
      });
      onUnsave?.(post.id);
    } else {
      setIsSaved(true);
      apiSave({ id: post.id }, {
        onSuccess: invalidateFeed,
        onError: () => setIsSaved(false),
      });
      onSave?.(post.id);
    }
  };

  const handleMediaClick = () => {
    // Video posts → navigate directly to reels at that video
    if (isVideo) {
      setLocation(`/reels?id=${post.id}`);
      return;
    }
    // Image posts → double-tap to like
    const now = Date.now();
    if (now - lastClickTime.current < 300) {
      if (!isLiked) {
        setIsLiked(true);
        setLikesCount(prev => prev + 1);
        apiLike({ id: post.id }, {
          onSuccess: invalidateFeed,
          onError: () => { setIsLiked(false); setLikesCount(prev => prev - 1); },
        });
        onLike?.(post.id);
      }
      setShowHeartAnimation(true);
      setTimeout(() => setShowHeartAnimation(false), 1000);
    }
    lastClickTime.current = now;
  };

  const handleTipSuccess = () => {
    setGorjetasCount(c => c + 1);
  };

  const handleDeletePost = () => {
    if (!canDeletePost || isDeletingPost) return;
    const confirmed = window.confirm(
      'Tens a certeza que queres apagar este post? Esta acção é irreversível e remove também a media associada.',
    );
    if (!confirmed) return;

    apiDeletePost({ id: post.id }, {
      onSuccess: () => {
        invalidateFeed();
        toast({ title: 'Publicação eliminada' });
      },
      onError: () => {
        toast({ variant: 'destructive', title: 'Não foi possível eliminar a publicação' });
      },
    });
  };

  return (
    <>
      <article className="bg-background sm:bg-card sm:border sm:border-border sm:rounded-2xl overflow-hidden mb-6 max-w-[540px] mx-auto w-full shadow-none sm:shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-3 sm:p-4">
          <Link href={`/perfil/${post.autor.username}`} className="flex items-center gap-3 group">
            <Avatar className="w-9 h-9 border border-border group-hover:scale-105 transition-transform">
              <AvatarImage src={post.autor.avatarUrl || ''} />
              <AvatarFallback>{post.autor.nomeExibicao?.[0] || 'U'}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="text-sm font-semibold hover:underline flex items-center gap-1">
                {post.autor.username}
                {post.autor.verificado && (
                  <svg className="w-3.5 h-3.5 text-primary fill-current" viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z"/></svg>
                )}
              </span>
              {post.localizacao && <span className="text-xs text-muted-foreground">{post.localizacao}</span>}
            </div>
          </Link>
          {canDeletePost ? (
            <button
              className="text-muted-foreground hover:text-destructive transition-colors p-2 disabled:opacity-50"
              onClick={handleDeletePost}
              disabled={isDeletingPost}
              title="Apagar publicação"
              aria-label="Apagar publicação"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          ) : (
            <button className="text-muted-foreground hover:text-foreground transition-colors p-2">
              <MoreHorizontal className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Text post — rendered inline, no media container */}
        {isTextPost ? (
          <div
            className={cn(
              "mx-3 sm:mx-4 mb-1 rounded-2xl px-5 py-5 cursor-pointer select-none relative",
              "bg-gradient-to-br from-secondary/60 to-secondary/30 border border-border/50",
            )}
            onClick={handleMediaClick}
          >
            {/* Locked overlay for text posts */}
            {isLocked && (
              <div className="absolute inset-0 rounded-2xl backdrop-blur-md bg-black/40 z-10 flex flex-col items-center justify-center p-4 text-center" onClick={e => e.stopPropagation()}>
                {post.precoDesbloqueio ? (
                  <>
                    <div className="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center mb-3">
                      <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    </div>
                    <p className="text-xs text-white/70 mb-3 max-w-[180px]">Conteúdo exclusivo — desbloqueia por pagamento único.</p>
                    <button onClick={() => setUnlockOpen(true)} className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-4 py-2 rounded-full text-xs transition-colors">
                      Desbloquear · {Number(post.precoDesbloqueio).toLocaleString('pt-PT')} Kz
                    </button>
                  </>
                ) : (
                  <>
                    <div className="w-10 h-10 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center mb-3">
                      <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    </div>
                    <p className="text-xs text-white/70 mb-3 max-w-[180px]">Exclusivo para subscritores de {post.autor.username}.</p>
                    <button onClick={() => setSubscribeOpen(true)} className="bg-primary hover:bg-primary/90 text-white font-bold px-4 py-2 rounded-full text-xs transition-colors">Subscrever</button>
                  </>
                )}
              </div>
            )}

            <p className={cn(
              "whitespace-pre-wrap leading-relaxed break-words",
              (post.legenda?.length ?? 0) > 280 ? "text-base" : (post.legenda?.length ?? 0) > 140 ? "text-lg" : "text-xl font-medium",
            )}>
              {post.legenda}
            </p>

            {/* Exclusive badge for text */}
            {post.exclusivo && (
              <div className="mt-3 inline-flex items-center gap-1 bg-primary/15 text-primary text-[10px] font-bold px-2 py-0.5 rounded-full">
                <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2l2.5 6.5H19l-5.5 4.5 2 7L10 15.5 4.5 20l2-7L1 8.5h6.5z"/></svg>
                EXCLUSIVO
              </div>
            )}

            {/* Double-click heart */}
            <AnimatePresence>
              {showHeartAnimation && (
                <motion.div initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1.2 }} exit={{ opacity: 0, scale: 1 }} transition={{ duration: 0.3, type: "spring", bounce: 0.5 }} className="absolute z-30 pointer-events-none drop-shadow-2xl text-primary inset-0 flex items-center justify-center">
                  <Heart className="w-20 h-20 fill-current" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          /* Media — aspect ratio adapts to the actual media dimensions (clamped 9:16 → 16:9) */
          <div
            className={cn(
              "relative w-full bg-secondary flex items-center justify-center overflow-hidden cursor-pointer select-none",
              !mediaAspect && (isVideo ? "aspect-video" : "aspect-[4/5] sm:aspect-square"),
            )}
            style={mediaAspect ? { aspectRatio: mediaAspect } : undefined}
            onClick={handleMediaClick}
          >
            {isLocked ? (
              <div className="absolute inset-0 backdrop-blur-xl bg-black/50 z-10 flex flex-col items-center justify-center p-6 text-center" onClick={e => e.stopPropagation()}>
                {post.precoDesbloqueio ? (
                  <>
                    <div className="w-14 h-14 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center mb-4">
                      <svg className="w-7 h-7 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    </div>
                    <span className="text-[10px] font-bold tracking-widest text-amber-400 uppercase mb-1">Conteúdo Premium</span>
                    <h3 className="text-lg font-bold text-white mb-1">Acesso único</h3>
                    <p className="text-sm text-white/60 mb-5 max-w-[200px]">Desbloqueia apenas este post por um pagamento único.</p>
                    <button onClick={() => setUnlockOpen(true)} className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-6 py-2.5 rounded-full transition-colors shadow-[0_0_24px_rgba(245,158,11,0.35)] text-sm">
                      Desbloquear · {Number(post.precoDesbloqueio).toLocaleString('pt-PT')} Kz
                    </button>
                  </>
                ) : (
                  <>
                    <div className="w-14 h-14 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center mb-4">
                      <svg className="w-7 h-7 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    </div>
                    <span className="text-[10px] font-bold tracking-widest text-primary uppercase mb-1">Exclusivo para assinantes</span>
                    <h3 className="text-lg font-bold text-white mb-1">Conteúdo bloqueado</h3>
                    <p className="text-sm text-white/60 mb-5 max-w-[200px]">Subscreve {post.autor.username} para teres acesso a todo o conteúdo exclusivo.</p>
                    <button onClick={() => setSubscribeOpen(true)} className="bg-primary hover:bg-primary/90 text-white font-bold px-6 py-2.5 rounded-full transition-colors shadow-[0_0_24px_rgba(255,62,114,0.35)] text-sm">Subscrever</button>
                  </>
                )}
              </div>
            ) : null}

            {post.media && post.media.length > 0 && post.media[0].url ? (
              isVideo ? (
                <>
                  <video ref={feedVideoRef} src={post.media[0].url} className="w-full h-full object-cover pointer-events-none" muted loop playsInline onLoadedMetadata={handleVideoMeta} />
                  <div className="absolute bottom-3 right-3 bg-black/60 backdrop-blur-sm rounded-full p-2 pointer-events-none">
                    <Play className="w-4 h-4 text-white fill-white" />
                  </div>
                </>
              ) : (
                <img src={post.media[0].url} alt="Post" className="w-full h-full object-cover" onLoad={handleImageLoad} />
              )
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-secondary to-background flex items-center justify-center">
                <span className="text-muted-foreground font-medium">Conteúdo não disponível</span>
              </div>
            )}

            {post.exclusivo && (
              <div className="absolute top-3 right-3 bg-primary text-white text-xs font-bold px-2 py-1 rounded-md flex items-center gap-1 shadow-lg z-20">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2l2.5 6.5H19l-5.5 4.5 2 7L10 15.5 4.5 20l2-7L1 8.5h6.5z"/></svg>
                EXCLUSIVO
              </div>
            )}

            <AnimatePresence>
              {showHeartAnimation && (
                <motion.div initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1.2 }} exit={{ opacity: 0, scale: 1 }} transition={{ duration: 0.3, type: "spring", bounce: 0.5 }} className="absolute z-30 pointer-events-none drop-shadow-2xl text-primary">
                  <Heart className="w-24 h-24 fill-current" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Actions */}
        <div className="p-3 sm:p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <button onClick={handleLikeToggle} className="group">
                <Heart className={cn("w-7 h-7 transition-colors group-active:scale-90", isLiked ? "fill-primary text-primary" : "text-foreground hover:text-muted-foreground")} />
              </button>
              <button onClick={() => setCommentsOpen(v => !v)} className="group">
                <MessageCircle className="w-7 h-7 transition-transform group-active:scale-90 text-foreground hover:text-muted-foreground" />
              </button>
              <button className="group" onClick={handleShare} title="Partilhar">
                <Send className="w-7 h-7 transition-transform group-active:scale-90 text-foreground hover:text-muted-foreground" />
              </button>

              {/* Gorjeta — só aparece em posts de outros utilizadores */}
              {!isOwnPost && (
                <button
                  onClick={() => setTipOpen(true)}
                  className="group flex items-center gap-1"
                  title="Dar gorjeta"
                >
                  <Coins className={cn(
                    "w-7 h-7 transition-all group-active:scale-90",
                    gorjetasCount > 0
                      ? "text-yellow-500 fill-yellow-500/20"
                      : "text-foreground hover:text-yellow-500 stroke-[1.5px]"
                  )} />
                  {gorjetasCount > 0 && (
                    <span className="text-xs font-semibold text-yellow-500 leading-none">{gorjetasCount}</span>
                  )}
                </button>
              )}
            </div>
            <button onClick={handleSaveToggle} className="group">
              <Bookmark className={cn("w-7 h-7 transition-transform group-active:scale-90", isSaved ? "fill-foreground text-foreground" : "text-foreground hover:text-muted-foreground")} />
            </button>
          </div>

          {/* Likes Count */}
          <div className="font-semibold text-sm mb-2">
            {likesCount.toLocaleString()} {likesCount === 1 ? 'Gosto' : 'Gostos'}
          </div>

          {/* Caption — hidden for text posts (content already shown above) */}
          {post.legenda && !isTextPost && (
            <div className="text-sm mb-2">
              <Link href={`/perfil/${post.autor.username}`} className="font-semibold hover:underline mr-2">
                {post.autor.username}
              </Link>
              <span className="whitespace-pre-wrap">{post.legenda}</span>
            </div>
          )}

          {/* Comments link */}
          {commentsCount > 0 && (
            <button onClick={() => setCommentsOpen(v => !v)} className="text-sm text-muted-foreground mb-1 hover:text-foreground">
              {commentsOpen ? 'Ocultar comentários' : `Ver todos os ${commentsCount} comentários`}
            </button>
          )}

          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
            {new Date(post.criadoEm).toLocaleDateString('pt-PT', { day: 'numeric', month: 'long' })}
          </div>
        </div>

        {/* Inline comments, embutidas no próprio card (não é um pop-up) */}
        <CommentsSection
          open={commentsOpen}
          postId={post.id}
          postAuthorUsername={post.autor.username}
          seedComments={MOCK_COMMENTS[post.id] || []}
          onCommentAdded={() => setCommentsCount(c => c + 1)}
        />
      </article>

      {/* Tip Modal */}
      <TipModal
        open={tipOpen}
        onClose={() => setTipOpen(false)}
        creator={{
          username: post.autor.username,
          nomeExibicao: post.autor.nomeExibicao || null,
          avatarUrl: post.autor.avatarUrl || null,
          verificado: post.autor.verificado ?? false,
        }}
        postId={post.id}
        onTipSent={handleTipSuccess}
      />

      {/* Unlock Modal (pay-per-view) */}
      {post.precoDesbloqueio && (
        <UnlockPostModal
          open={unlockOpen}
          onClose={() => setUnlockOpen(false)}
          postId={post.id}
          creatorUsername={post.autor.username}
          creatorNome={post.autor.nomeExibicao || post.autor.username}
          preco={Number(post.precoDesbloqueio)}
          onUnlocked={() => setLocalUnlocked(true)}
        />
      )}

      {/* Subscribe Modal */}
      {!post.precoDesbloqueio && (
        <SubscribeModal
          open={subscribeOpen}
          onClose={() => setSubscribeOpen(false)}
          creatorUsername={post.autor.username}
          creatorNome={post.autor.nomeExibicao || post.autor.username}
          creatorAvatar={post.autor.avatarUrl || null}
          creatorVerificado={post.autor.verificado ?? false}
          preco={4990}
          onSubscribed={() => setLocalSubscribed(true)}
        />
      )}
    </>
  );
}
