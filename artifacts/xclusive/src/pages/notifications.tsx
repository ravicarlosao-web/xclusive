import { useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import { Heart, MessageCircle, Star, DollarSign, UserPlus, AtSign } from 'lucide-react';

type NotifType = 'novo_seguidor' | 'like_post' | 'comentario' | 'nova_subscricao' | 'pagamento_recebido' | 'mencao';
type FilterType = 'tudo' | 'mencoes';

const MOCK_NOTIFICATIONS: Array<{
  id: number;
  type: NotifType;
  user: { username: string; avatar: string };
  time: string;
  read: boolean;
  postImage?: string;
  text?: string;
  amount?: string;
}> = [
  { id: 1, type: 'novo_seguidor', user: { username: 'joaocarlos', avatar: 'https://i.pravatar.cc/150?u=5' }, time: '2m', read: false },
  { id: 2, type: 'like_post', user: { username: 'maria_silva', avatar: 'https://i.pravatar.cc/150?u=6' }, time: '1h', read: false, postImage: 'https://images.unsplash.com/photo-1515347619253-122cb2c9cb5b?w=100&q=80' },
  { id: 3, type: 'mencao', user: { username: 'pedro_beats', avatar: 'https://i.pravatar.cc/150?u=4' }, time: '2h', text: 'Já viram o trabalho incrível da @demo? 🔥', read: false, postImage: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=100&q=80' },
  { id: 4, type: 'comentario', user: { username: 'pedro_beats', avatar: 'https://i.pravatar.cc/150?u=4' }, time: '3h', text: 'Incrível! 🔥', read: true, postImage: 'https://images.unsplash.com/photo-1515347619253-122cb2c9cb5b?w=100&q=80' },
  { id: 5, type: 'nova_subscricao', user: { username: 'anasantos.art', avatar: 'https://i.pravatar.cc/150?u=3' }, time: 'Ontem', read: true },
  { id: 6, type: 'pagamento_recebido', amount: '4.99€', user: { username: 'joaocarlos', avatar: 'https://i.pravatar.cc/150?u=5' }, time: 'Ontem', read: true },
  { id: 7, type: 'mencao', user: { username: 'anasantos.art', avatar: 'https://i.pravatar.cc/150?u=3' }, time: 'Ontem', text: 'Obrigada à @demo por todo o apoio 💜', read: true },
];

const MENCAO_TYPES: NotifType[] = ['mencao', 'comentario'];

export default function Notifications() {
  const [notifications, setNotifications] = useState(MOCK_NOTIFICATIONS);
  const [filter, setFilter] = useState<FilterType>('tudo');

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = () => {
    setNotifications(notifications.map(n => ({ ...n, read: true })));
  };

  const filtered = filter === 'mencoes'
    ? notifications.filter(n => MENCAO_TYPES.includes(n.type))
    : notifications;

  const renderIcon = (type: NotifType) => {
    switch (type) {
      case 'novo_seguidor': return <UserPlus className="w-4 h-4 text-blue-500" />;
      case 'like_post': return <Heart className="w-4 h-4 text-primary fill-primary" />;
      case 'comentario': return <MessageCircle className="w-4 h-4 text-green-500 fill-green-500" />;
      case 'mencao': return <AtSign className="w-4 h-4 text-sky-400" />;
      case 'nova_subscricao': return <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />;
      case 'pagamento_recebido': return <DollarSign className="w-4 h-4 text-emerald-500 bg-emerald-500/20 rounded-full" />;
      default: return null;
    }
  };

  const renderText = (notif: typeof MOCK_NOTIFICATIONS[0]) => {
    switch (notif.type) {
      case 'novo_seguidor': return 'começou a seguir-te.';
      case 'like_post': return 'gostou da tua publicação.';
      case 'comentario': return `comentou: "${notif.text}"`;
      case 'mencao': return `mencionou-te: "${notif.text}"`;
      case 'nova_subscricao': return 'subscreveu o teu conteúdo exclusivo! 🎉';
      case 'pagamento_recebido': return `pagou ${notif.amount} por conteúdo PPV.`;
      default: return '';
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto pb-20 md:pb-0 h-screen overflow-hidden flex flex-col border-x border-border bg-card">
      <div className="p-4 sm:p-6 border-b border-border bg-background/95 backdrop-blur z-10">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Notificações</h1>
          {unreadCount > 0 && (
            <Button variant="ghost" className="text-primary text-sm font-semibold hover:bg-primary/10" onClick={markAllRead}>
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
        <div className="p-2 sm:p-4 space-y-1">
          {filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              <AtSign className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Ainda não tens menções.</p>
            </div>
          ) : (
            <>
              <div className="px-4 py-2 text-sm font-bold text-muted-foreground uppercase tracking-wider">Esta Semana</div>

              {filtered.map((notif) => (
                <div
                  key={notif.id}
                  className={`flex items-center gap-4 p-3 sm:p-4 rounded-xl transition-colors cursor-pointer
                    ${!notif.read ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-secondary'}
                  `}
                >
                  <Link href={`/perfil/${notif.user.username}`} className="relative shrink-0">
                    <Avatar className="w-12 h-12 border border-border">
                      <AvatarImage src={notif.user.avatar} />
                      <AvatarFallback>{notif.user.username[0]}</AvatarFallback>
                    </Avatar>
                    <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5 border border-border shadow-sm">
                      {renderIcon(notif.type)}
                    </div>
                  </Link>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <Link href={`/perfil/${notif.user.username}`} className="font-bold hover:underline">
                        {notif.user.username}
                      </Link>{' '}
                      {renderText(notif)}
                    </p>
                    <span className={`text-xs ${!notif.read ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                      {notif.time}
                    </span>
                  </div>

                  {notif.type === 'novo_seguidor' && (
                    <Button size="sm" className={!notif.read ? 'bg-primary text-white' : 'bg-secondary text-foreground'}>
                      Seguir
                    </Button>
                  )}

                  {(notif.type === 'like_post' || notif.type === 'comentario' || notif.type === 'mencao') && notif.postImage && (
                    <div className="shrink-0 w-12 h-12 bg-secondary rounded-md overflow-hidden border border-border">
                      <img src={notif.postImage} className="w-full h-full object-cover" alt="" />
                    </div>
                  )}
                </div>
              ))}

              <div className="px-4 py-2 mt-4 text-sm font-bold text-muted-foreground uppercase tracking-wider">Anteriormente</div>
              <div className="text-center py-8 text-muted-foreground text-sm">
                Não tens mais notificações.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
