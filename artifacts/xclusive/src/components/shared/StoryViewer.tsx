import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { StoryGroup } from '@workspace/api-client-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { X, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { pt } from 'date-fns/locale';

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

export function StoryViewer({ groups, initialGroupIndex, onClose, onStoryViewed, onDeleteStory, currentUserId }: StoryViewerProps) {
  const [groupIndex, setGroupIndex] = useState(initialGroupIndex);
  const [storyIndex, setStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const elapsedRef = useRef<number>(0);

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

  // Reset progress only when moving to a different story (not on pause toggle)
  useEffect(() => {
    setProgress(0);
    elapsedRef.current = 0;
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

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center select-none">
      <div
        className="relative w-full h-full sm:w-[420px] sm:h-[90vh] sm:rounded-2xl overflow-hidden bg-black"
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
          className="absolute left-0 top-0 w-1/3 h-full z-[5]"
          onClick={goToPrevStory}
          aria-label="Story anterior"
        />
        <button
          className="absolute right-0 top-0 w-1/3 h-full z-[5]"
          onClick={goToNextStory}
          aria-label="Próximo story"
        />

        {/* Desktop arrows */}
        {(groupIndex > 0 || storyIndex > 0) && (
          <button
            onClick={goToPrevStory}
            className="hidden sm:flex absolute -left-12 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 items-center justify-center z-10"
          >
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
        )}
        {(groupIndex < groups.length - 1 || storyIndex < group.stories.length - 1) && (
          <button
            onClick={goToNextStory}
            className="hidden sm:flex absolute -right-12 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 items-center justify-center z-10"
          >
            <ChevronRight className="w-5 h-5 text-white" />
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
