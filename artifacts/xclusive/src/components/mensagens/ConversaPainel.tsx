import { useState, useRef, useEffect } from 'react';
import { Link } from 'wouter';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Info, Image as ImageIcon, Heart, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  useGetMessages,
  useSendMessage,
  useGetConversations,
  useMarkConversationRead,
  getGetMessagesQueryKey,
  getGetConversationsQueryKey,
  getGetUnreadConversationsCountQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { pt } from 'date-fns/locale';

function formatMsgTime(dateStr: string) {
  try {
    return format(new Date(dateStr), 'HH:mm', { locale: pt });
  } catch {
    return '';
  }
}

/** Painel da conversa: cabeçalho, mensagens com scroll próprio e composer fixo em baixo. Sem ícones de chamada. */
export function ConversaPainel({ convId }: { convId: number }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const jaAbriu = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Dados da conversa (para obter o parceiro)
  const { data: conversations } = useGetConversations();
  const conv = conversations?.find(c => c.id === convId);
  const partner = conv?.participantes.find(p => p.username !== user?.username)
    ?? conv?.participantes[0];

  // Mensagens
  const { data: msgData, isLoading, isError } = useGetMessages(convId, {
    query: { queryKey: getGetMessagesQueryKey(convId), enabled: convId > 0 },
  });
  const messages = msgData?.messages ?? [];

  const { mutate: markConversationRead } = useMarkConversationRead({
    mutation: {
      onSuccess: () => {
        // O layout usa esta chave manual para o badge global de mensagens.
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
        queryClient.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetUnreadConversationsCountQueryKey() });
      },
    },
  });

  useEffect(() => {
    if (convId > 0) {
      markConversationRead({ id: convId });
    }
  }, [convId, markConversationRead]);

  // Enviar mensagem
  const { mutate: sendMsg, isPending: isSending } = useSendMessage({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMessagesQueryKey(convId) });
        queryClient.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
      },
    },
  });

  // Auto-scroll para o fundo sempre que chegam mensagens novas
  // Scroll só dentro do painel (nunca da página): ao abrir salta para o fim; depois, suave.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!jaAbriu.current && messages.length === 0) return;
    el.scrollTo({ top: el.scrollHeight, behavior: jaAbriu.current ? 'smooth' : 'auto' });
    jaAbriu.current = true;
  }, [messages.length]);

  const handleSend = () => {
    if (!inputText.trim() || isSending) return;
    const text = inputText.trim();
    setInputText('');
    sendMsg({ id: convId, data: { tipo: 'texto', conteudo: text } });
  };

  return (
    <section aria-label="Conversa" data-testid="conversa-painel" className="h-[100dvh] md:h-full min-w-0 flex flex-col bg-background relative z-50 md:z-auto">
      {/* Header */}
      <div className="h-16 border-b border-border flex items-center justify-between px-4 bg-card/80 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/mensagens" aria-label="Voltar às conversas" data-testid="conversa-voltar" className="md:hidden -ml-2 flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowLeft className="w-6 h-6" aria-hidden="true" />
          </Link>
          {partner ? (
            <Link href={`/perfil/${partner.username}`} className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar className="w-10 h-10 border border-border">
                <AvatarImage src={partner.avatarUrl ?? ''} />
                <AvatarFallback>{(partner.nomeExibicao ?? partner.username ?? '?')[0].toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-bold text-sm leading-tight">{partner.nomeExibicao ?? partner.username}</span>
                <span className="text-xs text-muted-foreground">@{partner.username}</span>
              </div>
            </Link>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-secondary animate-pulse" />
              <div className="h-4 w-28 bg-secondary rounded animate-pulse" />
            </div>
          )}
        </div>
        {partner && (
          <Link href={`/perfil/${partner.username}`} aria-label={`Informações de ${partner.nomeExibicao ?? partner.username}`} data-testid="conversa-info"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Info className="w-6 h-6" aria-hidden="true" />
          </Link>
        )}
      </div>

      {/* Messages Area */}
      <div ref={scrollRef} data-testid="conversa-scroll" className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 custom-scrollbar flex flex-col">

        {/* Perfil do parceiro no topo */}
        {partner && (
          <div className="flex flex-col items-center justify-center py-10">
            <Avatar className="w-24 h-24 mb-4">
              <AvatarImage src={partner.avatarUrl ?? ''} />
              <AvatarFallback>{(partner.nomeExibicao ?? partner.username ?? '?')[0].toUpperCase()}</AvatarFallback>
            </Avatar>
            <h2 className="text-xl font-bold">{partner.nomeExibicao ?? partner.username}</h2>
            <span className="text-muted-foreground text-sm">@{partner.username}</span>
            <Link href={`/perfil/${partner.username}`} className="mt-4 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="inline-flex min-h-[44px] items-center px-4 py-1.5 bg-secondary hover:bg-secondary/80 rounded-lg text-sm font-semibold transition-colors">
                Ver Perfil
              </span>
            </Link>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">A carregar mensagens…</span>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="text-center py-10 text-muted-foreground text-sm">
            <p>Não foi possível carregar as mensagens.</p>
          </div>
        )}

        {/* Empty */}
        {!isLoading && !isError && messages.length === 0 && (
          <div className="text-center py-6 text-muted-foreground text-sm">
            <p>Ainda não há mensagens. Diz olá!</p>
          </div>
        )}

        {/* Lista de mensagens */}
        <div className="flex flex-col gap-4 mt-2">
          {messages.map((msg) => {
            const isMe = msg.autorId === (user as any)?.id;
            const avatarUrl = msg.autor?.avatarUrl ?? '';
            const fallback = (msg.autor?.nomeExibicao ?? msg.autor?.username ?? '?')[0].toUpperCase();

            return (
              <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                {!isMe && (
                  <Avatar className="w-8 h-8 mr-2 self-end mb-1 shrink-0">
                    <AvatarImage src={avatarUrl} />
                    <AvatarFallback>{fallback}</AvatarFallback>
                  </Avatar>
                )}
                <div className={`group relative flex flex-col max-w-[70%] ${isMe ? 'items-end' : 'items-start'}`}>
                  {msg.mediaUrl ? (
                    <div className="rounded-2xl overflow-hidden border border-border shadow-md max-w-[220px]">
                      <img src={msg.mediaUrl} alt="imagem" className="w-full object-cover" />
                    </div>
                  ) : (
                    <div className={`px-4 py-2.5 rounded-2xl text-[15px] ${
                      isMe
                        ? 'bg-primary text-white rounded-br-sm shadow-none dark:shadow-[0_4px_10px_rgba(255,62,114,0.15)]'
                        : 'bg-secondary text-foreground rounded-bl-sm border border-border'
                    }`}>
                      {msg.conteudo}
                    </div>
                  )}
                  <span className={`text-[10px] text-muted-foreground mt-1 opacity-0 group-hover:opacity-100 transition-opacity absolute ${isMe ? 'right-0 -bottom-4' : 'left-0 -bottom-4'}`}>
                    {formatMsgTime(msg.criadoEm)}
                  </span>
                </div>
              </div>
            );
          })}
          <div className="h-4" />
        </div>
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-border bg-card shrink-0">
        <div className="flex items-center gap-2 bg-secondary rounded-full px-4 py-1 border border-transparent focus-within:border-border">
          <input ref={imageInputRef} type="file" accept="image/*,video/*" className="hidden" />
          <button
            aria-label="Anexar imagem" className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-primary transition-colors bg-primary/10 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => imageInputRef.current?.click()}
            type="button"
          >
            <ImageIcon className="w-5 h-5 text-primary" />
          </button>
          <Input
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Mensagem..." aria-label="Escrever mensagem" data-testid="conversa-input"
            className="flex-1 bg-transparent border-none focus-visible:ring-0 shadow-none h-10"
            disabled={isSending}
          />
          {inputText.trim() ? (
            <button
              onClick={handleSend}
              disabled={isSending}
              aria-label="Enviar mensagem" data-testid="conversa-enviar" className="min-h-[44px] text-primary hover:text-primary/80 font-bold px-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
            >
              {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enviar'}
            </button>
          ) : (
            <button type="button" aria-label="Gosto" className="flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full">
              <Heart className="w-6 h-6" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
