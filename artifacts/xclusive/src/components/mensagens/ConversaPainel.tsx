import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { Link, useLocation } from 'wouter';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { ArrowDown, ArrowLeft, Ban, Coins, Info, Image as ImageIcon, Heart, Loader2, MoreVertical, UserRoundCheck, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { BloqueioDialog, textoErroServidor } from './bloqueio';
import { GorjetaCartao } from './GorjetaCartao';
import { GorjetaDialog } from './GorjetaDialog';
import { ACCEPT_IMAGEM, enviarImagemMensagem, textoErro, validarImagem } from './imagemMensagem';
import { ImagemBolha } from './ImagemBolha';
import { MensagemRemovida, OpcoesMensagem } from './OpcoesMensagem';
import { ReportDialog } from '@/components/shared/ReportDialog';
import { VisualizadorImagens, type ImagemVista } from './VisualizadorImagens';
import { useAuth } from '@/contexts/AuthContext';
import {
  useGetMessages,
  useSendMessage,
  useGetConversations,
  useGetUserProfile,
  getGetUserProfileQueryKey,
  useMarkConversationRead,
  getGetMessagesQueryKey,
  getGetConversationsQueryKey,
  getGetUnreadConversationsCountQueryKey,
} from '@workspace/api-client-react';
import { customFetch, type Message } from '@workspace/api-client-react';
import { useNovasMensagens, type RespostaDepois } from '@/hooks/useNovasMensagens';
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

const TEXTO_GENERICO = 'Não é possível enviar mensagens nesta conversa.';

/** Painel da conversa: cabeçalho, mensagens com scroll próprio e composer fixo em baixo. Sem ícones de chamada. */
export function ConversaPainel({ convId }: { convId: number }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const jaAbriu = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Anexo em preparação: miniatura, estado (pronto / a enviar / erro) e URL já enviado (para não repetir o upload ao tentar de novo)
  const [anexo, setAnexo] = useState<{ file: File; preview: string; estado: 'pronto' | 'a_enviar' | 'erro'; erro?: string; url?: string } | null>(null);
  const [erroAnexo, setErroAnexo] = useState<string | null>(null);
  const [vista, setVista] = useState<number | null>(null);
  const gatilho = useRef<HTMLElement | null>(null);
  // true enquanto o painel está colado ao fim (o crescimento de imagens que carregam não o deve descolar)
  const noFim = useRef(true);
  const ultimoAuto = useRef(0); // instante do último scroll programático (os seus eventos de scroll não contam como gesto do utilizador)
  const irParaFim = (el: HTMLElement, comportamento: ScrollBehavior = 'auto') => { ultimoAuto.current = Date.now(); el.scrollTo({ top: el.scrollHeight, behavior: comportamento }); };

  const [, setLocation] = useLocation();
  const [dialogoBloqueio, setDialogoBloqueio] = useState<'bloquear' | 'desbloquear' | null>(null);
  // Menu → diálogo: o menu não pode devolver o foco ao seu botão depois de o diálogo abrir (senão o foco escapa do diálogo)
  const abriuDialogoDoMenu = useRef(false);
  const [avisoEnvio, setAvisoEnvio] = useState<string | null>(null);
  const [gorjetaAberta, setGorjetaAberta] = useState(false);
  // Denúncia de mensagem: id da mensagem em causa + botão que abriu o menu (recebe o foco ao fechar)
  const [denunciarId, setDenunciarId] = useState<number | null>(null);
  const gatilhoDenuncia = useRef<HTMLElement | null>(null);
  // Texto que não chegou a ser enviado (o composer pode passar a restrito depois do erro: o texto continua visível)
  const [naoEnviado, setNaoEnviado] = useState<string | null>(null);

  // Dados da conversa (para obter o parceiro)
  const { data: conversations } = useGetConversations();
  const conv = conversations?.find(c => c.id === convId);
  const parceiroDaLista = conv?.participantes.find(p => p.username !== user?.username)
    ?? conv?.participantes[0];

  // Mensagens (404/403: conversa indisponível, sem tentar de novo)
  const { data: msgData, isLoading, isError, error: msgErro } = useGetMessages(convId, {
    query: {
      queryKey: getGetMessagesQueryKey(convId), enabled: convId > 0,
      // Além do poll de mensagens novas: janela completa de 60 em 60 s (não corre com o separador escondido) e ao voltar ao separador
      refetchInterval: 60_000, refetchOnWindowFocus: true,
      retry: (n, e) => { const st = (e as { status?: number } | null)?.status; return st === 404 || st === 403 ? false : n < 1; },
    },
  });
  // Mensagens: a janela mais recente (esta query, que se atualiza) + as páginas anteriores (cursor `antes`), unidas por id e em ordem.
  const [messages, setMessages] = useState<Message[]>([]);
  const [temMais, setTemMais] = useState(false);          // há mensagens anteriores ainda por carregar
  const [carregouAnteriores, setCarregouAnteriores] = useState(false);
  const [aCarregarAnteriores, setACarregarAnteriores] = useState(false);
  const [erroAnteriores, setErroAnteriores] = useState(false);
  const emVoo = useRef(false);                             // um só pedido de anteriores de cada vez
  const erroRef = useRef(false);                           // o último pedido falhou: não repete sozinho (só com «Tentar novamente»)
  const mensagensRef = useRef<Message[]>([]);
  mensagensRef.current = messages;
  useEffect(() => {
    if (!msgData) return;
    const prev = mensagensRef.current, nova = msgData.messages;
    // A janela recente deixou de tocar nas já carregadas (chegaram mais de uma página de mensagens de uma vez): recomeça nas mais recentes
    if (prev.length && nova.length && msgData.hasMore && nova[0].id > prev[prev.length - 1].id) { setMessages(nova); setTemMais(true); setCarregouAnteriores(false); return; }
    if (!prev.length) setTemMais(msgData.hasMore);
    const porId = new Map(prev.map((m) => [m.id, m] as const));
    for (const m of nova) porId.set(m.id, m);
    setMessages([...porId.values()].sort((a, b) => a.id - b.id));
  }, [msgData]);

  // Posição: mensagem-âncora (a primeira visível) e a sua distância ao topo do painel. Repõe-se quando se acrescenta no topo
  // e quando algo acima da âncora muda de altura (imagens que carregam depois), para a leitura não saltar.
  const ancora = useRef<{ id: number; topo: number } | null>(null);
  const reporAncora = useRef(false);
  const medirAncora = () => {
    const el = scrollRef.current; if (!el) return;
    const caixa = el.getBoundingClientRect();
    for (const n of Array.from(el.querySelectorAll<HTMLElement>('[data-msg-id]'))) {
      const r = n.getBoundingClientRect();
      if (r.bottom > caixa.top + 1) { ancora.current = { id: Number(n.dataset.msgId), topo: r.top - caixa.top }; return; }
    }
    ancora.current = null;
  };
  const alinharAncora = () => {
    const el = scrollRef.current, a = ancora.current; if (!el || !a) return;
    const n = el.querySelector<HTMLElement>(`[data-msg-id="${a.id}"]`); if (!n) return;
    const dif = (n.getBoundingClientRect().top - el.getBoundingClientRect().top) - a.topo;
    if (Math.abs(dif) >= 1) { ultimoAuto.current = Date.now(); el.scrollTop += dif; }
  };
  const carregarAnteriores = async () => {
    if (emVoo.current || !temMais || !messages.length) return;
    emVoo.current = true; erroRef.current = false; setACarregarAnteriores(true); setErroAnteriores(false);
    try {
      const r = await customFetch<{ messages: Message[]; hasMore: boolean }>(`/api/conversations/${convId}/messages?antes=${messages[0].id}&limite=50`);
      medirAncora(); reporAncora.current = true;
      setMessages((prev) => { const porId = new Map(prev.map((m) => [m.id, m] as const)); for (const m of r.messages) if (!porId.has(m.id)) porId.set(m.id, m); return [...porId.values()].sort((a, b) => a.id - b.id); });
      setTemMais(r.hasMore); setCarregouAnteriores(true);
    } catch {
      erroRef.current = true; setErroAnteriores(true);
    } finally {
      emVoo.current = false; setACarregarAnteriores(false);
    }
  };
  useLayoutEffect(() => { if (reporAncora.current) { reporAncora.current = false; alinharAncora(); } }, [messages]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Carrega sozinho ao chegar perto do topo, mas só depois de a pessoa ter rolado (ao abrir, o topo ainda está visível antes do salto para o fim)
  const jaRolou = useRef(false);
  const topoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const topo = topoRef.current, raiz = scrollRef.current;
    if (!topo || !raiz || !temMais || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && jaRolou.current && !erroRef.current) void carregarAnteriores(); }, { root: raiz, rootMargin: '200px 0px 0px 0px' });
    io.observe(topo);
    return () => io.disconnect();
  });   // sem dependências: recria o observador a cada render para ver o estado atual (barato)
  const statusErro = (msgErro as { status?: number } | null)?.status;
  const erroIndisponivel = isError && (statusErro === 404 || statusErro === 403);

  // Parceiro: da lista de conversas; se a conversa não está lá (p. ex. bloqueaste-a ou abriste o URL direto), pelo autor das mensagens
  // que não és tu (sem endpoint novo). Se nem assim, o cabeçalho mostra só "Conversa".
  const parceiroDasMensagens = messages.find((m) => m.autorId !== (user as any)?.id)?.autor;
  const partner = parceiroDaLista ?? parceiroDasMensagens;
  // Sem acesso, ou sem forma de saber com quem é a conversa (fora da lista e sem mensagens do outro): estado "indisponível"
  const indisponivel = erroIndisponivel || (!!msgData && conversations !== undefined && !partner);

  // Composer conforme podeEnviar/restricao (o bloqueio nunca é revelado a quem foi bloqueado: restricao null)
  const carregado = !!msgData;
  const podeEnviar = msgData?.podeEnviar ?? true;
  const restricao = msgData?.restricao ?? null;
  const restrito = carregado && !podeEnviar;
  // Gorjeta: só a criadores e com a conversa a permitir envio (nunca com bloqueio nem regra restritiva)
  const mostraGorjeta = carregado && podeEnviar && partner?.tipoConta === 'criador';
  // Se já segues o criador, só a subscrição desbloqueia (regra "só assinantes"): o texto acompanha
  const { data: perfilParceiro } = useGetUserProfile(partner?.username ?? '', {
    query: { queryKey: getGetUserProfileQueryKey(partner?.username ?? ''), enabled: restricao === 'regra' && !!partner },
  });

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
  const { mutate: sendMsg, mutateAsync: sendMsgAsync, isPending: isSendingTexto } = useSendMessage({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMessagesQueryKey(convId) });
        queryClient.invalidateQueries({ queryKey: getGetConversationsQueryKey() });
        reiniciarPollRef.current();   // depois de enviar, o ritmo do poll volta ao base
      },
    },
  });

  // ── Mensagens novas na conversa aberta (poll inteligente) ──────────────────────────────────────────────────────────────────────────
  const reiniciarPollRef = useRef<() => void>(() => {});
  const [naoVistas, setNaoVistas] = useState(0);            // mensagens do outro que chegaram enquanto se lê mais acima
  const pendenteLida = useRef(false);                       // há mensagens do outro por marcar como lidas
  const ultimaLida = useRef(0);
  const timerLida = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Marca a conversa como lida: só com o separador visível e a pessoa no fundo, e no máximo uma vez de 5 em 5 segundos. */
  const marcarLida = () => {
    if (timerLida.current) return;
    const executar = () => {
      timerLida.current = null;
      if (document.visibilityState === 'hidden' || !noFim.current || !pendenteLida.current) return;
      pendenteLida.current = false;
      ultimaLida.current = Date.now();
      markConversationRead({ id: convId });
    };
    const espera = Math.max(0, ultimaLida.current + 5000 - Date.now());
    if (espera === 0) executar(); else timerLida.current = setTimeout(executar, espera);
  };
  useEffect(() => () => { if (timerLida.current) clearTimeout(timerLida.current); }, []);

  const { semLigacao, tentarAgora, reiniciar: reiniciarPoll } = useNovasMensagens({
    convId,
    ativo: convId > 0 && !!msgData && !erroIndisponivel,
    ultimoId: () => (mensagensRef.current.length ? mensagensRef.current[mensagensRef.current.length - 1].id : null),
    aoReceber: (r: RespostaDepois) => {
      setMessages((prev) => { const porId = new Map(prev.map((m) => [m.id, m] as const)); for (const m of r.messages) porId.set(m.id, m); return [...porId.values()].sort((a, b) => a.id - b.id); });
      // O compositor reflete já o estado (bloqueios, regra de quem pode escrever) sem esperar pela janela completa
      queryClient.setQueryData(getGetMessagesQueryKey(convId), (antigo: unknown) => {
        const a = antigo as { podeEnviar?: boolean; restricao?: string | null } | undefined;
        return a ? { ...a, podeEnviar: r.podeEnviar ?? a.podeEnviar, restricao: r.restricao !== undefined ? r.restricao : a.restricao } : antigo;
      });
      const dosOutros = r.messages.filter((m) => m.autorId !== (user as any)?.id).length;
      if (dosOutros > 0) {
        pendenteLida.current = true;
        if (noFim.current && document.visibilityState !== 'hidden') marcarLida();
        else setNaoVistas((n) => n + dosOutros);
      }
    },
    aoIndisponivel: () => { void queryClient.invalidateQueries({ queryKey: getGetMessagesQueryKey(convId) }); },
  });
  reiniciarPollRef.current = reiniciarPoll;
  // Voltar ao separador com a conversa no fundo e mensagens por marcar: marca-as
  useEffect(() => {
    const aoVoltar = () => { if (document.visibilityState !== 'hidden' && noFim.current && pendenteLida.current) marcarLida(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  });   // sem dependências: vê sempre o estado atual

  // Auto-scroll para o fundo sempre que chegam mensagens novas
  // Scroll só dentro do painel (nunca da página): ao abrir salta para o fim; depois, suave.
  // Depende do id da ÚLTIMA mensagem (não do total): acrescentar mensagens antigas no topo não faz saltar para o fim.
  // Se a pessoa está a ler mais acima, uma mensagem nova DO OUTRO não a puxa para baixo; as suas desce sempre.
  const ultimaMsg = messages.length ? messages[messages.length - 1] : null;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!jaAbriu.current && messages.length === 0) return;
    if (jaAbriu.current && !noFim.current && ultimaMsg && ultimaMsg.autorId !== (user as any)?.id) return;
    noFim.current = true;
    irParaFim(el, jaAbriu.current ? 'smooth' : 'auto');
    jaAbriu.current = true;
  }, [ultimaMsg?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const isSending = isSendingTexto || anexo?.estado === 'a_enviar';

  // Miniatura: URL local libertado ao remover/trocar/sair
  useEffect(() => () => { if (anexo) URL.revokeObjectURL(anexo.preview); }, [anexo?.preview]); // eslint-disable-line react-hooks/exhaustive-deps

  const escolherImagem = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const problema = validarImagem(file);
    if (problema) { setErroAnexo(problema); return; }
    setErroAnexo(null);
    setAnexo({ file, preview: URL.createObjectURL(file), estado: 'pronto' });
  };
  const removerAnexo = () => { setAnexo(null); setErroAnexo(null); };

  const enviarAnexo = async () => {
    if (!anexo || anexo.estado === 'a_enviar') return;
    const legenda = inputText.trim();
    setAnexo({ ...anexo, estado: 'a_enviar', erro: undefined });
    try {
      const url = anexo.url ?? await enviarImagemMensagem(anexo.file);
      try {
        await sendMsgAsync({ id: convId, data: { tipo: 'imagem', mediaUrl: url, ...(legenda ? { conteudo: legenda } : {}) } });
      } catch (e) {
        setAnexo((a) => (a ? { ...a, estado: 'erro', erro: textoErro(e), url } : a));
        return;
      }
      setAnexo(null); setInputText('');
    } catch (e) {
      setAnexo((a) => (a ? { ...a, estado: 'erro', erro: textoErro(e) } : a));
    }
  };

  const imagens: ImagemVista[] = useMemo(() => messages.filter((m) => m.tipo === 'imagem' && m.mediaUrl).map((m) => ({
    id: m.id, url: m.mediaUrl as string, legenda: m.conteudo, autor: m.autorId === (user as any)?.id ? 'ti' : (m.autor?.nomeExibicao ?? m.autor?.username ?? 'utilizador'),
  })), [messages, user]);
  const abrirImagem = (id: number, el: HTMLElement) => { gatilho.current = el; const i = imagens.findIndex((x) => x.id === id); if (i >= 0) setVista(i); };
  const fecharVista = useCallback(() => { setVista(null); const g = gatilho.current; if (g && g.isConnected) setTimeout(() => g.focus(), 0); }, []);

  // Qualquer crescimento do conteúdo (imagens que carregam) mantém o painel no fim, se lá estava
  const conteudoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = conteudoRef.current;
    if (!c || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { const el = scrollRef.current; if (!el) return; if (noFim.current) irParaFim(el); else alinharAncora(); });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // Uma imagem que acaba de carregar aumenta a altura: se estávamos no fim, continua no fim
  const aoCarregarImagem = useCallback(() => {
    const el = scrollRef.current;
    if (el && noFim.current) irParaFim(el);
  }, []);

  const handleSend = () => {
    if (anexo) { void enviarAnexo(); return; }
    if (!inputText.trim() || isSending) return;
    const text = inputText.trim();
    setInputText('');
    setAvisoEnvio(null);
    setNaoEnviado(null);
    sendMsg({ id: convId, data: { tipo: 'texto', conteudo: text } }, {
      // O texto NÃO se perde: volta à caixa e o aviso mostra a causa; a conversa recarrega para o composer refletir o estado
      onError: (e) => {
        setInputText((atual) => (atual.trim() ? `${text} ${atual}` : text));
        setNaoEnviado(text);
        const st = (e as { status?: number } | null)?.status;
        setAvisoEnvio(st === 404 ? TEXTO_GENERICO : textoErroServidor(e, 'Não foi possível enviar a mensagem. Tenta novamente.'));
        void queryClient.invalidateQueries({ queryKey: getGetMessagesQueryKey(convId) });
      },
    });
  };

  return (
    <section aria-label="Conversa" data-testid="conversa-painel" className="h-[calc(100dvh-60px)] md:h-full min-w-0 flex flex-col bg-background relative">
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
          ) : isLoading || conversations === undefined ? (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-secondary animate-pulse" />
              <div className="h-4 w-28 bg-secondary rounded animate-pulse" />
            </div>
          ) : (
            <span className="font-bold text-sm" data-testid="conversa-titulo-generico">Conversa</span>
          )}
        </div>
        <div className="flex items-center">
          {partner && !indisponivel && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Mais opções da conversa" data-testid="conversa-menu"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <MoreVertical className="w-6 h-6" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60" onCloseAutoFocus={(e) => { if (abriuDialogoDoMenu.current) { e.preventDefault(); abriuDialogoDoMenu.current = false; } }}>
                {restricao === 'bloqueaste' ? (
                  <DropdownMenuItem data-testid="conversa-desbloquear" onSelect={() => { abriuDialogoDoMenu.current = true; setDialogoBloqueio('desbloquear'); }} className="min-h-[44px] gap-2"><UserRoundCheck className="h-4 w-4" aria-hidden="true" /> Desbloquear @{partner.username}</DropdownMenuItem>
                ) : (
                  <DropdownMenuItem data-testid="conversa-bloquear" onSelect={() => { abriuDialogoDoMenu.current = true; setDialogoBloqueio('bloquear'); }} className="min-h-[44px] gap-2"><Ban className="h-4 w-4 text-destructive" aria-hidden="true" /> Bloquear @{partner.username}</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {partner && (
            <Link href={`/perfil/${partner.username}`} aria-label={`Informações de ${partner.nomeExibicao ?? partner.username}`} data-testid="conversa-info"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Info className="w-6 h-6" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>

      {indisponivel ? (
        <div data-testid="conversa-indisponivel" className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-lg font-bold">Conversa indisponível.</p>
          <p className="text-sm text-muted-foreground">Esta conversa já não está acessível.</p>
          <p className="text-xs text-muted-foreground">Se bloqueaste esta conta, podes desbloqueá-la em <Link href="/definicoes" className="font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Definições &gt; Privacidade</Link>.</p>
          <Link href="/mensagens" data-testid="conversa-indisponivel-voltar"
            className="inline-flex min-h-[44px] items-center rounded-full bg-primary px-6 text-sm font-bold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Voltar às conversas
          </Link>
        </div>
      ) : (<>

      <div role="status" aria-live="polite" className="sr-only" data-testid="conversa-novas-aviso">{naoVistas > 0 ? (naoVistas === 1 ? 'Nova mensagem' : `${naoVistas} novas mensagens`) : ''}</div>
      {semLigacao && (
        <div role="status" data-testid="conversa-sem-ligacao" className="flex items-center justify-center gap-3 border-b border-border bg-secondary px-4 py-1.5 text-xs text-muted-foreground">
          <span>Sem ligação. A tentar de novo…</span>
          <button type="button" data-testid="conversa-tentar-agora" onClick={tentarAgora} className="inline-flex min-h-[44px] items-center font-semibold text-foreground underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Tentar agora</button>
        </div>
      )}
      {/* Messages Area */}
      <div ref={scrollRef} onScroll={(e) => { if (Date.now() - ultimoAuto.current < 800) return; jaRolou.current = true; const el = e.currentTarget; noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; medirAncora(); if (noFim.current) { setNaoVistas(0); if (pendenteLida.current) marcarLida(); } }} data-testid="conversa-scroll" className="flex-1 min-h-0 overflow-y-auto overscroll-contain [overflow-anchor:none] p-4 custom-scrollbar flex flex-col">

        <div ref={conteudoRef} className="flex flex-col">
        {/* Mensagens anteriores: botão (e carregamento automático ao chegar perto do topo), erro e fim */}
        <div ref={topoRef} className="flex flex-col items-center gap-2 pt-1" data-testid="conversa-topo">
          {temMais && !erroAnteriores && (
            <button type="button" onClick={() => { jaRolou.current = true; void carregarAnteriores(); }} disabled={aCarregarAnteriores} data-testid="conversa-carregar-anteriores"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border bg-secondary px-4 text-sm font-semibold text-foreground transition-colors hover:bg-secondary/80 disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {aCarregarAnteriores ? (<><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> A carregar…</>) : 'Carregar mensagens anteriores'}
            </button>
          )}
          {erroAnteriores && (
            <div role="alert" data-testid="conversa-anteriores-erro" className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <p>Não foi possível carregar as mensagens anteriores.</p>
              <button type="button" onClick={() => { void carregarAnteriores(); }} data-testid="conversa-anteriores-tentar"
                className="inline-flex min-h-[44px] items-center rounded-full border border-border bg-secondary px-4 font-semibold text-foreground hover:bg-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Tentar novamente</button>
            </div>
          )}
          {!temMais && carregouAnteriores && <p className="text-xs text-muted-foreground" data-testid="conversa-inicio">Início da conversa</p>}
        </div>
        {/* Enquanto há mensagens anteriores por carregar o cartão não se mostra, mas a página mantém o seu título */}
        {partner && temMais && <h1 className="sr-only">Conversa com {partner.nomeExibicao ?? partner.username}</h1>}
        {/* Perfil do parceiro no topo (só quando já não há mensagens anteriores por carregar) */}
        {partner && !temMais && (
          <div className="flex flex-col items-center justify-center py-10">
            <Avatar className="w-24 h-24 mb-4">
              <AvatarImage src={partner.avatarUrl ?? ''} />
              <AvatarFallback>{(partner.nomeExibicao ?? partner.username ?? '?')[0].toUpperCase()}</AvatarFallback>
            </Avatar>
            <h1 className="text-xl font-bold">{partner.nomeExibicao ?? partner.username}</h1>
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

            const comOpcoes = !isMe && !msg.retirada;
            const bolha = (
                <div className={`group relative flex min-w-0 flex-col ${comOpcoes ? 'max-w-full' : 'max-w-[75%]'} ${isMe ? 'items-end' : 'items-start'}`}>
                  {msg.retirada ? (
                    <MensagemRemovida />
                  ) : msg.tipo === 'gorjeta' && msg.gorjeta ? (
                    <GorjetaCartao valor={msg.gorjeta.valor} mensagem={msg.conteudo} enviada={isMe} />
                  ) : msg.tipo === 'imagem' && msg.mediaUrl ? (
                    <div className={`flex min-w-0 max-w-full flex-col gap-1 ${isMe ? 'items-end' : 'items-start'}`}>
                      <ImagemBolha src={msg.mediaUrl} legenda={msg.conteudo} autor={isMe ? 'ti' : (msg.autor?.nomeExibicao ?? msg.autor?.username ?? 'utilizador')} onAbrir={(el) => abrirImagem(msg.id, el)} onCarregada={aoCarregarImagem} />
                      {msg.conteudo && (
                        <div className={`px-4 py-2 rounded-2xl text-[15px] break-words ${isMe ? 'bg-primary text-white' : 'bg-secondary text-foreground border border-border'}`}>{msg.conteudo}</div>
                      )}
                    </div>
                  ) : (
                    <div className={`px-4 py-2.5 rounded-2xl text-[15px] break-words ${
                      isMe
                        ? 'bg-primary text-white rounded-br-sm shadow-none dark:shadow-[0_4px_10px_rgba(255,62,114,0.15)]'
                        : 'bg-secondary text-foreground rounded-bl-sm border border-border'
                    }`}>
                      {msg.conteudo}
                    </div>
                  )}
                  <span className={`text-[10px] text-muted-foreground mt-1 invisible group-hover:visible absolute ${isMe ? 'right-0 -bottom-4' : 'left-0 -bottom-4'}`}>
                    {formatMsgTime(msg.criadoEm)}
                  </span>
                </div>
            );
            return (
              <div key={msg.id} data-msg-id={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                {!isMe && (
                  <Avatar className="w-8 h-8 mr-2 self-end mb-1 shrink-0">
                    <AvatarImage src={avatarUrl} />
                    <AvatarFallback>{fallback}</AvatarFallback>
                  </Avatar>
                )}
                {comOpcoes ? (
                  <OpcoesMensagem onDenunciar={(el) => { gatilhoDenuncia.current = el; setDenunciarId(msg.id); }}>{bolha}</OpcoesMensagem>
                ) : bolha}
              </div>
            );
          })}
          <div className="h-4" />
          {/* Mensagens novas do outro enquanto se lê mais acima: não salta; um botão leva ao fim */}
          {naoVistas > 0 && (
            <div className="sticky bottom-3 z-10 flex justify-center pointer-events-none">
              <button type="button" data-testid="conversa-novas"
                onClick={() => { const el = scrollRef.current; if (el) irParaFim(el, 'smooth'); noFim.current = true; setNaoVistas(0); marcarLida(); }}
                className="pointer-events-auto inline-flex min-h-[44px] items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-white shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <ArrowDown className="h-4 w-4" aria-hidden="true" /> {naoVistas === 1 ? 'Nova mensagem' : `${naoVistas} novas mensagens`}
              </button>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Input Area */}
      <div className="p-4 border-t border-border bg-card shrink-0">
        {erroAnexo && <p role="alert" data-testid="anexo-erro-tipo" className="mb-2 text-sm text-destructive">{erroAnexo}</p>}
        {anexo && (
          <div data-testid="anexo" className="mb-3 flex items-start gap-3">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-border bg-secondary">
              <img src={anexo.preview} alt="Pré-visualização da imagem a enviar" className="h-full w-full object-cover" data-testid="anexo-miniatura" />
              {anexo.estado === 'a_enviar' && <div data-testid="anexo-a-enviar" role="status" aria-label="A enviar a imagem" className="absolute inset-0 flex items-center justify-center bg-background/70"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" /></div>}
            </div>
            <div className="min-w-0 flex-1 pt-1 text-sm">
              <p className="truncate text-muted-foreground">{anexo.file.name}</p>
              {anexo.estado === 'a_enviar' && <p className="text-muted-foreground">A enviar…</p>}
              {anexo.estado === 'erro' && (
                <div role="alert" data-testid="anexo-erro" className="text-destructive">
                  <p>{anexo.erro}</p>
                  <button type="button" data-testid="anexo-tentar" onClick={() => { void enviarAnexo(); }} className="mt-1 min-h-[44px] rounded-md px-2 font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Tentar novamente</button>
                </div>
              )}
            </div>
            <button type="button" data-testid="anexo-remover" aria-label="Remover imagem" onClick={removerAnexo} disabled={anexo.estado === 'a_enviar'}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-5 w-5" aria-hidden="true" /></button>
          </div>
        )}
        {avisoEnvio && <p role="alert" data-testid="envio-aviso" className="mb-2 text-sm text-destructive">{avisoEnvio}</p>}
        {restrito && !anexo ? (
          <div data-testid="composer-restrito" className="flex flex-col gap-3 rounded-2xl bg-secondary p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            {naoEnviado && <p data-testid="texto-nao-enviado" className="w-full break-words rounded-lg border border-border bg-background p-2 text-muted-foreground sm:order-last"><span className="font-semibold text-foreground">Mensagem não enviada: </span>{naoEnviado}</p>}
            <p data-testid="composer-restrito-texto" className="text-foreground">
              {restricao === 'regra'
                ? (perfilParceiro?.estaASeguir
                    ? `Só os assinantes de @${partner?.username ?? ''} podem enviar-lhe mensagens.`
                    : `Só os seguidores e assinantes de @${partner?.username ?? ''} podem enviar-lhe mensagens.`)
                : restricao === 'bloqueaste' ? 'Bloqueaste esta conta.' : TEXTO_GENERICO}
            </p>
            {restricao === 'regra' && partner && (
              <Link href={`/perfil/${partner.username}`} data-testid="composer-restrito-perfil"
                className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-full bg-primary px-5 text-sm font-bold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {perfilParceiro?.estaASeguir ? 'Ver perfil e subscrever' : 'Seguir ou subscrever'}
              </Link>
            )}
            {restricao === 'bloqueaste' && partner && (
              <button type="button" data-testid="composer-restrito-desbloquear" onClick={() => setDialogoBloqueio('desbloquear')}
                className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-full bg-primary px-5 text-sm font-bold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Desbloquear
              </button>
            )}
          </div>
        ) : (
        <div className="flex items-center gap-2 bg-secondary rounded-full px-4 py-1 border border-transparent focus-within:border-border">
          <input ref={imageInputRef} type="file" accept={ACCEPT_IMAGEM} onChange={escolherImagem} data-testid="conversa-ficheiro" className="hidden" tabIndex={-1} aria-hidden="true" />
          {mostraGorjeta && (
            <button type="button" aria-label="Enviar gorjeta" data-testid="conversa-gorjeta" onClick={() => setGorjetaAberta(true)} disabled={isSending}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors hover:bg-primary/20 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Coins className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          <button
            aria-label="Anexar imagem" className="flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-primary transition-colors bg-primary/10 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => imageInputRef.current?.click()} disabled={isSending}
            type="button"
          >
            <ImageIcon className="w-5 h-5 text-primary" />
          </button>
          <Input
            value={inputText}
            onChange={(e) => { setInputText(e.target.value); if (avisoEnvio) setAvisoEnvio(null); }}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={anexo ? 'Adicionar legenda…' : 'Mensagem...'} aria-label={anexo ? 'Legenda da imagem' : 'Escrever mensagem'} data-testid="conversa-input"
            className="flex-1 bg-transparent border-none focus-visible:ring-0 shadow-none h-10"
            disabled={isSending}
          />
          {inputText.trim() || anexo ? (
            <button
              onClick={handleSend}
              disabled={isSending}
              aria-label="Enviar mensagem" data-testid="conversa-enviar" className="min-h-[44px] text-primary hover:text-primary/80 font-bold px-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
            >
              {isSending ? <Loader2 className="w-4 h-4 animate-spin" aria-label="A enviar" /> : 'Enviar'}
            </button>
          ) : (
            <button type="button" aria-label="Gosto" className="flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full">
              <Heart className="w-6 h-6" aria-hidden="true" />
            </button>
          )}
        </div>
        )}
      </div>
      </>)}

      {/* Fica montado enquanto aberto: um erro 403/404 (que recarrega o estado e esconde o botão) continua visível no diálogo */}
      {partner && (mostraGorjeta || gorjetaAberta) && (
        <GorjetaDialog aberto={gorjetaAberta} onFechar={() => setGorjetaAberta(false)} convId={convId} criador={{ username: partner.username, nomeExibicao: partner.nomeExibicao }} />
      )}
      {partner && dialogoBloqueio && (
        <BloqueioDialog aberto modo={dialogoBloqueio} username={partner.username} onFechar={() => setDialogoBloqueio(null)}
          onConcluido={() => { if (dialogoBloqueio === 'bloquear') setLocation('/mensagens'); else void queryClient.invalidateQueries({ queryKey: getGetMessagesQueryKey(convId) }); }} />
      )}
      {denunciarId !== null && (
        <ReportDialog open targetType="mensagem" targetId={denunciarId} conversaId={convId}
          onClose={() => { setDenunciarId(null); const g = gatilhoDenuncia.current; if (g && g.isConnected) setTimeout(() => g.focus(), 0); }}
          onEnviada={() => { void queryClient.invalidateQueries({ queryKey: getGetMessagesQueryKey(convId) }); void queryClient.invalidateQueries({ queryKey: getGetConversationsQueryKey() }); }} />
      )}
      <VisualizadorImagens imagens={imagens} indice={vista} onMudar={setVista} onFechar={fecharVista} />
    </section>
  );
}
