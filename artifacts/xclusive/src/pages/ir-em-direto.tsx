import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { useLivePublisher, sanitizeStreamKey } from '@/hooks/useLivePublisher';
import { useSocket, type LiveFeedItem, type TipEvent } from '@/hooks/useSocket';
import { getFreshAuthToken } from '@workspace/api-client-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import {
  Radio,
  Video,
  VideoOff,
  Mic,
  MicOff,
  SwitchCamera,
  Share2,
  Copy,
  Check,
  Users,
  Gift,
  Clock,
  AlertTriangle,
  Loader2,
  Square,
  ExternalLink,
  ShieldAlert,
  ArrowLeft,
  Sparkles,
  RefreshCw,
  Eye,
  MessageSquare,
  Send,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

function formatKz(valor: number): string {
  return `${valor.toLocaleString('pt-PT')} Kz`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function timeAgo(iso: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 10) return 'agora';
    if (diff < 60) return `há ${diff}s`;
    if (diff < 3600) return `há ${Math.floor(diff / 60)}m`;
    return `há ${Math.floor(diff / 3600)}h`;
  } catch {
    return '';
  }
}

function getHumanFriendlyError(rawError: string | null): string {
  if (!rawError) return '';
  const lower = rawError.toLowerCase();
  if (
    lower.includes('notreadableerror') ||
    lower.includes('could not start video source') ||
    lower.includes('in use') ||
    lower.includes('device is already in use')
  ) {
    return 'A câmara ou microfone já estão a ser usados por outra aplicação ou separador do navegador. Fecha outras aplicações e tenta novamente.';
  }
  if (lower.includes('notallowederror') || lower.includes('permission denied')) {
    return 'O acesso à câmara ou microfone foi recusado. Por favor, autoriza as permissões no teu navegador para continuar.';
  }
  if (lower.includes('notfounderror') || lower.includes('device not found')) {
    return 'Nenhuma câmara ou microfone detetado no teu dispositivo.';
  }
  if (
    lower.includes('cannot create offer') ||
    lower.includes('denied') ||
    lower.includes('failed to fetch') ||
    lower.includes('connection error')
  ) {
    return 'Não foi possível ligar ao servidor de transmissão WebRTC. Verifica a tua ligação à internet e tenta novamente.';
  }
  return rawError;
}

// ─── Componente de Item do Feed para o Criador (Overlay / Painel) ──────────────

function CreatorFeedRow({ item, isPanel = false }: { item: LiveFeedItem; isPanel?: boolean }) {
  if (item.type === 'joined') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18 }}
        className={cn(
          'flex items-center gap-1.5 py-0.5 px-2 rounded-full text-[10px] sm:text-[11px] w-fit',
          isPanel
            ? 'bg-muted/40 border border-border/30 text-muted-foreground'
            : 'bg-black/50 backdrop-blur-md border border-white/10 text-white/70 shadow-sm'
        )}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
        <span className={cn('font-semibold', isPanel ? 'text-foreground' : 'text-white/90')}>
          @{item.username}
        </span>
        <span>entrou</span>
      </motion.div>
    );
  }

  if (item.type === 'tip') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.92 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22 }}
        className={cn(
          'flex items-start gap-2 p-2 rounded-xl text-xs shadow-md border',
          isPanel
            ? 'bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/5 border-amber-500/30'
            : 'bg-gradient-to-r from-amber-500/35 via-orange-500/25 to-amber-600/20 backdrop-blur-md border-amber-400/40 text-white max-w-[94%] sm:max-w-xs'
        )}
      >
        <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-amber-400 to-orange-500 flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
          <Gift className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap leading-tight">
            <span className={cn('font-bold', isPanel ? 'text-amber-400' : 'text-amber-300')}>
              @{item.username}
            </span>
            <span className={cn('text-[10px]', isPanel ? 'text-muted-foreground' : 'text-white/70')}>
              enviou
            </span>
            <Badge className="bg-gradient-to-r from-amber-500 to-orange-500 text-white font-extrabold text-[10px] px-1.5 py-0 border-0 shadow-sm">
              +{formatKz(item.valor)}
            </Badge>
          </div>
          {item.mensagem && (
            <p className={cn('text-[11px] font-medium mt-0.5 break-words', isPanel ? 'text-foreground/90' : 'text-amber-100')}>
              {item.mensagem}
            </p>
          )}
        </div>
      </motion.div>
    );
  }

  // item.type === 'chat'
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16 }}
      className={cn(
        'flex items-start gap-1.5 py-1 px-2.5 rounded-xl text-xs leading-snug',
        isPanel
          ? 'bg-muted/30 hover:bg-muted/50 border border-transparent hover:border-border/30 transition-colors text-foreground'
          : 'bg-black/60 backdrop-blur-md border border-white/10 text-white max-w-[94%] sm:max-w-xs shadow-md'
      )}
    >
      <Avatar className="w-4 h-4 shrink-0 mt-0.5 border border-white/15">
        <AvatarImage src={item.avatarUrl ?? undefined} />
        <AvatarFallback className="text-[8px] bg-primary/30 text-white font-bold">
          {item.username.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <span className={cn('font-semibold mr-1', isPanel ? 'text-primary' : 'text-amber-200')}>
          @{item.username}:
        </span>
        <span className={cn('break-words', isPanel ? 'text-foreground/90' : 'text-white/95')}>
          {item.mensagem}
        </span>
      </div>
    </motion.div>
  );
}

export default function IrEmDireto() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  const [streamId, setStreamId] = useState<number | null>(null);
  const [streamKey, setStreamKey] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [isEnding, setIsEnding] = useState<boolean>(false);
  const [hasEnded, setHasEnded] = useState<boolean>(false);
  const [finalDuration, setFinalDuration] = useState<number>(0);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [showEndDialog, setShowEndDialog] = useState<boolean>(false);
  const [duration, setDuration] = useState<number>(0);

  // Totais persistidos para o ecrã final de conclusão
  const [sessionTipsCount, setSessionTipsCount] = useState<number>(0);
  const [sessionTipsTotalKz, setSessionTipsTotalKz] = useState<number>(0);

  // Controlo de resposta rápida do criador
  const [creatorReplyText, setCreatorReplyText] = useState<string>('');
  const [showQuickReply, setShowQuickReply] = useState<boolean>(false);



  // Configuração de sinalização: WSS na porta 443 em produção para evitar Mixed Content,
  // ou ws://live.xclusive.ao:3333/live em desenvolvimento local
  const defaultSignallingBaseUrl =
    import.meta.env.VITE_OME_WEBRTC_URL ||
    (typeof window !== 'undefined' && window.location.protocol === 'https:'
      ? 'wss://live.xclusive.ao/live'
      : 'ws://live.xclusive.ao:3333/live');

  const publisher = useLivePublisher({
    defaultSignallingBaseUrl,
  });

  // Callback ref: chama publisher.attachVideoElement sempre que um <video> monta/desmonta.
  // Resolve o problema de ter dois <video> (mobile + desktop) partilhando o mesmo ref —
  // apenas o visível estará montado no DOM e este callback garante que o publisher
  // recebe sempre o elemento correto.
  const videoCallbackRef = useCallback(
    (el: HTMLVideoElement | null) => {
      publisher.attachVideoElement(el);
    },
    [publisher.attachVideoElement]
  );

  const isLive = publisher.connectionState === 'live';
  const isConnecting = publisher.connectionState === 'connecting' || isStarting;
  const isReconnecting = publisher.connectionState === 'reconnecting';
  const isError = publisher.connectionState === 'error';

  // Liga ao Socket.IO apenas quando a live transita para "live"
  const activeStreamId = isLive ? streamId : null;
  const { viewers, feed, sendMessage, isConnected } = useSocket(activeStreamId);

  // Calcula o total acumulado de gorjetas em Kz da sessão
  const totalTipsKz = useMemo(() => {
    return feed.reduce((acc, item) => {
      if (item.type === 'tip') {
        return acc + (item.valor || 0);
      }
      return acc;
    }, 0);
  }, [feed]);

  // Atualiza totais para a tela de encerramento
  useEffect(() => {
    if (isLive) {
      const tipCount = feed.filter((i) => i.type === 'tip').length;
      setSessionTipsCount(tipCount);
      setSessionTipsTotalKz(totalTipsKz);
    }
  }, [feed, isLive, totalTipsKz]);

  // Auto-scroll do chat tanto no overlay da câmara como no painel lateral
  const chatScrollOverlayRef = useRef<HTMLDivElement | null>(null);
  const chatScrollSidePanelRef = useRef<HTMLDivElement | null>(null);

  const scrollChatToBottom = useCallback(() => {
    if (chatScrollOverlayRef.current) {
      chatScrollOverlayRef.current.scrollTo({
        top: chatScrollOverlayRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
    if (chatScrollSidePanelRef.current) {
      chatScrollSidePanelRef.current.scrollTo({
        top: chatScrollSidePanelRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, []);

  useEffect(() => {
    if (feed.length > 0) {
      scrollChatToBottom();
    }
  }, [feed.length, scrollChatToBottom]);

  // Envio de mensagem pelo próprio criador
  const handleSendCreatorMessage = () => {
    const text = creatorReplyText.trim();
    if (!text || !streamId) return;

    if (text.length > 300) {
      toast.error('A mensagem não pode exceder 300 caracteres.');
      return;
    }

    const sent = sendMessage(streamId, text);
    if (sent) {
      setCreatorReplyText('');
      setShowQuickReply(false);
      scrollChatToBottom();
    }
  };

  // (Attach do elemento de vídeo gerido via videoCallbackRef — ver definição acima)

  // Inicializa a câmara para preview assim que carrega
  useEffect(() => {
    if (!isAuthenticated || user?.tipoConta !== 'criador' || !user?.verificado) {
      return;
    }

    let isMounted = true;
    (async () => {
      try {
        if (publisher.connectionState === 'idle') {
          await publisher.requestMedia();
        }
      } catch (err) {
        if (isMounted) {
          console.warn('[ir-em-direto] Inicialização de câmara requer ação do utilizador:', err);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.tipoConta, user?.verificado]);

  // Cronómetro de duração da live
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (publisher.connectionState === 'live') {
      timer = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } else if (publisher.connectionState === 'ended' || hasEnded) {
      if (timer) clearInterval(timer);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [publisher.connectionState, hasEnded]);

  // Se o hook transitar para erro, emitir alerta
  useEffect(() => {
    if (publisher.error) {
      toast.error(getHumanFriendlyError(publisher.error));
    }
  }, [publisher.error]);

  /**
   * Iniciar transmissão nativa
   */
  const handleStartBroadcast = async () => {
    setIsStarting(true);
    try {
      // 1. Garantir que a câmara e áudio estão prontos
      if (!publisher.mediaStream) {
        await publisher.requestMedia();
      }

      // 2. Chamar POST /api/live/start para reservar/obter a live no backend
      const token = await getFreshAuthToken();
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

      const res = await fetch(`${base}/api/live/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}: Erro ao iniciar live no servidor.`);
      }

      const streamData = await res.json();
      const pureKey = sanitizeStreamKey(streamData.streamKey);

      setStreamId(streamData.id);
      setStreamKey(pureKey);

      // 3. Iniciar a publicação WebRTC via OvenLiveKit
      await publisher.startPublishing(pureKey);

      toast.success('Transmissão iniciada com sucesso!');
    } catch (err: any) {
      console.error('[ir-em-direto] Erro ao iniciar transmissão:', err);
      const friendly = getHumanFriendlyError(err.message || 'Erro ao iniciar transmissão.');
      toast.error(friendly);
    } finally {
      setIsStarting(false);
    }
  };

  /**
   * Terminar transmissão nativa
   */
  const handleEndBroadcast = async () => {
    setIsEnding(true);
    setFinalDuration(duration);

    try {
      // 1. Parar o publisher WebRTC local
      await publisher.stopPublishing();

      // 2. Notificar o backend explicitamente
      if (streamId) {
        const token = await getFreshAuthToken();
        const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
        await fetch(`${base}/api/live/${streamId}/end`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }).catch((e) => console.warn('[ir-em-direto] Erro ao chamar endpoint end:', e));
      }

      setShowEndDialog(false);
      setHasEnded(true);
      toast.success('Transmissão terminada com sucesso.');
    } catch (err: any) {
      console.error('[ir-em-direto] Erro ao terminar transmissão:', err);
      toast.error('Erro ao terminar transmissão.');
    } finally {
      setIsEnding(false);
    }
  };

  /**
   * Reiniciar para uma nova transmissão
   */
  const handleResetForNewLive = async () => {
    setStreamId(null);
    setStreamKey(null);
    setHasEnded(false);
    setDuration(0);
    setFinalDuration(0);
    setSessionTipsCount(0);
    setSessionTipsTotalKz(0);
    try {
      await publisher.requestMedia();
    } catch (err) {
      console.warn('[ir-em-direto] Erro ao reativar preview:', err);
    }
  };

  /**
   * Copiar link para partilha
   */
  const handleCopyShareLink = () => {
    if (!streamId) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://xclusive.ao';
    const liveUrl = `${origin}/live/${streamId}`;
    navigator.clipboard.writeText(liveUrl);
    setCopiedLink(true);
    toast.success('Link da live copiado para a área de transferência!');
    setTimeout(() => setCopiedLink(false), 2500);
  };

  // Se estiver a carregar autenticação
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[70vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Validação de tipo de conta
  if (!user || user.tipoConta !== 'criador') {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold">Acesso Exclusivo para Criadores</h1>
        <p className="text-muted-foreground">
          Apenas criadores registados e aprovados têm acesso ao estúdio de transmissões ao vivo.
        </p>
        <div className="pt-2 flex justify-center gap-3">
          <Button onClick={() => setLocation('/tornar-criador')} className="gap-2">
            <Sparkles className="w-4 h-4" />
            Tornar-se Criador
          </Button>
          <Button onClick={() => setLocation('/home')} variant="outline">
            Voltar ao Início
          </Button>
        </div>
      </div>
    );
  }

  // Validação de verificação da conta de criador
  if (!user.verificado) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold">Conta Pendente de Aprovação</h1>
        <p className="text-muted-foreground">
          A tua candidatura a criador está a ser analisada pela nossa equipa de moderação.
          Assim que for aprovada, terás acesso imediato às transmissões ao vivo.
        </p>
        <div className="pt-2 flex justify-center gap-3">
          <Button onClick={() => setLocation('/definicoes/monetizacao')} variant="outline">
            Ver Estado no Painel
          </Button>
        </div>
      </div>
    );
  }

  // ─── ECRÃ DE CONCLUSÃO DA TRANSMISSÃO ─────────────────────────────────────
  if (hasEnded) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 space-y-8">
        <Card className="border-border/60 bg-card/60 backdrop-blur-md shadow-2xl text-center overflow-hidden">
          <div className="h-2 bg-gradient-to-r from-red-600 via-pink-600 to-amber-500" />
          <CardHeader className="pt-8 pb-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto mb-3">
              <Radio className="w-8 h-8" />
            </div>
            <CardTitle className="text-2xl font-bold">Transmissão Terminada</CardTitle>
            <CardDescription className="text-muted-foreground">
              Obrigado por transmitires na Xclusive! Aqui está o resumo da tua sessão:
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pb-8">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl bg-secondary/50 border border-border/40">
                <div className="text-xs text-muted-foreground uppercase font-medium flex items-center justify-center gap-1.5 mb-1">
                  <Clock className="w-3.5 h-3.5 text-primary" /> Duração
                </div>
                <div className="text-xl sm:text-2xl font-bold font-mono">
                  {formatDuration(finalDuration)}
                </div>
              </div>

              <div className="p-4 rounded-xl bg-secondary/50 border border-border/40">
                <div className="text-xs text-muted-foreground uppercase font-medium flex items-center justify-center gap-1.5 mb-1">
                  <Users className="w-3.5 h-3.5 text-blue-400" /> Espectadores
                </div>
                <div className="text-xl sm:text-2xl font-bold font-mono">{viewers}</div>
              </div>

              <div className="p-4 rounded-xl bg-secondary/50 border border-border/40 col-span-2 sm:col-span-1">
                <div className="text-xs text-muted-foreground uppercase font-medium flex items-center justify-center gap-1.5 mb-1">
                  <Gift className="w-3.5 h-3.5 text-amber-400" /> Gorjetas
                </div>
                <div className="text-base sm:text-lg font-bold font-mono text-amber-400">
                  {sessionTipsCount} ({formatKz(sessionTipsTotalKz)})
                </div>
              </div>
            </div>

            <div className="pt-4 flex flex-col sm:flex-row justify-center gap-3">
              <Button onClick={handleResetForNewLive} className="gap-2 bg-primary hover:bg-primary/90 text-white font-semibold">
                <RefreshCw className="w-4 h-4" />
                Nova Transmissão
              </Button>
              <Button onClick={() => setLocation('/definicoes/monetizacao')} variant="outline" className="gap-2">
                <ArrowLeft className="w-4 h-4" />
                Ir para o Painel
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── ECRÃ PRINCIPAL DE TRANSMISSÃO ─────────────────────────────────────────
  return (
    <div className="w-full max-w-6xl mx-auto">

      {/* ═══════════════════════════════════════════════════════════════════════
          MOBILE: Layout fullscreen tipo Instagram Live (apenas < md)
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="md:hidden -mx-3 sm:-mx-4">
        <div
          className="relative w-full bg-black overflow-hidden"
          style={{ height: 'calc(100dvh - 60px)' }}
        >
          {/* Vídeo fullscreen em fundo */}
          <video
            ref={videoCallbackRef}
            autoPlay
            playsInline
            muted
            className={`absolute inset-0 w-full h-full object-cover transition-transform ${
              publisher.facingMode === 'user' ? 'scale-x-[-1]' : ''
            }`}
          />

          {/* Gradiente para legibilidade */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/65 via-transparent via-40% to-black/85 pointer-events-none z-10" />

          {/* Placeholder câmara off */}
          {(!publisher.isVideoEnabled || !publisher.mediaStream) && !isConnecting && (
            <div className="absolute inset-0 bg-zinc-950 flex flex-col items-center justify-center gap-3 z-10">
              <div className="w-20 h-20 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                <VideoOff className="w-10 h-10 text-zinc-500" />
              </div>
              <p className="text-sm font-medium text-zinc-400">Câmara desativada</p>
              {publisher.connectionState === 'idle' && (
                <Button onClick={() => publisher.requestMedia()} variant="outline" className="gap-2 mt-1 border-zinc-700 text-zinc-200">
                  <Video className="w-4 h-4" /> Ativar Câmara
                </Button>
              )}
            </div>
          )}

          {/* Overlay conectando */}
          {isConnecting && (
            <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center gap-4 text-white z-30">
              <div className="relative">
                <Loader2 className="w-14 h-14 animate-spin text-primary" />
                <Radio className="w-7 h-7 text-white absolute inset-0 m-auto" />
              </div>
              <div className="text-center">
                <h3 className="font-bold text-lg">A entrar em direto...</h3>
                <p className="text-xs text-zinc-300 mt-1">A ligar ao servidor seguro</p>
              </div>
            </div>
          )}

          {/* Alerta de erro mobile */}
          {isError && publisher.error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute top-20 left-3 right-3 z-30 p-3 rounded-xl bg-destructive/90 backdrop-blur-md border border-destructive/50 flex items-start gap-2 text-white text-xs"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">Erro no dispositivo</p>
                <p className="opacity-90 mt-0.5">{getHumanFriendlyError(publisher.error)}</p>
                <button onClick={() => publisher.requestMedia()} className="mt-1.5 flex items-center gap-1 underline opacity-80 text-[11px]">
                  <RefreshCw className="w-3 h-3" /> Tentar novamente
                </button>
              </div>
            </motion.div>
          )}

          {/* ── TOP BAR: Avatar + Nome + Badges + Fechar ── */}
          <div className="absolute top-0 left-0 right-0 z-20 px-4 pt-4 pb-2 flex items-center gap-2.5">
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <div className={`shrink-0 ${isLive ? 'ring-2 ring-red-500 ring-offset-1 ring-offset-black rounded-full p-0.5' : ''}`}>
                <Avatar className="w-9 h-9 border border-white/20">
                  <AvatarImage src={user.avatarUrl || ''} />
                  <AvatarFallback className="text-sm font-bold bg-zinc-800 text-white">
                    {user.nomeExibicao?.charAt(0) || 'C'}
                  </AvatarFallback>
                </Avatar>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-white font-semibold text-[13px] truncate leading-tight drop-shadow">
                  {user.nomeExibicao || user.username}
                </span>
                <span className="text-white/55 text-[10px] leading-tight">@{user.username}</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {isLive ? (
                <>
                  <div className="flex items-center gap-1 bg-red-600 text-white text-[11px] font-bold px-2.5 py-1 rounded-full shadow-lg">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                    AO VIVO
                  </div>
                  <div className="flex items-center gap-1 bg-black/50 backdrop-blur-md text-white text-[11px] px-2 py-1 rounded-full border border-white/15">
                    <Eye className="w-3 h-3 text-blue-300" />
                    {viewers}
                  </div>
                  <div className="flex items-center gap-1 bg-black/50 backdrop-blur-md text-white text-[11px] font-mono px-2 py-1 rounded-full border border-white/15">
                    <Clock className="w-3 h-3 text-zinc-300" />
                    {formatDuration(duration)}
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-1 bg-black/50 backdrop-blur-md text-zinc-200 text-[11px] font-semibold px-2.5 py-1 rounded-full border border-white/15">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  PREVIEW
                </div>
              )}
            </div>

            <button
              onClick={() => setLocation('/home')}
              className="w-8 h-8 rounded-full bg-black/40 backdrop-blur-md border border-white/15 flex items-center justify-center text-white shrink-0 ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Banner reconexão */}
          {isReconnecting && (
            <div className="absolute top-16 left-4 right-4 bg-amber-500/90 text-black px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg z-20 animate-pulse">
              <AlertTriangle className="w-4 h-4" />
              Ligação instável. A reconectar...
            </div>
          )}

          {/* ── CHAT OVERLAY (em live, sem reply aberto) ── */}
          {isLive && !showQuickReply && (
            <div className="absolute left-3 right-3 z-20 pointer-events-none" style={{ bottom: '96px' }}>
              <div
                ref={chatScrollOverlayRef}
                className="max-h-56 overflow-y-auto scrollbar-none flex flex-col gap-1.5 pointer-events-auto"
              >
                {feed.length === 0 ? (
                  <div className="bg-black/50 backdrop-blur-md border border-white/10 text-white/70 text-[11px] rounded-xl px-3 py-1.5 w-fit shadow-md">
                    A aguardar comentários... 💬
                  </div>
                ) : (
                  feed.map((item) => <CreatorFeedRow key={item.id} item={item} isPanel={false} />)
                )}
              </div>
            </div>
          )}

          {/* Gorjetas acumuladas */}
          {isLive && totalTipsKz > 0 && (
            <div className="absolute right-3 z-20" style={{ bottom: '100px' }}>
              <div className="flex items-center gap-1 bg-amber-500/25 backdrop-blur-md text-amber-300 text-[10px] font-bold px-2.5 py-1.5 rounded-full border border-amber-500/30 shadow-lg">
                <Gift className="w-3 h-3 text-amber-400" />
                {formatKz(totalTipsKz)}
              </div>
            </div>
          )}

          {/* ── INPUT REPLY RÁPIDO ── */}
          <AnimatePresence>
            {showQuickReply && isLive && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                transition={{ duration: 0.18 }}
                className="absolute left-3 right-3 z-30 flex items-center gap-2"
                style={{ bottom: '96px' }}
              >
                <Input
                  value={creatorReplyText}
                  onChange={(e) => setCreatorReplyText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSendCreatorMessage(); } }}
                  placeholder="Escreve um comentário..."
                  maxLength={300}
                  autoFocus
                  className="h-10 text-sm bg-zinc-950/80 backdrop-blur-xl border-white/20 text-white placeholder:text-white/40 rounded-full px-4"
                />
                <button
                  onClick={handleSendCreatorMessage}
                  disabled={!creatorReplyText.trim()}
                  className="w-10 h-10 shrink-0 rounded-full bg-primary flex items-center justify-center disabled:opacity-50"
                >
                  <Send className="w-4 h-4 text-white" />
                </button>
                <button
                  onClick={() => setShowQuickReply(false)}
                  className="w-10 h-10 shrink-0 rounded-full bg-white/15 flex items-center justify-center text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── BARRA INFERIOR DE CONTROLOS ── */}
          <div className="absolute bottom-0 left-0 right-0 z-20 px-4 pb-5 pt-2">
            {!isLive ? (
              /* PRÉ-LIVE */
              <div className="flex flex-col gap-3">
                <div className="flex justify-center gap-5 text-[11px] text-white/60">
                  <div className="flex items-center gap-1">
                    {publisher.isAudioEnabled ? <Mic className="w-3 h-3 text-emerald-400" /> : <MicOff className="w-3 h-3 text-red-400" />}
                    <span>{publisher.isAudioEnabled ? 'Mic ativo' : 'Mic mudo'}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {publisher.isVideoEnabled ? <Video className="w-3 h-3 text-emerald-400" /> : <VideoOff className="w-3 h-3 text-red-400" />}
                    <span>{publisher.isVideoEnabled ? 'Câmara OK' : 'Sem câmara'}</span>
                  </div>
                </div>

                <div className="flex items-center justify-center gap-6">
                  <button
                    type="button"
                    onClick={() => publisher.toggleMicrophone()}
                    className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-all ${
                      publisher.isAudioEnabled ? 'bg-white/20 text-white border border-white/20' : 'bg-red-600 text-white'
                    }`}
                  >
                    {publisher.isAudioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                  </button>

                  {/* Botão LIVE central */}
                  <button
                    type="button"
                    onClick={handleStartBroadcast}
                    disabled={isStarting || !publisher.mediaStream}
                    className="w-[76px] h-[76px] rounded-full bg-gradient-to-br from-red-600 to-pink-600 text-white flex flex-col items-center justify-center gap-0.5 shadow-2xl shadow-red-950/60 active:scale-95 transition-transform disabled:opacity-60 disabled:cursor-not-allowed border-[3px] border-white/25"
                  >
                    {isStarting ? (
                      <Loader2 className="w-8 h-8 animate-spin" />
                    ) : (
                      <>
                        <Radio className="w-7 h-7" />
                        <span className="text-[9px] font-black tracking-widest leading-none">LIVE</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => publisher.switchCamera()}
                    className="w-12 h-12 rounded-full bg-white/20 text-white border border-white/20 flex items-center justify-center shadow-lg active:scale-95 transition-all"
                  >
                    <SwitchCamera className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ) : (
              /* EM LIVE: barra tipo Instagram */
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => publisher.toggleMicrophone()}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95 ${publisher.isAudioEnabled ? 'bg-white/20 text-white' : 'bg-red-600 text-white'}`}
                >
                  {publisher.isAudioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                </button>

                <button
                  type="button"
                  onClick={() => publisher.toggleCamera()}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95 ${publisher.isVideoEnabled ? 'bg-white/20 text-white' : 'bg-red-600 text-white'}`}
                >
                  {publisher.isVideoEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                </button>

                {/* Caixa "Comentar" — estilo Instagram */}
                <button
                  type="button"
                  onClick={() => setShowQuickReply((prev) => !prev)}
                  className={cn(
                    'flex-1 h-10 rounded-full border px-4 text-left transition-all',
                    showQuickReply ? 'bg-white/25 border-white/30' : 'bg-white/10 border-white/20'
                  )}
                >
                  <span className="text-[12px] text-white/60">Comentar...</span>
                </button>

                <button
                  type="button"
                  onClick={handleCopyShareLink}
                  className="w-10 h-10 rounded-full bg-white/20 text-white flex items-center justify-center transition-all active:scale-95"
                  title="Copiar link"
                >
                  {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
                </button>

                <button
                  type="button"
                  onClick={() => publisher.switchCamera()}
                  className="w-10 h-10 rounded-full bg-white/20 text-white flex items-center justify-center transition-all active:scale-95"
                >
                  <SwitchCamera className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => setShowEndDialog(true)}
                  disabled={isEnding}
                  className="w-10 h-10 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg shadow-red-950/50 active:scale-95 transition-all disabled:opacity-60"
                  title="Terminar live"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          DESKTOP / TABLET (md+): Layout original preservado em 2 colunas
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="hidden md:block px-3 sm:px-6 py-4 sm:py-6 space-y-6">
        {/* Header do Estúdio */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-border/40">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight flex items-center gap-2.5">
                <Radio className="w-7 h-7 text-primary" />
                Estúdio de Transmissão
              </h1>
              {isLive && (
                <Badge className="bg-red-600 hover:bg-red-600 text-white font-bold px-2.5 py-0.5 animate-pulse text-xs tracking-wider">
                  AO VIVO
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Transmite em direto para os teus subscritores e seguidores com ultra baixa latência.
            </p>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
            <div className="flex items-center gap-2.5">
              <Avatar className="w-9 h-9 border border-border">
                <AvatarImage src={user.avatarUrl || ''} />
                <AvatarFallback className="text-xs font-bold">
                  {user.nomeExibicao?.charAt(0) || 'C'}
                </AvatarFallback>
              </Avatar>
              <div className="hidden sm:flex flex-col text-left text-xs leading-tight">
                <span className="font-semibold">{user.nomeExibicao}</span>
                <span className="text-muted-foreground">@{user.username}</span>
              </div>
            </div>
            {isLive && (
              <Button onClick={() => setShowEndDialog(true)} disabled={isEnding} variant="destructive" className="gap-2 font-semibold shadow-lg shadow-red-950/40">
                <Square className="w-4 h-4 fill-current" />
                Terminar Live
              </Button>
            )}
          </div>
        </div>

        {/* Alerta de erro desktop */}
        {isError && publisher.error && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 flex items-start gap-3 text-destructive">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <p className="font-semibold">Erro no dispositivo ou conexão</p>
              <p className="mt-0.5 text-destructive/90">{getHumanFriendlyError(publisher.error)}</p>
              <div className="mt-3">
                <Button onClick={() => publisher.requestMedia()} variant="outline" size="sm" className="gap-2 border-destructive/40 hover:bg-destructive/10">
                  <RefreshCw className="w-3.5 h-3.5" /> Tentar Reativar Câmara
                </Button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Grid Principal */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Coluna de Vídeo */}
          <div className="lg:col-span-2 space-y-4">
            <div className="relative aspect-[3/4] sm:aspect-video w-full bg-zinc-950 rounded-2xl overflow-hidden border border-border/80 shadow-2xl flex items-center justify-center group">
              <video
                ref={videoCallbackRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover transition-transform ${publisher.facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
              />

              {(!publisher.isVideoEnabled || !publisher.mediaStream) && !isConnecting && (
                <div className="absolute inset-0 bg-zinc-950 flex flex-col items-center justify-center gap-3 text-muted-foreground z-10">
                  <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                    <VideoOff className="w-8 h-8 text-zinc-500" />
                  </div>
                  <p className="text-sm font-medium">Câmara desativada ou sem sinal</p>
                  {publisher.connectionState === 'idle' && (
                    <Button onClick={() => publisher.requestMedia()} variant="outline" className="gap-2 mt-2">
                      <Video className="w-4 h-4" /> Ativar Câmara
                    </Button>
                  )}
                </div>
              )}

              {isConnecting && (
                <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center gap-4 text-white z-20">
                  <div className="relative">
                    <Loader2 className="w-12 h-12 animate-spin text-primary" />
                    <Radio className="w-6 h-6 text-white absolute inset-0 m-auto" />
                  </div>
                  <div className="text-center">
                    <h3 className="font-bold text-lg">A estabelecer transmissão ao vivo...</h3>
                    <p className="text-xs text-zinc-300 mt-1">A ligar ao servidor WebRTC seguro</p>
                  </div>
                </div>
              )}

              <div className="absolute top-4 left-4 right-4 flex justify-between items-center pointer-events-none z-20">
                <div className="flex items-center gap-2 pointer-events-auto">
                  {isLive ? (
                    <>
                      <div className="flex items-center gap-1.5 bg-red-600 text-white text-xs font-bold px-3 py-1.5 rounded-full shadow-lg">
                        <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                        AO VIVO
                      </div>
                      <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-md text-white text-xs font-mono font-medium px-3 py-1.5 rounded-full border border-white/10 shadow-lg">
                        <Clock className="w-3.5 h-3.5 text-zinc-300" />
                        {formatDuration(duration)}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-md text-zinc-200 text-xs font-semibold px-3 py-1.5 rounded-full border border-white/10 shadow-lg">
                      <span className="w-2 h-2 rounded-full bg-blue-400" />
                      PREVIEW
                    </div>
                  )}
                </div>
                {isLive && (
                  <div className="flex items-center gap-2 pointer-events-auto">
                    <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-md text-amber-300 text-xs font-bold px-2.5 sm:px-3 py-1.5 rounded-full border border-amber-500/30 shadow-lg">
                      <Gift className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>{formatKz(totalTipsKz)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-md text-white text-xs font-semibold px-2.5 sm:px-3 py-1.5 rounded-full border border-white/10 shadow-lg">
                      <Eye className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span>{viewers}</span>
                      <span className="hidden sm:inline">{viewers === 1 ? 'espectador' : 'espectadores'}</span>
                    </div>
                  </div>
                )}
              </div>

              {isReconnecting && (
                <div className="absolute top-16 left-4 right-4 bg-amber-500/90 backdrop-blur-md text-black px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg z-20 animate-pulse">
                  <AlertTriangle className="w-4 h-4" />
                  Ligação instável. A reconectar ao servidor...
                </div>
              )}

              {isLive && (
                <div className="absolute bottom-20 left-3 right-3 sm:left-4 sm:right-auto sm:max-w-sm pointer-events-none z-20">
                  <div ref={chatScrollOverlayRef} className="max-h-44 sm:max-h-56 overflow-y-auto scrollbar-none flex flex-col gap-1.5 pointer-events-auto pr-1">
                    {feed.length === 0 ? (
                      <div className="bg-black/50 backdrop-blur-md border border-white/10 text-white/70 text-[11px] rounded-xl px-3 py-1.5 w-fit shadow-md">
                        A aguardar comentários dos espectadores... 💬
                      </div>
                    ) : (
                      feed.map((item) => <CreatorFeedRow key={item.id} item={item} isPanel={false} />)
                    )}
                  </div>
                </div>
              )}

              {showQuickReply && isLive && (
                <div className="absolute bottom-20 left-3 right-3 sm:left-4 sm:right-auto sm:max-w-sm bg-zinc-950/90 backdrop-blur-xl border border-white/20 p-2 rounded-2xl shadow-2xl z-30 flex items-center gap-2">
                  <Input
                    value={creatorReplyText}
                    onChange={(e) => setCreatorReplyText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSendCreatorMessage(); } }}
                    placeholder="Escreve uma resposta rápida..."
                    maxLength={300}
                    autoFocus
                    className="h-8 text-xs bg-black/60 border-white/10 text-white placeholder:text-white/50"
                  />
                  <Button size="icon" onClick={handleSendCreatorMessage} disabled={!creatorReplyText.trim()} className="h-8 w-8 shrink-0 bg-primary hover:bg-primary/90 text-white rounded-xl" title="Enviar mensagem">
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => setShowQuickReply(false)} className="h-8 w-8 shrink-0 text-white/70 hover:text-white rounded-xl" title="Fechar">
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}

              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 sm:gap-3 bg-zinc-950/80 backdrop-blur-xl border border-white/10 px-3.5 sm:px-4 py-2 rounded-full shadow-2xl z-20">
                <button type="button" onClick={() => publisher.toggleMicrophone()} title={publisher.isAudioEnabled ? 'Desativar Microfone' : 'Ativar Microfone'} className={`w-9 sm:w-10 h-9 sm:h-10 rounded-full flex items-center justify-center transition-all ${publisher.isAudioEnabled ? 'bg-zinc-800/80 text-white hover:bg-zinc-700' : 'bg-red-600 text-white hover:bg-red-700 shadow-md shadow-red-950/40'}`}>
                  {publisher.isAudioEnabled ? <Mic className="w-4 sm:w-5 h-4 sm:h-5" /> : <MicOff className="w-4 sm:w-5 h-4 sm:h-5" />}
                </button>
                <button type="button" onClick={() => publisher.toggleCamera()} title={publisher.isVideoEnabled ? 'Desligar Vídeo' : 'Ligar Vídeo'} className={`w-9 sm:w-10 h-9 sm:h-10 rounded-full flex items-center justify-center transition-all ${publisher.isVideoEnabled ? 'bg-zinc-800/80 text-white hover:bg-zinc-700' : 'bg-red-600 text-white hover:bg-red-700 shadow-md shadow-red-950/40'}`}>
                  {publisher.isVideoEnabled ? <Video className="w-4 sm:w-5 h-4 sm:h-5" /> : <VideoOff className="w-4 sm:w-5 h-4 sm:h-5" />}
                </button>
                <button type="button" onClick={() => publisher.switchCamera()} className="w-9 sm:w-10 h-9 sm:h-10 rounded-full bg-zinc-800/80 text-white hover:bg-zinc-700 flex items-center justify-center transition-all">
                  <SwitchCamera className="w-4 sm:w-5 h-4 sm:h-5" />
                </button>
                {isLive && (
                  <button type="button" onClick={() => setShowQuickReply((prev) => !prev)} title="Responder no chat" className={cn('w-9 sm:w-10 h-9 sm:h-10 rounded-full flex items-center justify-center transition-all', showQuickReply ? 'bg-primary text-white' : 'bg-zinc-800/80 text-white hover:bg-zinc-700')}>
                    <MessageSquare className="w-4 sm:w-5 h-4 sm:h-5" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
              <span>Câmara: <strong className="text-foreground">{publisher.facingMode === 'user' ? 'Frontal' : 'Traseira'}</strong></span>
              <span>Microfone: <strong className={publisher.isAudioEnabled ? 'text-emerald-400' : 'text-red-400'}>{publisher.isAudioEnabled ? 'Ligado' : 'Mutado'}</strong></span>
              <span>Vídeo: <strong className={publisher.isVideoEnabled ? 'text-emerald-400' : 'text-red-400'}>{publisher.isVideoEnabled ? 'Ativo' : 'Desligado'}</strong></span>
            </div>
          </div>

          {/* Coluna Lateral desktop */}
          <div className="space-y-4">
            {!isLive ? (
              <Card className="border-border/60 bg-card/60 backdrop-blur-md shadow-xl">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-primary" />
                    Pronto para entrar em direto?
                  </CardTitle>
                  <CardDescription>
                    Verifica o teu enquadramento, iluminação e som antes de iniciar a emissão.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2 text-xs text-muted-foreground bg-secondary/30 p-3.5 rounded-xl border border-border/30">
                    <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /><span>Conexão WebRTC com baixa latência (~1s)</span></div>
                    <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /><span>Notificação automática enviada aos seguidores</span></div>
                    <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /><span>Gorjetas em Kz creditadas diretamente na tua carteira</span></div>
                    <div className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /><span>Chat interativo em tempo real via WebSocket</span></div>
                  </div>
                  <Button
                    onClick={handleStartBroadcast}
                    disabled={isStarting || !publisher.mediaStream}
                    className="w-full h-12 text-base font-bold bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 text-white shadow-xl shadow-red-950/40 gap-2.5 transition-all group"
                  >
                    {isStarting ? (
                      <><Loader2 className="w-5 h-5 animate-spin" />A Preparar Live...</>
                    ) : (
                      <><Radio className="w-5 h-5 animate-pulse group-hover:scale-110 transition-transform" />Iniciar Live Agora</>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <Card className="border-border/60 bg-card/60 backdrop-blur-md shadow-xl">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Share2 className="w-4 h-4 text-primary" />
                      Partilhar Live
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Envia este link para os teus amigos ou redes sociais para assistirem.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Input readOnly value={streamId ? `${typeof window !== 'undefined' ? window.location.origin : ''}/live/${streamId}` : ''} className="bg-secondary/50 font-mono text-xs h-9 select-all" />
                      <Button onClick={handleCopyShareLink} variant="outline" size="sm" className="gap-1.5 h-9 shrink-0">
                        {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        <span className="hidden sm:inline">{copiedLink ? 'Copiado' : 'Copiar'}</span>
                      </Button>
                    </div>
                    {streamId && (
                      <a href={`/live/${streamId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
                        <ExternalLink className="w-3.5 h-3.5" /> Abrir visualização do espectador numa nova aba
                      </a>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-border/60 bg-card/60 backdrop-blur-md shadow-xl flex flex-col h-[420px]">
                  <CardHeader className="pb-2.5 pt-3.5 border-b border-border/40 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-primary" />
                      Chat e Gorjetas ao Vivo
                    </CardTitle>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30 gap-1 px-2">
                        <Gift className="w-3 h-3" />{formatKz(totalTipsKz)}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px] gap-1 px-1.5">
                        <Users className="w-3 h-3" /> {viewers}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-hidden p-3 flex flex-col">
                    <div ref={chatScrollSidePanelRef} className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
                      {feed.length === 0 ? (
                        <div className="py-12 text-center text-xs text-muted-foreground flex flex-col items-center justify-center h-full">
                          <MessageSquare className="w-7 h-7 mx-auto mb-2 opacity-30 text-primary" />
                          <p className="font-medium">O chat está pronto e ligado.</p>
                          <p className="text-[11px] opacity-70 mt-0.5">As mensagens dos espectadores aparecerão aqui.</p>
                        </div>
                      ) : (
                        feed.map((item) => <CreatorFeedRow key={item.id} item={item} isPanel={true} />)
                      )}
                    </div>
                    <div className="pt-2 border-t border-border/40 mt-2 flex items-center gap-2">
                      <div className="relative flex-1">
                        <Input
                          value={creatorReplyText}
                          onChange={(e) => setCreatorReplyText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSendCreatorMessage(); } }}
                          placeholder="Escreve uma resposta para a live..."
                          maxLength={300}
                          className="text-xs h-8 pr-12"
                        />
                        {creatorReplyText.length > 0 && (
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-mono text-muted-foreground">{creatorReplyText.length}/300</span>
                        )}
                      </div>
                      <Button size="icon" onClick={handleSendCreatorMessage} disabled={!creatorReplyText.trim() || !isConnected} className="h-8 w-8 shrink-0" title="Enviar mensagem">
                        <Send className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Diálogo de Confirmação para Terminar Live */}
      <AlertDialog open={showEndDialog} onOpenChange={setShowEndDialog}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              Terminar Transmissão ao Vivo?
            </AlertDialogTitle>
            <AlertDialogDescription>
              A transmissão será encerrada para todos os espectadores atuais e a sala de chat será fechada. Esta ação não pode ser revertida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isEnding}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleEndBroadcast}
              disabled={isEnding}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
            >
              {isEnding ? (
                <><Loader2 className="w-4 h-4 animate-spin" />A Encerrar...</>
              ) : (
                'Sim, Terminar Live'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
