import { useState, useRef, useEffect } from 'react';
import { Heart, MessageCircle, Share2, MoreHorizontal, Music } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useGetFeed } from '@workspace/api-client-react'; // Fallback hook
import { Link } from 'wouter';

export default function Reels() {
  // Using useGetFeed as a fallback if useGetReels is not perfectly mapped.
  // Actually, let's just use feed and treat them as videos.
  const { data, isLoading } = useGetFeed({ page: 1, limit: 10 });
  const posts = data?.posts || [];

  return (
    <div className="h-[100dvh] w-full bg-black flex items-center justify-center relative overflow-hidden">
      <div className="w-full h-full max-w-[500px] overflow-y-scroll snap-y snap-mandatory no-scrollbar relative">
        {isLoading ? (
          <div className="w-full h-full flex items-center justify-center text-white">A carregar Reels...</div>
        ) : (
          posts.map(post => (
            <ReelCard key={post.id} post={post} />
          ))
        )}
      </div>
    </div>
  );
}

function ReelCard({ post }: { post: any }) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [isLiked, setIsLiked] = useState(post.curtido);
  const [likesCount, setLikesCount] = useState(post.totalCurtidas);
  const videoRef = useRef<HTMLVideoElement>(null);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          videoRef.current?.play().catch(() => {});
          setIsPlaying(true);
        } else {
          videoRef.current?.pause();
          setIsPlaying(false);
        }
      },
      { threshold: 0.6 }
    );

    if (videoRef.current) {
      observer.observe(videoRef.current);
    }

    return () => observer.disconnect();
  }, []);

  const handleLike = () => {
    setIsLiked(!isLiked);
    setLikesCount((prev: number) => isLiked ? prev - 1 : prev + 1);
  };

  // Mock video URL if post media is missing or is image
  const videoUrl = "https://www.w3schools.com/html/mov_bbb.mp4"; // generic placeholder

  return (
    <div className="w-full h-[100dvh] snap-start relative bg-black flex flex-col justify-center">
      <video
        ref={videoRef}
        src={videoUrl}
        className="w-full h-full object-cover"
        loop
        playsInline
        onClick={togglePlay}
      />

      {!isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 bg-black/50 rounded-full flex items-center justify-center backdrop-blur-sm">
            <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </div>
        </div>
      )}

      {/* Info Overlay */}
      <div className="absolute bottom-0 left-0 right-16 p-4 pb-6 bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none">
        <Link href={`/perfil/${post.autor.username}`} className="flex items-center gap-3 mb-3 pointer-events-auto w-fit">
          <Avatar className="w-10 h-10 border border-white/20">
            <AvatarImage src={post.autor.avatarUrl || ''} />
            <AvatarFallback>{post.autor.username[0]}</AvatarFallback>
          </Avatar>
          <span className="font-bold text-white text-sm hover:underline">{post.autor.username}</span>
          <button className="px-3 py-1 bg-transparent border border-white text-white rounded-full text-xs font-bold hover:bg-white/20">
            Seguir
          </button>
        </Link>
        <p className="text-white text-sm mb-3 max-w-[280px] pointer-events-auto">{post.legenda || 'Sem legenda'}</p>
        <div className="flex items-center gap-2 text-white/80 text-xs pointer-events-auto">
          <Music className="w-3 h-3" />
          <span className="truncate">Som original - {post.autor.username}</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="absolute bottom-6 right-2 flex flex-col items-center gap-6">
        <button className="flex flex-col items-center gap-1 group" onClick={handleLike}>
          <div className="w-10 h-10 bg-black/40 rounded-full flex items-center justify-center backdrop-blur-sm group-hover:bg-black/60 transition-colors">
            <Heart className={`w-6 h-6 transition-transform group-active:scale-90 ${isLiked ? 'fill-primary text-primary' : 'text-white'}`} />
          </div>
          <span className="text-white text-xs font-semibold drop-shadow-md">{likesCount}</span>
        </button>

        <button className="flex flex-col items-center gap-1 group">
          <div className="w-10 h-10 bg-black/40 rounded-full flex items-center justify-center backdrop-blur-sm group-hover:bg-black/60 transition-colors">
            <MessageCircle className="w-6 h-6 text-white transition-transform group-active:scale-90" />
          </div>
          <span className="text-white text-xs font-semibold drop-shadow-md">{post.totalComentarios}</span>
        </button>

        <button className="flex flex-col items-center gap-1 group">
          <div className="w-10 h-10 bg-black/40 rounded-full flex items-center justify-center backdrop-blur-sm group-hover:bg-black/60 transition-colors">
            <Share2 className="w-6 h-6 text-white transition-transform group-active:scale-90" />
          </div>
          <span className="text-white text-xs font-semibold drop-shadow-md">Partilhar</span>
        </button>

        <button className="flex flex-col items-center gap-1 group">
          <div className="w-10 h-10 bg-black/40 rounded-full flex items-center justify-center backdrop-blur-sm group-hover:bg-black/60 transition-colors">
            <MoreHorizontal className="w-6 h-6 text-white" />
          </div>
        </button>

        <div className="w-10 h-10 rounded-md border-2 border-white overflow-hidden animate-[spin_4s_linear_infinite]">
          <img src={post.autor.avatarUrl || 'https://i.pravatar.cc/150'} className="w-full h-full object-cover" alt="" />
        </div>
      </div>
    </div>
  );
}