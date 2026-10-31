import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ChevronDown, Edit } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useGetConversations } from '@workspace/api-client-react';
import { formatDistanceToNow } from 'date-fns';
import { pt } from 'date-fns/locale';
import { ConversaPainel } from './ConversaPainel';
import { NovaMensagemDialog } from './NovaMensagemDialog';

function formatTime(dateStr: string) {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: false, locale: pt });
  } catch {
    return '';
  }
}

/** Texto da última mensagem na lista (a gorjeta mostra quem enviou e o valor; nunca o texto opcional). */
function previsualizacao(m: { retirada?: boolean; tipo: string; conteudo?: string | null; autorId: number; gorjeta?: { valor: number } }, meuId?: number): string {
  if (m.retirada) return 'Mensagem removida pela moderação';
  if (m.tipo === 'gorjeta') return `${m.autorId === meuId ? 'Enviaste' : 'Recebeste'} uma gorjeta${m.gorjeta ? ` de ${m.gorjeta.valor.toLocaleString('pt-PT')} Kz` : ''}`;
  return m.conteudo ?? (m.tipo === 'imagem' ? 'Imagem' : 'Áudio');
}

// Scroll da lista guardado ao sair de /mensagens para /mensagens/:id (cada rota monta de novo), reposto ao voltar.
let scrollListaGuardado = 0;

/**
 * Mensagens: em md+ vista dividida permanente (lista à esquerda, conversa à direita); em < md o padrão anterior
 * (lista em ecrã inteiro; conversa em ecrã inteiro com botão de voltar). Cada painel tem o seu scroll.
 */
export function MensagensShell({ convId }: { convId: number }) {
  const { user } = useAuth();
  const { data: conversations, isLoading, isError } = useGetConversations();
  const [novaAberta, setNovaAberta] = useState(false);
  const listaRef = useRef<HTMLDivElement>(null);
  const aberta = convId > 0;

  useLayoutEffect(() => {
    const el = listaRef.current;
    if (el) el.scrollTop = scrollListaGuardado;
  }, [isLoading]);
  useEffect(() => {
    const el = listaRef.current;
    return () => { if (el) scrollListaGuardado = el.scrollTop; };
  }, []);

  // Setas ↑/↓ movem o foco entre as conversas
  const aoTeclar = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const itens = Array.from(e.currentTarget.querySelectorAll<HTMLAnchorElement>('a[data-conversa]'));
    const i = itens.indexOf(document.activeElement as HTMLAnchorElement);
    if (i < 0) return;
    const prox = itens[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (prox) { e.preventDefault(); prox.focus(); }
  };

  return (
    <div className="h-screen md:h-[100dvh] flex flex-col md:flex-row bg-background" data-testid="mensagens-shell">
      {/* Lista (em < md some quando há conversa aberta) */}
      <aside aria-label="Conversas" data-testid="mensagens-lista"
        className={`${aberta ? 'hidden md:flex' : 'flex'} w-full md:w-[280px] lg:w-[340px] xl:w-[380px] 2xl:w-[400px] shrink-0 flex-col h-full border-r border-border bg-card`}>
        <div className="flex h-16 shrink-0 items-center justify-between px-4 border-b border-border">
          <h1 className="flex min-w-0 items-center gap-1 text-lg font-bold">
            <span className="truncate">{user?.username}</span>
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
          </h1>
          <button type="button" onClick={() => setNovaAberta(true)} aria-label="Nova mensagem" data-testid="mensagens-nova"
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Edit className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>
        <div className="shrink-0 p-4 border-b border-border">
          <Input placeholder="Pesquisar..." aria-label="Pesquisar conversas" className="min-h-[44px] bg-secondary border-none" />
        </div>
        <div ref={listaRef} onKeyDown={aoTeclar} data-testid="mensagens-lista-scroll" className="flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scrollbar">
          {isLoading && <div className="p-6 text-center text-sm text-muted-foreground">A carregar…</div>}
          {isError && <div role="alert" className="p-6 text-center text-sm text-muted-foreground">Não foi possível carregar as conversas.</div>}
          {!isLoading && !isError && (conversations?.length ?? 0) === 0 && <div className="p-6 text-center text-sm text-muted-foreground">Ainda não tens conversas.</div>}
          {conversations?.map((conv) => {
            const partner = conv.participantes.find((p) => p.username !== user?.username) ?? conv.participantes[0];
            const lastMsg = conv.ultimaMensagem;
            const unread = conv.totalNaoLidas ?? 0;
            const ativa = conv.id === convId;
            const nome = partner?.nomeExibicao ?? partner?.username ?? 'Utilizador';
            return (
              <Link key={conv.id} href={`/mensagens/${conv.id}`} data-conversa="" data-testid="conversa-item" aria-current={ativa ? 'page' : undefined}
                aria-label={unread > 0 ? `${nome}, ${unread} por ler` : nome}
                className={`flex min-h-[72px] items-center gap-3 p-4 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${ativa ? 'bg-secondary' : ''}`}>
                <Avatar className="h-14 w-14 shrink-0 border border-border">
                  <AvatarImage src={partner?.avatarUrl ?? ''} />
                  <AvatarFallback>{nome[0]?.toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`min-w-0 truncate text-sm ${unread > 0 ? 'font-bold' : 'font-semibold'}`}>{nome}</span>
                    {lastMsg && <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline">{formatTime(lastMsg.criadoEm)}</span>}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className={`truncate text-sm ${unread > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                      {lastMsg ? previsualizacao(lastMsg, user?.id) : 'Sem mensagens'}
                    </p>
                    {unread > 0 && <span aria-hidden="true" className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">{unread}</span>}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </aside>

      {/* Painel da direita: conversa, ou o estado vazio (só em md+) */}
      {aberta ? (
        <div className="flex-1 min-w-0 h-[calc(100dvh-60px)] md:h-full" data-testid="mensagens-painel">
          <ConversaPainel key={convId} convId={convId} />
        </div>
      ) : (
        <div className="hidden md:flex flex-1 min-w-0 flex-col items-center justify-center p-8 text-center" data-testid="mensagens-vazio">
          <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-full border-2 border-primary">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-12 w-12 text-primary" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
          </div>
          <h2 className="mb-2 text-xl font-bold">As tuas mensagens</h2>
          <p className="mb-6 text-sm text-muted-foreground">Envia fotos e mensagens privadas para um amigo ou grupo.</p>
          <button type="button" onClick={() => setNovaAberta(true)} data-testid="mensagens-enviar"
            className="min-h-[44px] rounded-full bg-primary px-6 py-2 text-sm font-bold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Enviar Mensagem
          </button>
        </div>
      )}

      <NovaMensagemDialog open={novaAberta} onClose={() => setNovaAberta(false)} conversas={conversations ?? []} />
    </div>
  );
}
