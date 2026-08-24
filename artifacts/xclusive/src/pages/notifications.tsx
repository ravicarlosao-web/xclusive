import { useEffect, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import { Heart, MessageCircle, Star, DollarSign, UserPlus, AtSign, Loader2, Bell } from 'lucide-react';
import { useGetNotifications, useMarkAllNotificationsRead } from '@workspace/api-client-react';
import { formatDistanceToNow } from 'date-fns';
import { pt } from 'date-fns/locale';
import { useQueryClient } from '@tanstack/react-query';
import { getGetNotificationsQueryKey } from '@workspace/api-client-react';

type NotifTipo = 'novo_seguidor' | 'like_post' | 'like_reel' | 'comentario' | 'nova_subscricao' | 'pagamento_recebido' | 'mencao' | 'sistema';

type FilterType = 'tudo' | 'mencoes';

const MENCAO_TYPES: NotifTipo[] = ['mencao', 'comentario'];

function renderIcon(tipo: NotifTipo) {
  switch (tipo) {
    case 'novo_seguidor':      return <UserPlus className="w-4 h-4 text-blue-500" />;
    case 'like_post':
    case 'like_reel':          return <Heart className="w-4 h-4 text-primary fill-primary" />;
    case 'comentario':         return <MessageCircle className="w-4 h-4 text-green-500 fill-green-500" />;
    case 'mencao':             return <AtSign className="w-4 h-4 text-sky-400" />;
    case 'nova_subscricao':    return <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />;
    case 'pagamento_recebido': return <DollarSign className="w-4 h-4 text-emerald-500" />;
    case 'sistema':            return <Bell className="w-4 h-4 text-purple-500 fill-purple-500" />;
    default:                   return null;
  }
}

function renderText(tipo: NotifTipo) {
  switch (tipo) {
    case 'novo_seguidor':      return 'começou a seguir-te.';
    case 'like_post':          return 'gostou da tua publicação.';
    case 'like_reel':          return 'gostou do teu reel.';
    case 'comentario':         return 'comentou na tua publicação.';
    case 'mencao':             return 'mencionou-te numa publicação.';
    case 'nova_subscricao':    return 'subscreveu o teu conteúdo exclusivo! 🎉';
    case 'pagamento_recebido': return 'pagou por conteúdo PPV.';
    case 'sistema':            return 'Notificação de Sistema';
    default:                   return '';
  }
}

function formatTime(dateStr: string) {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: pt });
  } catch {
    return '';
  }
}

export default function Notifications() {
  const [filter, setFilter] = useState<FilterType>('tudo');
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useGetNotifications({ page: 1 });
  const { mutate: markAllRead, isPending: isMarking } = useMarkAllNotificationsRead({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: ['unreadNotifs'] });
      },
    },
  });

  const notifications = data?.notifications ?? [];

  const unreadCount = notifications.filter(n => !n.lida).length;

  useEffect(() => {
    if (!isLoading && !isError && unreadCount > 0) {
      markAllRead();
    }
  }, [isLoading, isError, unreadCount, markAllRead]);

  const filtered = filter === 'mencoes'
    ? notifications.filter(n => MENCAO_TYPES.includes(n.tipo as NotifTipo))
    : notifications;

  return (
    <div className="w-full max-w-2xl mx-auto h-[calc(100dvh-60px)] md:h-screen overflow-hidden flex flex-col border-x border-border bg-card">
      {/* Header */}
      <div className="p-4 sm:p-6 border-b border-border bg-background/95 backdrop-blur z-10">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Notificações</h1>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              className="text-primary text-sm font-semibold hover:bg-primary/10"
              onClick={() => markAllRead()}
              disabled={isMarking}
            >
              {isMarking ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Marcar todas como lidas
            </Button>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('tudo')}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${filter === 'tudo' ? 'bg-primary text-white shadow-[0_0_15px_rgba(255,62,114,0.4)]' : 'bg-secondary text-foreground hover:bg-secondary/80'}`}
          >
            Tudo
          </button>
          <button
            onClick={() => setFilter('mencoes')}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${filter === 'mencoes' ? 'bg-primary text-white shadow-[0_0_15px_rgba(255,62,114,0.4)]' : 'bg-secondary text-foreground hover:bg-secondary/80'}`}
          >
            Menções
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            <span className="text-sm">A carregar notificações…</span>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="text-center py-16 text-muted-foreground text-sm">
            <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>Não foi possível carregar as notificações.</p>
          </div>
        )}

        {/* Empty */}
        {!isLoading && !isError && filtered.length === 0 && (
          <div className="text-center py-16 text-muted-foreground text-sm">
            {filter === 'mencoes'
              ? <><AtSign className="w-10 h-10 mx-auto mb-3 opacity-30" /><p>Ainda não tens menções.</p></>
              : <><Bell className="w-10 h-10 mx-auto mb-3 opacity-30" /><p>Ainda não tens notificações.</p></>
            }
          </div>
        )}

        {/* List */}
        {!isLoading && !isError && filtered.length > 0 && (
          <div className="p-2 sm:p-4 space-y-1">
            {filtered.map((notif) => {
              const tipo = notif.tipo as NotifTipo;
              const username = notif.ator?.username ?? 'utilizador';
              const avatarUrl = notif.ator?.avatarUrl ?? '';

              return (
                <div
                  key={notif.id}
                  className={`flex items-center gap-4 p-3 sm:p-4 rounded-xl transition-colors cursor-pointer
                    ${!notif.lida ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-secondary'}
                  `}
                >
                  <Link href={`/perfil/${username}`} className="relative shrink-0">
                    <Avatar className="w-12 h-12 border border-border">
                      <AvatarImage src={avatarUrl} />
                      <AvatarFallback>{username[0]?.toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5 border border-border shadow-sm">
                      {renderIcon(tipo)}
                    </div>
                  </Link>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <Link href={`/perfil/${username}`} className="font-bold hover:underline">
                        {username}
                      </Link>{' '}
                      {renderText(tipo)}
                    </p>
                    <span className={`text-xs ${!notif.lida ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                      {formatTime(notif.criadoEm)}
                    </span>
                  </div>

                  {tipo === 'novo_seguidor' && (
                    <Button size="sm" className={!notif.lida ? 'bg-primary text-white' : 'bg-secondary text-foreground'}>
                      Seguir
                    </Button>
                  )}

                  {notif.postThumbnail && ['like_post', 'like_reel', 'comentario', 'mencao'].includes(tipo) && (
                    <div className="shrink-0 w-12 h-12 bg-secondary rounded-md overflow-hidden border border-border">
                      <img src={notif.postThumbnail} className="w-full h-full object-cover" alt="" />
                    </div>
                  )}
                </div>
              );
            })}

            {data?.hasMore && (
              <p className="text-center py-6 text-xs text-muted-foreground">
                A mostrar as últimas 20 notificações.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
