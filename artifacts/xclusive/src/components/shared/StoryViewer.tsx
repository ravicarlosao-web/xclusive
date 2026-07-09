import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { StoryGroup } from '@workspace/api-client-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { X, ChevronLeft, ChevronRight, Trash2, Heart, Send, Coins } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { pt } from 'date-fns/locale';
import { TipModal } from '@/components/shared/TipModal';
import { useToast } from '@/hooks/use-toast';

interface StoryViewerProps {
  groups: StoryGroup[];
  /** Index of the group to start on */
  initialGroupIndex: number;
  onClose: () => void;
  /** Called whenever a story finishes viewing, so the caller can mark it as seen */
  onStoryViewed?: (userId: number, storyId: number) => void;
  /** Allows the owner to delete one of their own local stories */
  onDeleteStory?: (userId: number, storyId: number) => void;
  currentUserId?: number;
}

const STORY_DURATION_MS = 5000;

/** Mini preview of an adjacent story group, shown peeking on the side (desktop only) */
function SidePeek({ group, onClick, side }: { group: StoryGroup; onClick: () => void; side: 'left' | 'right' }) {
  const cover = group.stories[0];
  return (
    <button
      onClick={onClick}
      aria-label={side === 'left' ? 'Story anterior' : 'Próximo story'}
      className="hidden lg:flex relative w-[220px] h-[70vh] max-h-[600px] rounded-2xl overflow-hidden shrink-0 opacity-50 hover:opacity-80 transition-opacity"
    >
      {cover && (cover.tipo === 'video' ? (
        <video src={cover.mediaUrl} className="w-full h-full object-cover" muted />
      ) : (
        <img src={cover.mediaUrl} alt="" className="w-full h-full object-cover" />
      ))}
      <div className="absolute inset-0 bg-black/30" />
      <div className="absolute bottom-3 left-3 flex items-center gap-2">
        <Avatar className="w-8 h-8 border border-white/60">
          <AvatarImage src={group.utilizador.avatarUrl || ''} />
          <AvatarFallback>{group.utilizador.nomeExibicao?.[0] || 'U'}</AvatarFallback>
        </Avatar>
        <span className="text-white text-xs font-semibold drop-shadow truncate max-w-[110px]">{group.utilizador.username}</span>
      </div>
    </button>
  );
}

export function StoryViewer({ groups, initialGroupIndex, onClose, onStoryViewed, onDeleteStory, currentUserId }: StoryViewerProps) {
  const [groupIndex, setGroupIndex] = useState(initialGroupIndex);
  const [storyIndex, setStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [liked, setLiked] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  // Snapshot of who/what is being tipped, frozen at the moment the modal opens,
  // so background auto-advance can't change the target mid-flow.
  const [tipTarget, setTipTarget] = useState<{
    username: string;
    nomeExibicao: string | null;
    avatarUrl: string | null;
    verificado: boolean;
    storyId: number;
  } | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const elapsedRef = useRef<number>(0);
  const { toast } = useToast();

  const group = groups[groupIndex];
  const story = group?.stories[storyIndex];

  const goToNextStory = useCallback(() => {
    if (!group) return;
    if (storyIndex < group.stories.length - 1) {
      setStoryIndex(i => i + 1);
    } else if (groupIndex < groups.length - 1) {
      setGroupIndex(g => g + 1);
      setStoryIndex(0);
    } else {
      onClose();
    }
  }, [group, storyIndex, groupIndex, groups.length, onClose]);

  const goToPrevStory = useCallback(() => {
    if (storyIndex > 0) {
      setStoryIndex(i => i - 1);
    } else if (groupIndex > 0) {
      const prevGroup = groups[groupIndex - 1];
      setGroupIndex(g => g - 1);
      setStoryIndex(prevGroup.stories.length - 1);
    }
  }, [storyIndex, groupIndex, groups]);

  // Reset per-story UI state (reply, like) and progress whenever the story changes
  useEffect(() => {
    setProgress(0);
    elapsedRef.current = 0;
    setReplyText('');
    setLiked(false);
  }, [groupIndex, storyIndex]);

  // Progress animation — resumes from elapsedRef instead of restarting on unpause
  useEffect(() => {
    if (paused) return;

    startRef.current = performance.now();
    function tick(now: number) {
      const elapsed = elapsedRef.current + (now - startRef.current);
      const pct = Math.min(100, (elapsed / STORY_DURATION_MS) * 100);
      setProgress(pct);
      if (pct >= 100) {
        if (story) onStoryViewed?.(group.utilizador.id, story.id);
        goToNextStory();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupIndex, storyIndex, paused]);

  function handlePauseStart() {
    if (paused) return; // idempotent: avoid double-accumulating elapsed time
    elapsedRef.current += performance.now() - startRef.current;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setPaused(true);
  }
  function handlePauseEnd() {
    setPaused(false);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goToNextStory();
      if (e.key === 'ArrowLeft') goToPrevStory();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, goToNextStory, goToPrevStory]);

  if (!group || !story) return null;

  const isOwn = currentUserId === group.utilizador.id;
  const prevGroup = groupIndex > 0 ? groups[groupIndex - 1] : null;
  const nextGroup = groupIndex < groups.length - 1 ? groups[groupIndex + 1] : null;

  function handleSendReply() {
    if (!replyText.trim()) return;
    toast({ title: 'Mensagem enviada', description: `A tua resposta a ${group.utilizador.username} foi enviada.` });
    setReplyText('');
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center select-none gap-4 px-4">
      {/* Left side peek */}
      {prevGroup ? (
        <SidePeek group={prevGroup} side="left" onClick={() => { setGroupIndex(i => i - 1); setStoryIndex(0); }} />
      ) : (
        <div className="hidden lg:block w-[220px] shrink-0" />
      )}

      {/* Main story card */}
      <div
        className="relative w-full h-full sm:w-[400px] sm:h-[85vh] sm:max-h-[720px] sm:rounded-2xl overflow-hidden bg-black shrink-0"
        onMouseDown={handlePauseStart}
        onMouseUp={handlePauseEnd}
        onTouchStart={handlePauseStart}
        onTouchEnd={handlePauseEnd}
      >
        {/* Media */}
        {story.tipo === 'video' ? (
          <video src={story.mediaUrl} className="w-full h-full object-cover" autoPlay muted playsInline />
        ) : (
          <img src={story.mediaUrl} alt="" className="w-full h-full object-cover" />
        )}

        {/* Gradient overlays for legibility */}
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/70 to-transparent pointer-events-none" />

        {/* Progress bars */}
        <div className="absolute top-3 left-3 right-3 flex gap-1 z-10">
          {group.stories.map((s, i: number) => (
            <div key={s.id} className="h-[3px] flex-1 rounded-full bg-white/30 overflow-hidden">
              <div
                className="h-full bg-white"
                style={{
                  width: i < storyIndex ? '100%' : i === storyIndex ? `${progress}%` : '0%',
                  transition: i === storyIndex ? 'none' : undefined,
                }}
              />
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="absolute top-7 left-3 right-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <Avatar className="w-8 h-8 border border-white/40">
              <AvatarImage src={group.utilizador.avatarUrl || ''} />
              <AvatarFallback>{group.utilizador.nomeExibicao?.[0] || 'U'}</AvatarFallback>
            </Avatar>
            <span className="text-white text-sm font-semibold drop-shadow">{group.utilizador.username}</span>
            <span className="text-white/70 text-xs drop-shadow">
              {formatDistanceToNowStrict(new Date(story.criadoEm), { locale: pt })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isOwn && onDeleteStory && (
              <button
                onClick={() => onDeleteStory(group.utilizador.id, story.id)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
                aria-label="Eliminar story"
              >
                <Trash2 className="w-4 h-4 text-white" />
              </button>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
              aria-label="Fechar"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        {/* Tap zones for navigation */}
        <button
          className="absolute left-0 top-0 w-1/3 h-[calc(100%-64px)] z-[5]"
          onClick={goToPrevStory}
          aria-label="Story anterior"
        />
        <button
          className="absolute right-0 top-0 w-1/3 h-[calc(100%-64px)] z-[5]"
          onClick={goToNextStory}
          aria-label="Próximo story"
        />

        {/* Reply bar + actions (hidden for own story, since you can't message yourself) */}
        {!isOwn && (
          <div className="absolute bottom-3 left-3 right-3 z-10 flex items-center gap-2">
            <form
              className="flex-1"
              onSubmit={e => { e.preventDefault(); handleSendReply(); }}
            >
              <input
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onFocus={handlePauseStart}
                onBlur={handlePauseEnd}
                placeholder={`Responder a ${group.utilizador.username}...`}
                className="w-full h-10 rounded-full bg-white/10 border border-white/30 text-white placeholder:text-white/60 text-sm px-4 outline-none focus:border-white/60 backdrop-blur-sm"
              />
            </form>
            <button
              onClick={() => setLiked(v => !v)}
              aria-label="Gostar"
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors shrink-0"
            >
              <Heart className={liked ? 'w-6 h-6 fill-primary text-primary' : 'w-6 h-6 text-white'} />
            </button>
            <button
              onClick={() => {
                handlePauseStart();
                setTipTarget({
                  username: group.utilizador.username,
                  nomeExibicao: group.utilizador.nomeExibicao,
                  avatarUrl: group.utilizador.avatarUrl ?? null,
                  verificado: group.utilizador.verificado,
                  storyId: story.id,
                });
                setTipOpen(true);
              }}
              aria-label="Enviar gorjeta"
              className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors shrink-0"
            >
              <Coins className="w-6 h-6 text-white" />
            </button>
            {replyText.trim() && (
              <button
                onClick={handleSendReply}
                aria-label="Enviar mensagem"
                className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors shrink-0"
              >
                <Send className="w-5 h-5 text-white" />
              </button>
            )}
          </div>
        )}

        {/* Desktop arrows */}
        {(groupIndex > 0 || storyIndex > 0) && (
          <button
            onClick={goToPrevStory}
            className="hidden sm:flex absolute -left-4 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 items-center justify-center z-10 lg:hidden"
          >
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
        )}
        {(groupIndex < groups.length - 1 || storyIndex < group.stories.length - 1) && (
          <button
            onClick={goToNextStory}
            className="hidden sm:flex absolute -right-4 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 items-center justify-center z-10 lg:hidden"
          >
            <ChevronRight className="w-5 h-5 text-white" />
          </button>
        )}
      </div>

      {/* Right side peek */}
      {nextGroup ? (
        <SidePeek group={nextGroup} side="right" onClick={() => { setGroupIndex(i => i + 1); setStoryIndex(0); }} />
      ) : (
        <div className="hidden lg:block w-[220px] shrink-0" />
      )}

      {tipTarget && (
        <TipModal
          open={tipOpen}
          onClose={() => {
            setTipOpen(false);
            handlePauseEnd();
          }}
          creator={{
            username: tipTarget.username,
            nomeExibicao: tipTarget.nomeExibicao,
            avatarUrl: tipTarget.avatarUrl,
            verificado: tipTarget.verificado,
          }}
          postId={tipTarget.storyId}
          onTipSent={() => toast({ title: 'Gorjeta enviada!', description: `Enviaste uma gorjeta a ${tipTarget.username}.` })}
        />
      )}
    </div>,
    document.body
  );
}
