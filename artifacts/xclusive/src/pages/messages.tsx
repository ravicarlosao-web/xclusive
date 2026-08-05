import { Link } from 'wouter';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Search, Edit, Loader2, MessageCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useGetConversations } from '@workspace/api-client-react';
import { formatDistanceToNow } from 'date-fns';
import { pt } from 'date-fns/locale';

function formatTime(dateStr?: string) {
  if (!dateStr) return '';
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: false, locale: pt });
  } catch {
    return '';
  }
}

export default function Messages() {
  const { user } = useAuth();
  const { data: conversations, isLoading, isError } = useGetConversations();

  return (
    <div className="h-screen flex flex-col md:flex-row bg-background">
      {/* Sidebar List */}
      <div className="w-full md:w-[350px] lg:w-[400px] flex flex-col h-full border-r border-border bg-card">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h1 className="text-xl font-bold flex items-center gap-2">
            {user?.username}
            <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
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
          {/* Loading */}
          {isLoading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">A carregar…</span>
            </div>
          )}

          {/* Error */}
          {isError && (
            <div className="text-center py-16 text-muted-foreground text-sm px-6">
              <MessageCircle className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p>Não foi possível carregar as conversas.</p>
            </div>
          )}

          {/* Empty */}
          {!isLoading && !isError && (!conversations || conversations.length === 0) && (
            <div className="text-center py-16 text-muted-foreground text-sm px-6">
              <MessageCircle className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p>Ainda não tens conversas.</p>
            </div>
          )}

          {/* List */}
          {!isLoading && !isError && conversations && conversations.map(conv => {
            // O parceiro é o participante que não sou eu
            const partner = conv.participantes.find(p => p.username !== user?.username)
              ?? conv.participantes[0];
            const lastMsg = conv.ultimaMensagem;
            const preview = lastMsg?.conteudo ?? (lastMsg?.tipo === 'imagem' ? '📷 Imagem' : lastMsg?.tipo === 'audio' ? '🎤 Áudio' : '');
            const unread = conv.totalNaoLidas ?? 0;
            const time = formatTime(lastMsg?.criadoEm ?? conv.criadoEm);

            return (
              <Link key={conv.id} href={`/mensagens/${conv.id}`}>
                <div className="flex items-center gap-3 p-4 hover:bg-secondary cursor-pointer transition-colors">
                  <Avatar className="w-14 h-14 border border-border shrink-0">
                    <AvatarImage src={partner?.avatarUrl ?? ''} />
                    <AvatarFallback>{(partner?.nomeExibicao ?? partner?.username ?? '?')[0].toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-0.5">
                      <span className="font-semibold truncate">{partner?.nomeExibicao ?? partner?.username}</span>
                      <span className="text-xs text-muted-foreground ml-2 shrink-0">{time}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className={`text-sm truncate ${unread > 0 ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
                        {preview || 'Sem mensagens'}
                      </span>
                      {unread > 0 && (
                        <span className="bg-primary text-white text-[10px] font-bold px-1.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center shrink-0 ml-2">
                          {unread}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Empty State Desktop */}
      <div className="hidden md:flex flex-1 flex-col items-center justify-center bg-background p-8 text-center">
        <div className="w-24 h-24 border-2 border-primary rounded-full flex items-center justify-center mb-6">
          <svg className="w-12 h-12 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
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
