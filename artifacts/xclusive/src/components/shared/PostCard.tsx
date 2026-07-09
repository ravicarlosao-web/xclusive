import { Post } from '@workspace/api-client-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Heart, MessageCircle, Send, Bookmark, MoreHorizontal, Coins, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { TipModal } from './TipModal';
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
  const { user } = useAuth();
  const [, setLocation] = useLocation();
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
  const lastClickTime = useRef(0);

  const isOwnPost = user?.username === post.autor.username;
  const isVideo = post.tipo === 'video' || post.media?.[0]?.tipo === 'video';
  const feedVideoRef = useRef<HTMLVideoElement>(null);

  // For video previews in the feed: play only when card is visible, pause when scrolled away
  useEffect(() => {
    if (!isVideo || !feedVideoRef.current) return;
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
  }, [isVideo]);

  const handleLikeToggle = () => {
    if (isLiked) {
      setIsLiked(false);
      setLikesCount(prev => prev - 1);
      onUnlike?.(post.id);
    } else {
      setIsLiked(true);
      setLikesCount(prev => prev + 1);
      onLike?.(post.id);
    }
  };

  const handleSaveToggle = () => {
    if (isSaved) {
      setIsSaved(false);
      onUnsave?.(post.id);
    } else {
      setIsSaved(true);
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
          <button className="text-muted-foreground hover:text-foreground transition-colors p-2">
            <MoreHorizontal className="w-5 h-5" />
          </button>
        </div>

        {/* Media */}
        <div
          className="relative w-full bg-secondary aspect-[4/5] sm:aspect-square flex items-center justify-center overflow-hidden cursor-pointer select-none"
          onClick={handleMediaClick}
        >
          {post.exclusivo && !post.precoDesbloqueio ? (
            <div className="absolute inset-0 backdrop-blur-md bg-black/40 z-10 flex flex-col items-center justify-center p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Conteúdo Exclusivo</h3>
              <p className="text-sm text-gray-300 mb-6">Subscreve a {post.autor.username} para desbloqueares este conteúdo.</p>
              <button className="bg-primary text-primary-foreground font-semibold px-6 py-2.5 rounded-full hover:bg-primary/90 transition-colors shadow-[0_0_20px_rgba(255,62,114,0.3)]">
                Subscrever por {post.precoDesbloqueio ? `${Number(post.precoDesbloqueio).toLocaleString('pt-PT')} Kz` : 'Plano'}
              </button>
            </div>
          ) : null}

          {post.media && post.media.length > 0 ? (
            isVideo ? (
              <>
                <video
                  ref={feedVideoRef}
                  src={post.media[0].url}
                  className="w-full h-full object-cover pointer-events-none"
                  muted
                  loop
                  playsInline
                />
                {/* Gradient overlay + play badge + "Ver Reel" label */}
                <div className="absolute inset-0 pointer-events-none">
                  {/* subtle dark vignette so the badge is always readable */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/20" />
                  {/* centered play circle */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    <div className="w-16 h-16 rounded-full bg-black/55 backdrop-blur-sm border border-white/20 flex items-center justify-center shadow-2xl">
                      <Play className="w-8 h-8 text-white fill-white ml-1" />
                    </div>
                    <span className="text-white text-xs font-semibold tracking-wide drop-shadow-lg bg-black/40 backdrop-blur-sm px-3 py-1 rounded-full">
                      Ver Reel
                    </span>
                  </div>
                  {/* VIDEO badge — top left */}
                  <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm text-white text-[10px] font-bold tracking-widest px-2 py-0.5 rounded">
                    VÍDEO
                  </div>
                </div>
              </>
            ) : (
              <img src={post.media[0].url} alt="Post" className="w-full h-full object-cover" />
            )
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-secondary to-background flex items-center justify-center">
              <span className="text-muted-foreground font-medium">Conteúdo não disponível</span>
            </div>
          )}

          {/* Exclusive Badge */}
          {post.exclusivo && (
            <div className="absolute top-3 right-3 bg-primary text-white text-xs font-bold px-2 py-1 rounded-md flex items-center gap-1 shadow-lg z-20">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2l2.5 6.5H19l-5.5 4.5 2 7L10 15.5 4.5 20l2-7L1 8.5h6.5z"/></svg>
              EXCLUSIVO
            </div>
          )}

          {/* Double-click Heart Animation */}
          <AnimatePresence>
            {showHeartAnimation && (
              <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1.2 }}
                exit={{ opacity: 0, scale: 1 }}
                transition={{ duration: 0.3, type: "spring", bounce: 0.5 }}
                className="absolute z-30 pointer-events-none drop-shadow-2xl text-primary"
              >
                <Heart className="w-24 h-24 fill-current" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

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
              <button className="group">
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

          {/* Caption */}
          {post.legenda && (
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
        onClose={() => {
          setTipOpen(false);
          // check if tip was sent by listening to saldo change — handled in TipModal via onClose after success
        }}
        creator={{
          username: post.autor.username,
          nomeExibicao: post.autor.nomeExibicao || null,
          avatarUrl: post.autor.avatarUrl || null,
          verificado: post.autor.verificado ?? false,
        }}
        postId={post.id}
        onTipSent={handleTipSuccess}
      />
    </>
  );
}
