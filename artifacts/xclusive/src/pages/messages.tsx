import { Link } from 'wouter';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Search, Edit } from 'lucide-react';
// We'll mock the conversations since the exact hook is likely not fully detailed in the snippet
// but using useGetFeed as a type placeholder if needed.
import { useAuth } from '@/contexts/AuthContext';

const MOCK_CONVERSATIONS = [
  { id: 1, user: { username: 'sofiacosta', avatar: 'https://i.pravatar.cc/150?u=1', name: 'Sofia Costa' }, lastMessage: 'Adorei o último post! 🔥', time: '2m', unread: 2 },
  { id: 2, user: { username: 'pedro_beats', avatar: 'https://i.pravatar.cc/150?u=4', name: 'Pedro Alves' }, lastMessage: 'Vê o novo beat que fiz', time: '1h', unread: 0 },
  { id: 3, user: { username: 'anasantos.art', avatar: 'https://i.pravatar.cc/150?u=3', name: 'Ana Santos' }, lastMessage: 'Obrigada pelo apoio!', time: 'Ontem', unread: 0 },
];

export default function Messages() {
  const { user } = useAuth();

  return (
    <div className="h-screen flex flex-col md:flex-row bg-background">
      {/* Sidebar List */}
      <div className="w-full md:w-[350px] lg:w-[400px] flex flex-col h-full border-r border-border bg-card">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h1 className="text-xl font-bold flex items-center gap-2">
            {user?.username}
            <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
          </h1>
          <button className="p-2 hover:bg-secondary rounded-full transition-colors">
            <Edit className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-4">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-muted-foreground" />
            </div>
            <Input 
              placeholder="Pesquisar..." 
              className="pl-9 bg-secondary/50 border-none h-10"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {MOCK_CONVERSATIONS.map(conv => (
            <Link key={conv.id} href={`/mensagens/${conv.id}`}>
              <div className="flex items-center gap-3 p-4 hover:bg-secondary cursor-pointer transition-colors">
                <Avatar className="w-14 h-14 border border-border">
                  <AvatarImage src={conv.user.avatar} />
                  <AvatarFallback>{conv.user.name[0]}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline mb-0.5">
                    <span className="font-semibold truncate">{conv.user.name}</span>
                    <span className="text-xs text-muted-foreground ml-2 shrink-0">{conv.time}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className={`text-sm truncate ${conv.unread > 0 ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
                      {conv.lastMessage}
                    </span>
                    {conv.unread > 0 && (
                      <span className="bg-primary text-white text-[10px] font-bold px-1.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 ml-2">
                        {conv.unread}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Empty State Desktop */}
      <div className="hidden md:flex flex-1 flex-col items-center justify-center bg-background p-8 text-center">
        <div className="w-24 h-24 border-2 border-primary rounded-full flex items-center justify-center mb-6">
          <svg className="w-12 h-12 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
        </div>
        <h2 className="text-2xl font-bold mb-2">As tuas mensagens</h2>
        <p className="text-muted-foreground mb-6">Envia fotos e mensagens privadas para um amigo ou grupo.</p>
        <button className="bg-primary hover:bg-primary/90 text-white font-bold px-6 py-2.5 rounded-full transition-colors shadow-[0_0_20px_rgba(255,62,114,0.3)]">
          Enviar Mensagem
        </button>
      </div>
    </div>
  );
}