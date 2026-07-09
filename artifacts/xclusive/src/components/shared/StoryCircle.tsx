import { StoryGroup } from '@workspace/api-client-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface StoryCircleProps {
  group: StoryGroup;
  isMe?: boolean;
  /** Opens the story viewer on this group (only called when the group has stories) */
  onView?: () => void;
  /** Opens the file picker to add a new story (only relevant when isMe && no stories yet) */
  onAdd?: () => void;
}

export function StoryCircle({ group, isMe, onView, onAdd }: StoryCircleProps) {
  const hasUnseen = group.hasNaoVisto;
  const hasStories = group.stories.length > 0;

  function handleClick() {
    if (hasStories) onView?.();
    else if (isMe) onAdd?.();
  }

  return (
    <button
      onClick={handleClick}
      className="flex flex-col items-center gap-1 cursor-pointer w-[72px] shrink-0"
    >
      <div className={cn(
        "relative rounded-full p-[2px] transition-transform hover:scale-105",
        hasStories ? (hasUnseen ? "story-ring" : "story-ring-viewed") : "bg-border"
      )}>
        <div className="bg-background rounded-full p-[2px]">
          <Avatar className="w-14 h-14 border border-border">
            <AvatarImage src={group.utilizador.avatarUrl || ''} />
            <AvatarFallback>{group.utilizador.nomeExibicao?.[0] || 'U'}</AvatarFallback>
          </Avatar>
        </div>
        {isMe && !hasStories && (
          <div
            onClick={e => { e.stopPropagation(); onAdd?.(); }}
            className="absolute bottom-0 right-0 bg-primary text-white rounded-full w-5 h-5 flex items-center justify-center border-2 border-background"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </div>
        )}
        {isMe && hasStories && (
          <div
            onClick={e => { e.stopPropagation(); onAdd?.(); }}
            className="absolute bottom-0 right-0 bg-primary text-white rounded-full w-5 h-5 flex items-center justify-center border-2 border-background"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </div>
        )}
      </div>
      <span className="text-xs text-center truncate w-full px-1 font-medium text-muted-foreground">
        {isMe ? 'O teu story' : group.utilizador.username}
      </span>
    </button>
  );
}