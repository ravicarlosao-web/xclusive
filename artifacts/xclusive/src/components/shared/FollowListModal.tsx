import { useGetUserFollowers, useGetUserFollowing } from '@workspace/api-client-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { Link } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { Skeleton } from '@/components/ui/skeleton';

/** Lista estática usada em mock mode (sem DB real). */
const MOCK_FOLLOW_USERS = [
  { id: 2, username: 'ana_kriativa', nomeExibicao: 'Ana Kriativa', avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=ana&backgroundColor=1a1a2e&radius=50', verificado: true },
  { id: 3, username: 'marcos_beats', nomeExibicao: 'Marcos Beats', avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=marcos&backgroundColor=0d0d1a&radius=50', verificado: true },
  { id: 4, username: 'sofia_fitness', nomeExibicao: 'Sofia Fitness', avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=sofia&backgroundColor=1a0a0a&radius=50', verificado: true },
  { id: 5, username: 'pedro_viagens', nomeExibicao: 'Pedro Viagens', avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=pedro&backgroundColor=0a1a0a&radius=50', verificado: true },
  { id: 6, username: 'luna_fashion', nomeExibicao: 'Luna Fashion', avatarUrl: 'https://api.dicebear.com/9.x/notionists/svg?seed=luna&backgroundColor=1a001a&radius=50', verificado: false },
];

interface FollowListModalProps {
  open: boolean;
  onClose: () => void;
  username: string;
  type: 'followers' | 'following';
  total: number;
}

export function FollowListModal({ open, onClose, username, type, total }: FollowListModalProps) {
  const { isMockMode } = useAuth();

  const { data: followersData, isLoading: loadingFollowers } = useGetUserFollowers(username, {
    query: { queryKey: ['/api/users', username, 'followers'], enabled: open && !isMockMode && type === 'followers' },
  });
  const { data: followingData, isLoading: loadingFollowing } = useGetUserFollowing(username, {
    query: { queryKey: ['/api/users', username, 'following'], enabled: open && !isMockMode && type === 'following' },
  });

  if (!open) return null;

  const title = type === 'followers' ? 'Fãs' : 'A seguir';
  const isLoading = type === 'followers' ? loadingFollowers : loadingFollowing;
  const users = isMockMode
    ? MOCK_FOLLOW_USERS.slice(0, Math.min(total, MOCK_FOLLOW_USERS.length))
    : (type === 'followers' ? followersData?.users : followingData?.users) ?? [];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
        onClick={onClose}
      />

      {/* Sheet deslizante de baixo */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg bg-card border border-border rounded-t-2xl z-50 flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="font-bold text-lg">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-secondary transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {isLoading && !isMockMode ? (
            <div className="flex flex-col gap-1 p-3">
              {Array(5).fill(0).map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-3">
                  <Skeleton className="w-12 h-12 rounded-full shrink-0" />
                  <div className="flex flex-col gap-2 flex-1">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              ))}
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              {type === 'followers' ? 'Ainda não há fãs.' : 'Ainda não segue ninguém.'}
            </div>
          ) : (
            <div className="flex flex-col gap-1 p-3">
              {users.map(u => (
                <Link key={u.id} href={`/perfil/${u.username}`} onClick={onClose}>
                  <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary transition-colors cursor-pointer">
                    <Avatar className="w-12 h-12 shrink-0">
                      <AvatarImage src={u.avatarUrl || ''} />
                      <AvatarFallback>{(u.nomeExibicao || u.username)[0]}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className="font-bold text-sm flex items-center gap-1 truncate">
                        {u.nomeExibicao || u.username}
                        {u.verificado && (
                          <svg className="w-3.5 h-3.5 text-primary fill-current shrink-0" viewBox="0 0 24 24">
                            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1.9 14.7L6 12.6l1.5-1.5 2.6 2.6 6.4-6.4 1.5 1.5-7.9 7.9z"/>
                          </svg>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground truncate">@{u.username}</span>
                    </div>
                    <Button size="sm" variant="outline" className="shrink-0 text-xs font-semibold">
                      Perfil
                    </Button>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
