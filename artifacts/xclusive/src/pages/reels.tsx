import { useState, useRef, useEffect, useCallback } from 'react';
import { Heart, MessageCircle, Share2, MoreHorizontal, Music, Play, Volume2, VolumeX } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useGetFeed } from '@workspace/api-client-react';
import { type Post } from '@workspace/api-client-react';
import { Link, useSearch } from 'wouter';

export default function Reels() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initialId = params.get('id') ? Number(params.get('id')) : null;

  const { data, isLoading } = useGetFeed({ page: 1, limit: 20 });
  const allPosts = data?.posts ?? [];

  // Only show video posts
  const posts = allPosts.filter(
    (p) => p.tipo === 'video' || p.media?.[0]?.tipo === 'video',
  );

  // Map postId → container DOM element for reliable deep-link scrolling
  const reelRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const setReelRef = useCallback(
    (id: number) => (el: HTMLDivElement | null) => {
      if (el) reelRefs.current.set(id, el);
      else reelRefs.current.delete(id);
    },
    [],
  );

  // After posts load, jump to the reel the user clicked from the feed
  useEffect(() => {
    if (!initialId || posts.length === 0) return;
    const el = reelRefs.current.get(initialId);
    if (el) {
      el.scrollIntoView({ behavior: 'instant' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialId, posts.length]);

  return (
    <div className="h-[100dvh] w-full bg-black flex items-center justify-center relative overflow-hidden">
      <div className="w-full h-full max-w-[500px] overflow-y-scroll snap-y snap-mandatory no-scrollbar relative">
        {isLoading ? (
          <div className="w-full h-[100dvh] flex items-center justify-center text-white/60">
            A carregar Reels…
          </div>
        ) : posts.length === 0 ? (
          <div className="w-full h-[100dvh] flex items-center justify-center text-white/50 text-center px-8">
            <p>Ainda não há vídeos no feed.</p>
          </div>
        ) : (
          posts.map((post) => (
            <ReelCard key={post.id} post={post} containerRef={setReelRef(post.id)} />
          ))
        )}
      </div>
    </div>
  );
}

interface ReelCardProps {
  post: Post;
  containerRef: (el: HTMLDivElement | null) => void;
}

function ReelCard({ post, containerRef }: ReelCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  // Always start muted — browsers block unmuted autoplay
  const [isMuted, setIsMuted] = useState(true);
  const [isLiked, setIsLiked] = useState(post.curtido);
  const [likesCount, setLikesCount] = useState(post.totalCurtidas);
  const videoRef = useRef<HTMLVideoElement>(null);
  const divRef = useRef<HTMLDivElement>(null);

  const videoUrl =
    post.media?.[0]?.tipo === 'video'
      ? post.media[0].url
      : 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';

  // Expose div ref both to parent (for scroll) and local (for IntersectionObserver)
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      (divRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      containerRef(el);
    },
    [containerRef],
  );

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  // Auto-play (muted) when reel scrolls into view, pause when it leaves
  useEffect(() => {
    const container = divRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          videoRef.current?.play().then(() => setIsPlaying(true)).catch(() => {});
        } else {
          videoRef.current?.pause();
          setIsPlaying(false);
        }
      },
      { threshold: 0.6 },
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const handleLike = () => {
    setIsLiked((prev) => !prev);
    setLikesCount((prev) => (isLiked ? prev - 1 : prev + 1));
  };

  return (
    <div
      ref={setRef}
      className="w-full h-[100dvh] snap-start relative bg-black flex flex-col justify-center"
    >
      <video
        ref={videoRef}
        src={videoUrl}
        className="w-full h-full object-cover"
        loop
        playsInline
        muted={isMuted}
        onClick={togglePlay}
      />

      {/* Pause indicator */}
      {!isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 bg-black/50 rounded-full flex items-center justify-center backdrop-blur-sm">
            <Play className="w-8 h-8 text-white fill-white ml-1" />
          </div>
        </div>
      )}

      {/* Mute/unmute — top right */}
      <button
        onClick={() => setIsMuted((m) => !m)}
        className="absolute top-4 right-4 w-10 h-10 bg-black/50 rounded-full flex items-center justify-center backdrop-blur-sm z-10"
        aria-label={isMuted ? 'Ativar som' : 'Silenciar'}
      >
        {isMuted ? (
          <VolumeX className="w-5 h-5 text-white" />
        ) : (
          <Volume2 className="w-5 h-5 text-white" />
        )}
      </button>

      {/* Bottom info overlay */}
      <div className="absolute bottom-0 left-0 right-16 p-4 pb-8 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none">
        <Link
          href={`/perfil/${post.autor.username}`}
          className="flex items-center gap-3 mb-3 pointer-events-auto w-fit"
        >
          <Avatar className="w-10 h-10 border border-white/20">
            <AvatarImage src={post.autor.avatarUrl ?? ''} />
            <AvatarFallback>{post.autor.username[0]}</AvatarFallback>
          </Avatar>
          <span className="font-bold text-white text-sm hover:underline">
            {post.autor.username}
          </span>
          <button className="px-3 py-1 bg-transparent border border-white text-white rounded-full text-xs font-bold hover:bg-white/20 pointer-events-auto">
            Seguir
          </button>
        </Link>

        <p className="text-white text-sm mb-3 max-w-[280px] pointer-events-auto line-clamp-3">
          {post.legenda ?? 'Sem legenda'}
        </p>

        <div className="flex items-center gap-2 text-white/70 text-xs pointer-events-auto">
          <Music className="w-3 h-3 shrink-0" />
          <span className="truncate">Som original — {post.autor.username}</span>
        </div>
      </div>

      {/* Side action buttons */}
      <div className="absolute bottom-8 right-2 flex flex-col items-center gap-6">
        <button className="flex flex-col items-center gap-1 group" onClick={handleLike}>
          <div className="w-11 h-11 bg-black/40 rounded-full flex items-center justify-center backdrop-blur-sm group-hover:bg-black/60 transition-colors">
            <Heart
              className={`w-6 h-6 transition-transform group-active:scale-90 ${
                isLiked ? 'fill-primary text-primary' : 'text-white'
              }`}
            />
          </div>
          <span className="text-white text-xs font-semibold drop-shadow-md">
            {likesCount.toLocaleString()}
          </span>
        </button>

        <button className="flex flex-col items-center gap-1 group">
          <div className="w-11 h-11 bg-black/40 rounded-full flex items-center justify-center backdrop-blur-sm group-hover:bg-black/60 transition-colors">
            <MessageCircle className="w-6 h-6 text-white transition-transform group-active:scale-90" />
          </div>
          <span className="text-white text-xs font-semibold drop-shadow-md">
            {post.totalComentarios}
          </span>
        </button>

        <button className="flex flex-col items-center gap-1 group">
          <div className="w-11 h-11 bg-black/40 rounded-full flex items-center justify-center backdrop-blur-sm group-hover:bg-black/60 transition-colors">
            <Share2 className="w-6 h-6 text-white transition-transform group-active:scale-90" />
          </div>
          <span className="text-white text-xs font-semibold drop-shadow-md">Partilhar</span>
        </button>

        <button className="flex flex-col items-center gap-1 group">
          <div className="w-11 h-11 bg-black/40 rounded-full flex items-center justify-center backdrop-blur-sm group-hover:bg-black/60 transition-colors">
            <MoreHorizontal className="w-6 h-6 text-white" />
          </div>
        </button>

        {/* Spinning record thumbnail */}
        <div className="w-10 h-10 rounded-md border-2 border-white overflow-hidden animate-[spin_4s_linear_infinite]">
          <img
            src={post.autor.avatarUrl ?? 'https://i.pravatar.cc/150'}
            className="w-full h-full object-cover"
            alt=""
          />
        </div>
      </div>
    </div>
  );
}
