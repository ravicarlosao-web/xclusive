import { useEffect, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import { Heart, MessageCircle, Star, DollarSign, UserPlus, AtSign, Bell, CheckCheck, Coins } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { FeedHeader } from '@/components/feed/FeedHeader';
import { ColunaDescobrir } from '@/components/feed/ColunaDescobrir';
import { Pilulas } from '@/components/shared/Pilulas';
import { useAuth } from '@/contexts/AuthContext';
import { useGetNotifications, useMarkAllNotificationsRead } from '@workspace/api-client-react';
import { formatDistanceToNow } from 'date-fns';
import { pt } from 'date-fns/locale';
import { useQueryClient } from '@tanstack/react-query';
import { getGetNotificationsQueryKey } from '@workspace/api-client-react';

type NotifTipo = 'novo_seguidor' | 'like_post' | 'comentario' | 'nova_subscricao' | 'pagamento_recebido' | 'mencao' | 'sistema' | 'gorjeta_recebida';

type FilterType = 'tudo' | 'mencoes';

const MENCAO_TYPES: NotifTipo[] = ['mencao', 'comentario'];
const FILTROS: { id: FilterType; rotulo: string }[] = [{ id: 'tudo', rotulo: 'Tudo' }, { id: 'mencoes', rotulo: 'Menções' }];

function renderIcon(tipo: NotifTipo) {
  switch (tipo) {
    case 'novo_seguidor':      return <UserPlus className="w-4 h-4 text-blue-500" />;
    case 'like_post':          return <Heart className="w-4 h-4 text-primary fill-primary" />;
    case 'comentario':         return <MessageCircle className="w-4 h-4 text-green-600 dark:text-green-500 fill-green-600 dark:fill-green-500" />;
    case 'mencao':             return <AtSign className="w-4 h-4 text-sky-600 dark:text-sky-400" />;
    case 'nova_subscricao':    return <Star className="w-4 h-4 text-yellow-600 dark:text-yellow-500 fill-yellow-600 dark:fill-yellow-500" />;
    case 'pagamento_recebido': return <DollarSign className="w-4 h-4 text-emerald-600 dark:text-emerald-500" />;
    case 'sistema':            return <Bell className="w-4 h-4 text-purple-500 fill-purple-500" />;
    case 'gorjeta_recebida':   return <Coins className="w-4 h-4 text-yellow-600 dark:text-yellow-500" />;
    default:                   return null;
  }
}

function renderText(tipo: NotifTipo) {
  switch (tipo) {
    case 'novo_seguidor':      return 'começou a seguir-te.';
    case 'like_post':          return 'gostou da tua publicação.';
    case 'comentario':         return 'comentou na tua publicação.';
    case 'mencao':             return 'mencionou-te numa publicação.';
    case 'nova_subscricao':    return 'subscreveu o teu conteúdo exclusivo!';
    case 'pagamento_recebido': return 'pagou por conteúdo PPV.';
    case 'sistema':            return 'Notificação de Sistema';
    case 'gorjeta_recebida':   return 'enviou-te uma gorjeta.';
    // Tipo desconhecido ou removido (p. ex. linhas antigas): texto genérico, nunca parte a página
    default:                   return 'Tens uma nova notificação.';
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
  const { isMockMode } = useAuth();

  const { data, isLoading, isError, refetch } = useGetNotifications({ page: 1 });
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

  // Mesmo desenho de Início e Explorar: centro de 640 px com bordas laterais e a coluna direita de descoberta
  return (
    <div className="flex justify-center w-full max-w-screen-xl mx-auto gap-12 px-0 sm:px-4 md:pr-1.5">
      <div className="w-full min-w-0 max-w-[640px] shrink sm:border-x sm:border-border min-h-[100dvh]">
        <FeedHeader titulo="Notificações" rotuloMenu="Mais opções de Notificações" textoAtualizar="Marcar todas como lidas" Icone={CheckCheck}
          onAtualizar={() => markAllRead()} aAtualizar={isMarking || unreadCount === 0} />

        <Pilulas<FilterType> itens={FILTROS} ativo={filter} onMudar={setFilter} rotulo="Filtrar as notificações" painelId="notif-painel" idPrefixo="notif-tab" testid="notif-filtros" />

        <div id="notif-painel" role="tabpanel" aria-labelledby={`notif-tab-${filter}`} data-testid="notif-painel">
          {/* Loading */}
          {isLoading && (
            <div aria-busy="true" aria-label="A carregar notificações" data-testid="notif-esqueleto">
              {Array(6).fill(0).map((_, i) => (
                <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3">
                  <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/4" /></div>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {isError && (
            <div role="alert" className="px-6 py-14 text-center text-sm text-muted-foreground" data-testid="notif-erro">
              <Bell className="mx-auto mb-3 h-10 w-10 opacity-30" aria-hidden="true" />
              <p className="mb-4">Não foi possível carregar as notificações.</p>
              <Button variant="outline" className="min-h-[44px]" onClick={() => { void refetch(); }}>Tentar novamente</Button>
            </div>
          )}

          {/* Empty */}
          {!isLoading && !isError && filtered.length === 0 && (
            <div className="px-6 py-14 text-center text-sm text-muted-foreground border-b border-border" data-testid="notif-vazio">
              {filter === 'mencoes'
                ? <><AtSign className="mx-auto mb-3 h-10 w-10 opacity-30" aria-hidden="true" /><p>Ainda não tens menções.</p></>
                : <><Bell className="mx-auto mb-3 h-10 w-10 opacity-30" aria-hidden="true" /><p>Ainda não tens notificações.</p></>
              }
            </div>
          )}

          {/* List */}
          {!isLoading && !isError && filtered.length > 0 && (
            <div data-testid="notif-lista">
              {filtered.map((notif) => {
                const tipo = notif.tipo as NotifTipo;
                const username = notif.ator?.username ?? 'utilizador';
                const avatarUrl = notif.ator?.avatarUrl ?? '';
                // Notificações de sistema trazem a mensagem do servidor (ex.: subscrição expirada, levantamento rejeitado).
                const mensagem = (notif as { mensagem?: string | null }).mensagem ?? null;
                const sistema = tipo === 'sistema';
                const temAtor = !!notif.ator;

                return (
                  <div
                    key={notif.id}
                    data-testid="notif-linha"
                    className={`flex items-center gap-3 border-b border-border px-4 py-3 transition-colors
                      ${!notif.lida ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-secondary/60'}
                    `}
                  >
                    {temAtor ? (
                      <Link href={`/perfil/${username}`} className="relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Ver o perfil de ${username}`}>
                        <Avatar className="w-12 h-12 border border-border">
                          <AvatarImage src={avatarUrl} />
                          <AvatarFallback>{username[0]?.toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5 border border-border shadow-sm">
                          {renderIcon(tipo)}
                        </div>
                      </Link>
                    ) : (
                      <div className="relative shrink-0 w-12 h-12 rounded-full bg-secondary border border-border flex items-center justify-center">
                        {renderIcon(tipo) ?? <Bell className="w-4 h-4" />}
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      {sistema ? (
                        <p className="text-sm" data-testid="notif-mensagem">{mensagem || renderText(tipo)}</p>
                      ) : (
                        <p className="text-sm">
                          <Link href={`/perfil/${username}`} className="font-bold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {username}
                          </Link>{' '}
                          {tipo === 'gorjeta_recebida' ? (
                            // Texto do servidor ("enviou-te uma gorjeta de X Kz") e ligação à conversa (o id vem em postId)
                            notif.postId ? <Link href={`/mensagens/${notif.postId}`} data-testid="notif-gorjeta" className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{mensagem || renderText(tipo)}</Link> : <span data-testid="notif-gorjeta">{mensagem || renderText(tipo)}</span>
                          ) : renderText(tipo)}
                        </p>
                      )}
                      <span className={`text-xs ${!notif.lida ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                        {formatTime(notif.criadoEm)}
                      </span>
                    </div>

                    {sistema && temAtor && (
                      <Link href={`/perfil/${username}`} className="shrink-0">
                        <Button size="sm" className="min-h-[44px] bg-primary text-white" data-testid="notif-renovar">Renovar</Button>
                      </Link>
                    )}

                    {tipo === 'novo_seguidor' && (
                      <Button size="sm" className={`min-h-[44px] shrink-0 ${!notif.lida ? 'bg-primary text-white' : 'bg-secondary text-foreground'}`}>
                        Seguir
                      </Button>
                    )}

                    {notif.postThumbnail && ['like_post', 'comentario', 'mencao'].includes(tipo) && (
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

      {/* Coluna direita: a mesma do Início e de Explorar */}
      <ColunaDescobrir semDados={isMockMode} />
    </div>
  );
}
