import { useMemo, useState } from 'react';
import { Comment, UserSummary } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Heart, Send } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getLocalCommentsForPost, addLocalComment } from '@/lib/localComments';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface CommentsModalProps {
  open: boolean;
  onClose: () => void;
  postId: number;
  postAuthorUsername: string;
  seedComments: Comment[];
  /** Chamado sempre que um comentário é adicionado, para atualizar a contagem no PostCard. */
  onCommentAdded?: (comment: Comment) => void;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} d`;
}

export function CommentsModal({ open, onClose, postId, postAuthorUsername, seedComments, onCommentAdded }: CommentsModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [texto, setTexto] = useState('');
  const [localComments, setLocalComments] = useState<Comment[]>(() => getLocalCommentsForPost(postId));
  // Tracks likes toggled *away from* their initial `curtido` state (seed data doesn't
  // persist likes back, so we only need to know what the user flipped this session).
  const [toggledIds, setToggledIds] = useState<Set<number>>(new Set());

  const allComments = useMemo(
    () => [...seedComments, ...localComments].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm)),
    [seedComments, localComments],
  );

  const isLiked = (comment: Comment) => toggledIds.has(comment.id) ? !comment.curtido : comment.curtido;

  const handleToggleLike = (commentId: number) => {
    setToggledIds(prev => {
      const next = new Set(prev);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
  };

  const handleSend = () => {
    const trimmed = texto.trim();
    if (!trimmed) return;
    if (!user) {
      toast({ variant: 'destructive', title: 'Inicia sessão para comentar', description: 'Precisas de estar autenticado para adicionar um comentário.' });
      return;
    }
    const autor: UserSummary = {
      id: user.id,
      username: user.username,
      nomeExibicao: user.nomeExibicao,
      avatarUrl: user.avatarUrl,
      verificado: user.verificado,
    };
    const comment = addLocalComment(postId, trimmed, autor);
    setLocalComments(prev => [...prev, comment]);
    setTexto('');
    onCommentAdded?.(comment);
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden rounded-3xl border-border bg-card gap-0 flex flex-col max-h-[85vh]">
        <DialogTitle className="text-center text-sm font-semibold py-4 border-b border-border shrink-0">
          Comentários
        </DialogTitle>

        <ScrollArea className="flex-1 min-h-[280px] max-h-[50vh]">
          <div className="flex flex-col gap-4 p-4">
            {allComments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                <p className="text-sm font-semibold">Ainda não há comentários</p>
                <p className="text-xs text-muted-foreground">Sê o primeiro a comentar.</p>
              </div>
            ) : (
              allComments.map(comment => (
                <div key={comment.id} className="flex items-start gap-3">
                  <Avatar className="w-8 h-8 shrink-0">
                    <AvatarImage src={comment.autor.avatarUrl || ''} />
                    <AvatarFallback>{(comment.autor.nomeExibicao || comment.autor.username)[0].toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-snug">
                      <span className="font-semibold mr-1.5">
                        {comment.autor.username}
                        {comment.autor.verificado && (
                          <svg className="inline w-3 h-3 text-primary fill-current ml-0.5 -mt-0.5" viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z"/></svg>
                        )}
                      </span>
                      <span className="whitespace-pre-wrap break-words">{comment.texto}</span>
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[11px] text-muted-foreground">{timeAgo(comment.criadoEm)}</span>
                      {(() => {
                        const liked = isLiked(comment);
                        const delta = liked === comment.curtido ? 0 : (liked ? 1 : -1);
                        const displayCount = comment.totalCurtidas + delta;
                        return displayCount > 0 ? (
                          <span className="text-[11px] text-muted-foreground font-medium">{displayCount} gostos</span>
                        ) : null;
                      })()}
                    </div>
                  </div>
                  <button onClick={() => handleToggleLike(comment.id)} className="shrink-0 mt-0.5" aria-label="Gostar do comentário">
                    <Heart className={cn('w-3.5 h-3.5 transition-colors', isLiked(comment) ? 'fill-primary text-primary' : 'text-muted-foreground')} />
                  </button>
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        {/* Compose */}
        <div className="flex items-center gap-3 p-3 border-t border-border shrink-0">
          <Avatar className="w-8 h-8 shrink-0">
            <AvatarImage src={user?.avatarUrl || ''} />
            <AvatarFallback>{(user?.nomeExibicao || user?.username || 'U')[0].toUpperCase()}</AvatarFallback>
          </Avatar>
          <input
            value={texto}
            onChange={e => setTexto(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={`Adiciona um comentário para ${postAuthorUsername}...`}
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={!texto.trim() || !user}
            onClick={handleSend}
            className={cn('font-semibold text-primary px-2 disabled:opacity-40', texto.trim() && 'hover:text-primary')}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
