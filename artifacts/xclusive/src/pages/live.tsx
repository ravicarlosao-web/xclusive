import { useEffect, useState, useRef, useCallback } from 'react';
import { useRoute, useLocation } from 'wouter';
import Hls from 'hls.js';
import { useAuth } from '@/contexts/AuthContext';
import { useSocket, type LiveFeedItem } from '@/hooks/useSocket';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Users,
  Radio,
  Send,
  Gift,
  ArrowLeft,
  AlertTriangle,
  Wifi,
  WifiOff,
  Loader2,
  RotateCw,
  Eye,
  Volume2,
  VolumeX,
  MoreVertical,
  Share2,
  Copy,
  Clock,
  MessageSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { getFreshAuthToken } from '@workspace/api-client-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

// ─── Configuração CDN ─────────────────────────────────────────────────────────
const BUNNY_LIVE_CDN_HOSTNAME =
  import.meta.env.VITE_BUNNY_LIVE_CDN_HOSTNAME || 'xclusivelive.b-cdn.net';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Componente do Player de Vídeo HLS ────────────────────────────────────────

interface LiveVideoPlayerProps {
  streamKey?: string;
  viewers: number;
  className?: string;
  hideOverlayBadges?: boolean;
  isMuted?: boolean;
  onToggleMute?: () => void;
}

function LiveVideoPlayer({
  streamKey,
  viewers,
  className,
  hideOverlayBadges = false,
  isMuted = true,
  onToggleMute,
}: LiveVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // ─── [AUDITORIA] Diagnóstico HLS.js ───────────────────────────────────
  // Refs de estado interno para instrumentação. Só logging — zero impacto.
  const auditStallCountRef = useRef(0);
  const auditStallStartRef = useRef<number | null>(null);
  const auditFragCountRef = useRef(0);
  const auditBufferPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const auditSessionStartRef = useRef<number>(Date.now());
  const auditLevelSwitchesRef = useRef(0);

  const streamUrl = streamKey
    ? `https://${BUNNY_LIVE_CDN_HOSTNAME}/live/${streamKey}/ts:playlist.m3u8`
    : null;

  // Sincronizar estado de mute do vídeo com a prop
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  const initPlayer = () => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    setIsLoading(true);
    setHasError(false);
    setErrorMessage(null);

    // Limpar instância anterior do Hls se existir
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 2000,
        liveDurationInfinity: true,
        liveSyncDuration: 10.0,
        liveMaxLatencyDuration: 22.0,
      });

      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_LOADED, (_event, _data) => {});
      hls.on(Hls.Events.LEVEL_LOADED, (_event, _data) => {});
      hls.on(Hls.Events.FRAG_LOADED, (_event, _data) => {});

      // ─── [AUDITORIA] Listeners de diagnóstico HLS.js ─────────────────────
      // Só logging — nenhum parâmetro ou comportamento do HLS.js é alterado.

      // 4.3a — Quando o vídeo retoma após stall, calcula a duração do freeze
      video.addEventListener('playing', () => {
        if (auditStallStartRef.current !== null) {
          const stallDurationMs = performance.now() - auditStallStartRef.current;
          auditStallStartRef.current = null;
          console.warn(
            `[AUDIT][HLS-Player] ✅ Retomado após stall ` +
            `| duração=${stallDurationMs.toFixed(0)} ms ` +
            `| stallsTotal=${auditStallCountRef.current}`
          );
        }
      });

      // 4.3b — Fragmento carregado: tamanho e tempo de download
      hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
        auditFragCountRef.current += 1;
        const loadDurationMs = data.frag.stats?.loading
          ? data.frag.stats.loading.end - data.frag.stats.loading.start
          : null;
        const sizeKb = data.frag.stats?.total
          ? (data.frag.stats.total / 1024).toFixed(1)
          : 'N/D';
        // Log apenas a cada 5 fragmentos para não poluir a consola
        if (auditFragCountRef.current % 5 === 0) {
          console.info(
            `[AUDIT][HLS-Player] FRAG_LOADED #${auditFragCountRef.current} ` +
            `| sn=${data.frag.sn} level=${data.frag.level} ` +
            `| size=${sizeKb} KB ` +
            `| loadTime=${loadDurationMs !== null ? loadDurationMs.toFixed(0) + ' ms' : 'N/D'}`
          );
        }
      });

      // 4.3c — Mudança de qualidade (adaptive bitrate)
      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        auditLevelSwitchesRef.current += 1;
        console.info(
          `[AUDIT][HLS-Player] LEVEL_SWITCHED #${auditLevelSwitchesRef.current} ` +
          `| novoNível=${data.level}`
        );
      });

      // 4.3d — Polling do nível de buffer a cada 5 s
      auditSessionStartRef.current = Date.now();
      if (auditBufferPollRef.current) clearInterval(auditBufferPollRef.current);
      auditBufferPollRef.current = setInterval(() => {
        const bufInfo = hls.mainForwardBufferInfo;
        const videoEl = videoRef.current;
        const elapsed = ((Date.now() - auditSessionStartRef.current) / 1000).toFixed(0);
        const currentTime = videoEl ? videoEl.currentTime.toFixed(2) : 'N/D';
        console.info(
          `[AUDIT][HLS-Player] BUFFER_STATUS t+${elapsed}s ` +
          `| bufferAhead=${bufInfo ? bufInfo.len.toFixed(2) + ' s' : 'N/D'} ` +
          `| currentTime=${currentTime} s ` +
          `| stalls=${auditStallCountRef.current} ` +
          `| levelSwitches=${auditLevelSwitchesRef.current} ` +
          `| fragsLoaded=${auditFragCountRef.current}`
        );
      }, 5000);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, _data) => {
        setIsLoading(false);
        setHasError(false);
        video.play().catch((err) => {
          console.warn('[LiveVideoPlayer] Autoplay unmuted failed:', err);
          video.muted = true;
          video.play().catch((e) => {
            console.warn('[LiveVideoPlayer] Autoplay muted failed:', e);
          });
        });
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        // [AUDITORIA] Deteta stall de buffer via ErrorDetails (não-fatal)
        if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
          auditStallCountRef.current += 1;
          auditStallStartRef.current = performance.now();
          const elapsed = ((Date.now() - auditSessionStartRef.current) / 1000).toFixed(1);
          console.warn(
            `[AUDIT][HLS-Player] ⚠️ BUFFER_STALLED #${auditStallCountRef.current} ` +
            `| t+${elapsed}s na sessão | totalStalls=${auditStallCountRef.current}`
          );
        }

        // [AUDITORIA] Log detalhado para todos os erros, fatais ou não
        console.error('[AUDIT][HLS-Player] HLS.Events.ERROR', {
          fatal: data.fatal,
          type: data.type,
          details: data.details,
          networkDetails: (data as any).networkDetails ? {
            url: (data as any).networkDetails?.url,
            status: (data as any).networkDetails?.code,
          } : undefined,
          bufferAhead: hls.mainForwardBufferInfo?.len?.toFixed(2) + ' s',
          stallCount: auditStallCountRef.current,
        });
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              setIsLoading(true);
              setErrorMessage('A aguardar o início da transmissão...');
              if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
              retryTimeoutRef.current = setTimeout(() => {
                hls.startLoad();
              }, 3000);
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              setHasError(true);
              setErrorMessage('Não foi possível carregar o vídeo.');
              hls.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => {
        setIsLoading(false);
        setHasError(false);
        video.play().catch(() => {
          video.muted = true;
          video.play().catch(() => {});
        });
      });

      video.addEventListener('error', () => {
        setHasError(true);
        setErrorMessage('A aguardar o início da transmissão...');
      });
    } else {
      setHasError(true);
      setErrorMessage('O teu navegador não suporta reprodução HLS.');
      setIsLoading(false);
    }
  };

  useEffect(() => {
    initPlayer();

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      // [AUDITORIA] Para o polling de buffer ao destruir o player
      if (auditBufferPollRef.current) {
        clearInterval(auditBufferPollRef.current);
        auditBufferPollRef.current = null;
      }
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamUrl]);

  return (
    <div
      className={cn(
        'relative bg-black flex items-center justify-center overflow-hidden',
        className || 'aspect-video rounded-2xl border border-white/10 shadow-2xl'
      )}
    >
      {/* Elemento de vídeo nativo */}
      <video
        ref={videoRef}
        playsInline
        muted={isMuted}
        autoPlay
        controls={false}
        onClick={onToggleMute}
        onPlaying={() => {
          setIsPlaying(true);
          setIsLoading(false);
          setHasError(false);
        }}
        onWaiting={() => setIsLoading(true)}
        className="w-full h-full object-contain cursor-pointer"
      />

      {/* Estado: Sem streamKey ou a carregar */}
      {!isPlaying && (isLoading || !streamKey) && !hasError && (
        <div className="absolute inset-0 bg-zinc-950/85 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 gap-3 z-10">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm font-medium text-white/90">
            {errorMessage || 'A ligar à transmissão ao vivo...'}
          </p>
          <p className="text-xs text-muted-foreground max-w-xs">
            A preparar o fluxo de vídeo com ultra-baixa latência (LL-HLS).
          </p>
        </div>
      )}

      {/* Estado: Erro / stream ainda não iniciada */}
      {!isPlaying && hasError && (
        <div className="absolute inset-0 bg-zinc-950/90 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 gap-3 z-10">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400">
            <Radio className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">
              {errorMessage || 'A aguardar o início da transmissão...'}
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              O criador pode estar a iniciar o encoder ou a conexão ainda está a ser sincronizada.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={initPlayer}
            className="gap-2 text-xs border-white/20 hover:bg-white/10 text-white"
          >
            <RotateCw className="w-3.5 h-3.5" />
            Tentar novamente
          </Button>
        </div>
      )}

      {/* Badges sobrepostos no vídeo (usados no desktop quando não ocultados) */}
      {!hideOverlayBadges && (
        <>
          <div className="absolute bottom-4 left-4 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5 pointer-events-none z-20">
            <Eye className="w-4 h-4 text-white" />
            <span className="text-white text-sm font-medium">{viewers}</span>
          </div>

          <div className="absolute top-4 left-4 flex items-center gap-1.5 bg-red-600 rounded-full px-3 py-1 pointer-events-none z-20">
            <span className="w-2 h-2 bg-white rounded-full animate-ping" />
            <span className="text-white text-xs font-bold">AO VIVO</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ActiveStream {
  id: number;
  streamKey: string;
  criadorId: number;
  iniciadoEm: string;
  totalVisualizadores: number;
  status?: string;
  criador: {
    username: string;
    nomeExibicao: string | null;
    avatarUrl: string | null;
  };
}

// ─── Componente de Item Unificado no Feed (Chat, Gorjeta, Entrada) ─────────────

interface FeedRowProps {
  item: LiveFeedItem;
  isOverlay?: boolean;
}

function FeedRow({ item, isOverlay = false }: FeedRowProps) {
  if (item.type === 'joined') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.2 }}
        className={cn(
          'flex items-center gap-1.5 py-1 px-2.5 rounded-full text-[11px] w-fit',
          isOverlay
            ? 'bg-black/40 backdrop-blur-md border border-white/10 text-white/70'
            : 'bg-muted/40 border border-border/30 text-muted-foreground'
        )}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
        <span className={cn('font-semibold', isOverlay ? 'text-white/90' : 'text-foreground')}>
          @{item.username}
        </span>
        <span>entrou na transmissão</span>
      </motion.div>
    );
  }

  if (item.type === 'tip') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className={cn(
          'flex items-start gap-2.5 p-2.5 rounded-xl border shadow-md',
          isOverlay
            ? 'bg-gradient-to-r from-amber-500/30 via-orange-500/25 to-amber-600/20 backdrop-blur-md border-amber-400/40 text-white'
            : 'bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-amber-500/5 border-amber-500/30'
        )}
      >
        <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-amber-400 to-orange-500 flex items-center justify-center shrink-0 shadow-sm mt-0.5">
          <Gift className="w-3.5 h-3.5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap leading-tight">
            <span className="font-bold text-xs text-amber-300">@{item.username}</span>
            <span className="text-[11px] text-white/70">enviou</span>
            <Badge className="bg-gradient-to-r from-amber-500 to-orange-500 text-white font-extrabold text-[10px] px-1.5 py-0 border-0 shadow-sm">
              {formatKz(item.valor)}
            </Badge>
            <span className="text-[10px] text-white/50 ml-auto">{timeAgo(item.enviadoEm)}</span>
          </div>
          {item.mensagem && (
            <p className="text-amber-100/95 font-medium mt-1 break-words text-xs leading-snug">
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
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className={cn(
        'flex items-start gap-2 py-1.5 px-2.5 rounded-xl text-xs leading-relaxed max-w-[95%]',
        isOverlay
          ? 'bg-black/55 backdrop-blur-md border border-white/10 text-white shadow-sm'
          : 'bg-muted/30 hover:bg-muted/50 border border-transparent hover:border-border/30 transition-colors text-foreground'
      )}
    >
      <Avatar className="w-5 h-5 shrink-0 mt-0.5 border border-white/10">
        <AvatarImage src={item.avatarUrl ?? undefined} />
        <AvatarFallback className="text-[9px] bg-primary/20 text-primary font-bold">
          {item.username.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <span className={cn('font-semibold mr-1.5', isOverlay ? 'text-amber-200' : 'text-primary')}>
          @{item.username}:
        </span>
        <span className={cn('break-words', isOverlay ? 'text-white/95' : 'text-foreground/90')}>
          {item.mensagem}
        </span>
      </div>
    </motion.div>
  );
}

// ─── Ecrã de Stream Terminado ─────────────────────────────────────────────────

function StreamEndedScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] gap-6 text-center px-4">
      <div className="w-20 h-20 rounded-full bg-muted/60 flex items-center justify-center border border-border">
        <Radio className="w-10 h-10 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-2xl font-bold mb-2">Live terminada</h2>
        <p className="text-muted-foreground max-w-sm">
          O criador terminou a transmissão em direto. Podes regressar à página principal para explorar outras transmissões e publicações.
        </p>
      </div>
      <Button onClick={onBack} variant="outline" className="gap-2">
        <ArrowLeft className="w-4 h-4" />
        Voltar ao início
      </Button>
    </div>
  );
}

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function LivePage() {
  const [, params] = useRoute('/live/:streamId');
  const [, navigate] = useLocation();
  const { user } = useAuth();

  const streamId = params?.streamId ? Number(params.streamId) : null;

  const { viewers, feed, streamEnded, isConnected, sendMessage } = useSocket(streamId);

  // Dados do stream
  const { data: activeStreams, isLoading } = useQuery<ActiveStream[]>({
    queryKey: ['/api/live/active'],
    queryFn: async () => {
      const token = await getFreshAuthToken();
      const res = await fetch('/api/live/active', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Erro ao carregar live');
      return res.json();
    },
    refetchInterval: 20_000,
  });

  const stream = activeStreams?.find((s) => s.id === streamId);
  const isCreator = !!user && stream?.criadorId === user.id;

  // Contador de duração decorrida da transmissão
  const [durationSeconds, setDurationSeconds] = useState(0);

  useEffect(() => {
    if (!stream?.iniciadoEm) return;
    const startTime = new Date(stream.iniciadoEm).getTime();
    const update = () => {
      const diff = Math.max(0, Math.floor((Date.now() - startTime) / 1000));
      setDurationSeconds(diff);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [stream?.iniciadoEm]);

  // Controlo de som
  const [isMuted, setIsMuted] = useState(true);
  const toggleMute = () => {
    setIsMuted((prev) => !prev);
  };

  // Auto-scroll do chat
  const chatScrollMobileRef = useRef<HTMLDivElement | null>(null);
  const chatScrollDesktopRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    const opts: ScrollToOptions = { behavior: smooth ? 'smooth' : 'auto' };
    if (chatScrollMobileRef.current) {
      chatScrollMobileRef.current.scrollTo({
        top: chatScrollMobileRef.current.scrollHeight,
        ...opts,
      });
    }
    if (chatScrollDesktopRef.current) {
      chatScrollDesktopRef.current.scrollTo({
        top: chatScrollDesktopRef.current.scrollHeight,
        ...opts,
      });
    }
  }, []);

  useEffect(() => {
    scrollToBottom(true);
  }, [feed.length, scrollToBottom]);

  // Input de chat
  const [chatMessage, setChatMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleSendMessage = () => {
    const trimmed = chatMessage.trim();
    if (!trimmed || !streamId) return;

    if (trimmed.length > 300) {
      toast.error('A mensagem não pode exceder 300 caracteres.');
      return;
    }

    setIsSending(true);
    const sent = sendMessage(streamId, trimmed);
    if (sent) {
      setChatMessage('');
      scrollToBottom(true);
    }
    setIsSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Modal de gorjeta
  const [tipOpen, setTipOpen] = useState(false);
  const [tipValor, setTipValor] = useState('');
  const [tipMensagem, setTipMensagem] = useState('');
  const [sendingTip, setSendingTip] = useState(false);

  async function handleSendTip() {
    const valor = Number(tipValor);
    if (!valor || valor <= 0 || !streamId) return;

    setSendingTip(true);
    try {
      const token = await getFreshAuthToken();
      const res = await fetch(`/api/live/${streamId}/tip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ valor, mensagem: tipMensagem || undefined }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao enviar gorjeta');
      }

      toast.success(`Gorjeta de ${formatKz(valor)} enviada! 🎉`);
      setTipOpen(false);
      setTipValor('');
      setTipMensagem('');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Erro ao enviar gorjeta');
    } finally {
      setSendingTip(false);
    }
  }

  // Notificação de término da live
  useEffect(() => {
    if (streamEnded) {
      toast.info('A live terminou.');
    }
  }, [streamEnded]);

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Live de @${stream?.criador.username || 'criador'} no Xclusive`,
          url,
        });
        return;
      } catch {
        // Fallback para cópia
      }
    }
    await navigator.clipboard.writeText(url);
    toast.success('Link da transmissão copiado!');
  };

  if (streamId === null) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">Stream inválido.</p>
      </div>
    );
  }

  if (streamEnded) {
    return <StreamEndedScreen onBack={() => navigate('/home')} />;
  }

  return (
    <>
      {/* ══════════════════════════════════════════════════════════════════════════
          LAYOUT MOBILE: FULL-BLEED (ECRÃ INTEIRO COM OVERLAYS)
          ══════════════════════════════════════════════════════════════════════════ */}
      <div className="lg:hidden fixed inset-0 z-50 bg-black flex flex-col justify-between overflow-hidden touch-manipulation">
        {/* Vídeo em fundo full-bleed */}
        <div className="absolute inset-0 w-full h-full">
          <LiveVideoPlayer
            streamKey={stream?.streamKey}
            viewers={viewers}
            className="w-full h-full border-0 rounded-none"
            hideOverlayBadges={true}
            isMuted={isMuted}
            onToggleMute={toggleMute}
          />
        </div>

        {/* ── Top Bar sobreposta (fundo semi-transparente) ──────────────────────── */}
        <header className="relative z-20 flex items-center justify-between p-3.5 pt-safe bg-gradient-to-b from-black/85 via-black/40 to-transparent pointer-events-auto">
          {/* Lado Esquerdo: Voltar + Avatar + Criador */}
          <div className="flex items-center gap-2.5 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/home')}
              className="w-8 h-8 rounded-full bg-black/40 text-white backdrop-blur-md hover:bg-black/60 shrink-0"
              title="Voltar ao feed"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>

            {isLoading ? (
              <Skeleton className="h-8 w-28 rounded-full bg-white/20" />
            ) : stream ? (
              <div className="flex items-center gap-2 bg-black/45 backdrop-blur-md rounded-full pl-1 pr-3 py-1 border border-white/10 max-w-[160px] sm:max-w-[200px]">
                <Avatar className="w-7 h-7 border border-red-500 shrink-0">
                  <AvatarImage src={stream.criador.avatarUrl ?? undefined} />
                  <AvatarFallback className="text-[10px] bg-red-600 text-white font-bold">
                    {(stream.criador.nomeExibicao ?? stream.criador.username).slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 leading-tight">
                  <p className="text-white text-xs font-semibold truncate">
                    {stream.criador.nomeExibicao ?? stream.criador.username}
                  </p>
                  <p className="text-white/60 text-[10px] truncate">@{stream.criador.username}</p>
                </div>
              </div>
            ) : null}
          </div>

          {/* Lado Direito: Badge AO VIVO + Viewers + Som + Menu */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Badge AO VIVO + Duração */}
            <div className="flex items-center gap-1 bg-red-600/90 text-white text-[11px] font-bold px-2 py-1 rounded-full shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
              <span>AO VIVO</span>
              {durationSeconds > 0 && (
                <span className="font-mono text-[10px] text-white/90 ml-0.5">
                  {formatDuration(durationSeconds)}
                </span>
              )}
            </div>

            {/* Contador de Espectadores com ícone de olho */}
            <div className="flex items-center gap-1 bg-black/50 backdrop-blur-md rounded-full px-2.5 py-1 text-white text-xs border border-white/10">
              <Eye className="w-3.5 h-3.5 text-white/80" />
              <span className="font-semibold">{viewers}</span>
            </div>

            {/* Botão de Som Mute/Unmute */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleMute}
              className="w-8 h-8 rounded-full bg-black/50 text-white backdrop-blur-md hover:bg-black/70 border border-white/10"
              title={isMuted ? 'Ativar som' : 'Silenciar'}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-amber-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
            </Button>

            {/* Menu Mais Opções (...) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8 rounded-full bg-black/50 text-white backdrop-blur-md hover:bg-black/70 border border-white/10"
                >
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-800 text-white">
                <DropdownMenuItem onClick={handleShare} className="gap-2 cursor-pointer">
                  <Share2 className="w-4 h-4" /> Partilhar transmissão
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href);
                    toast.success('Link copiado!');
                  }}
                  className="gap-2 cursor-pointer"
                >
                  <Copy className="w-4 h-4" /> Copiar link
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* ── Bottom Overlay: Chat Feed + Input Bar ─────────────────────────────── */}
        <div className="relative z-20 flex flex-col justify-end pointer-events-auto bg-gradient-to-t from-black/95 via-black/60 to-transparent pt-12 pb-safe px-3">
          {/* Feed de Chat e Gorjetas sobreposto */}
          <div
            ref={chatScrollMobileRef}
            className="max-h-60 sm:max-h-72 overflow-y-auto scrollbar-none flex flex-col gap-1.5 mb-2.5 mask-fade-top"
          >
            {feed.length === 0 ? (
              <p className="text-white/60 text-xs text-center py-2 bg-black/30 backdrop-blur-sm rounded-xl border border-white/5 mx-auto px-4">
                Dá as boas-vindas ao criador! Escreve a primeira mensagem. ✨
              </p>
            ) : (
              feed.map((item) => <FeedRow key={item.id} item={item} isOverlay={true} />)
            )}
          </div>

          {/* Barra de Input Inferior com Campo + Gorjeta + Envio */}
          <div className="flex items-center gap-2 pb-2">
            <div className="relative flex-1">
              <Input
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isConnected ? 'Escreva algo...' : 'A ligar ao chat...'}
                maxLength={300}
                disabled={!isConnected || streamEnded}
                className="bg-black/60 border-white/20 text-white placeholder:text-white/50 text-xs h-10 rounded-full pr-12 backdrop-blur-md focus-visible:ring-primary focus-visible:border-primary"
              />
              {chatMessage.length > 0 && (
                <span
                  className={cn(
                    'absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono',
                    chatMessage.length >= 280 ? 'text-amber-400' : 'text-white/40'
                  )}
                >
                  {chatMessage.length}/300
                </span>
              )}
            </div>

            {/* Botão de Enviar Mensagem */}
            <Button
              size="icon"
              onClick={handleSendMessage}
              disabled={!chatMessage.trim() || !isConnected || isSending}
              className="w-10 h-10 rounded-full bg-primary hover:bg-primary/90 text-white shrink-0 shadow-lg"
              title="Enviar mensagem"
            >
              <Send className="w-4 h-4" />
            </Button>

            {/* Botão de Gorjeta (apenas se utilizador logado e não for o criador) */}
            {!isCreator && user && (
              <Button
                size="icon"
                onClick={() => setTipOpen(true)}
                className="w-10 h-10 rounded-full bg-gradient-to-tr from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shrink-0 shadow-lg border-0"
                title="Enviar Gorjeta"
              >
                <Gift className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════════
          LAYOUT DESKTOP: DUAS COLUNAS (VÍDEO À ESQUERDA + CHAT À DIREITA)
          ══════════════════════════════════════════════════════════════════════════ */}
      <div className="hidden lg:block max-w-7xl mx-auto px-4 py-6 space-y-4">
        {/* Header Superior Desktop */}
        <div className="flex items-center justify-between gap-4 p-3 rounded-2xl bg-card/60 backdrop-blur-md border border-border">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/home')}
              className="rounded-full shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>

            {isLoading ? (
              <Skeleton className="h-10 w-48" />
            ) : stream ? (
              <div className="flex items-center gap-3 min-w-0">
                <Avatar className="w-10 h-10 border-2 border-red-500 shrink-0">
                  <AvatarImage src={stream.criador.avatarUrl ?? undefined} />
                  <AvatarFallback className="bg-red-600 text-white font-bold text-xs">
                    {(stream.criador.nomeExibicao ?? stream.criador.username).slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">
                    {stream.criador.nomeExibicao ?? stream.criador.username}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">@{stream.criador.username}</p>
                </div>
                <Badge className="bg-red-600 text-white border-0 gap-1.5 shrink-0 px-2.5 py-0.5">
                  <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                  AO VIVO
                </Badge>
                {durationSeconds > 0 && (
                  <Badge variant="outline" className="text-xs font-mono text-muted-foreground gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDuration(durationSeconds)}
                  </Badge>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-amber-500">
                <AlertTriangle className="w-5 h-5" />
                <span className="text-sm">Live não encontrada ou já terminou</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Indicador de Ligação WebSocket */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-2.5 py-1 rounded-full bg-muted/40 border border-border">
              {isConnected ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-emerald-500 font-medium">Ligado</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>A ligar...</span>
                </>
              )}
            </div>

            {/* Botão de Partilha */}
            <Button variant="outline" size="sm" onClick={handleShare} className="gap-2 text-xs">
              <Share2 className="w-3.5 h-3.5" /> Partilhar
            </Button>
          </div>
        </div>

        {/* Grelha de Duas Colunas */}
        <div className="grid grid-cols-12 gap-5 items-start">
          {/* Coluna Esquerda: Player de Vídeo HLS */}
          <div className="col-span-8 space-y-3">
            <div className="relative group">
              <LiveVideoPlayer
                streamKey={stream?.streamKey}
                viewers={viewers}
                className="aspect-video rounded-2xl overflow-hidden bg-black border border-white/10 shadow-2xl"
                hideOverlayBadges={false}
                isMuted={isMuted}
                onToggleMute={toggleMute}
              />

              {/* Botão flutuante de mute no player desktop */}
              <button
                onClick={toggleMute}
                className="absolute bottom-4 right-4 z-20 flex items-center gap-1.5 bg-black/70 hover:bg-black/90 backdrop-blur-md text-white text-xs px-3 py-1.5 rounded-full border border-white/10 transition-colors"
              >
                {isMuted ? (
                  <>
                    <VolumeX className="w-3.5 h-3.5 text-amber-400" />
                    <span>Desmutar som</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Silenciar</span>
                  </>
                )}
              </button>
            </div>

            {/* Barra de info logo abaixo do vídeo */}
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-card border border-border text-sm">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Eye className="w-4 h-4 text-primary" />
                  <span>
                    <strong className="text-foreground">{viewers}</strong> espectadores a ver agora
                  </span>
                </div>
              </div>

              {!isCreator && user && (
                <Button
                  size="sm"
                  onClick={() => setTipOpen(true)}
                  className="gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0 font-semibold text-xs h-8 px-3"
                >
                  <Gift className="w-3.5 h-3.5" />
                  Enviar Gorjeta
                </Button>
              )}
            </div>
          </div>

          {/* Coluna Direita: Painel Fixo de Chat em Direto */}
          <div className="col-span-4 flex flex-col h-[580px] rounded-2xl bg-card border border-border shadow-lg overflow-hidden">
            {/* Cabeçalho do Chat */}
            <div className="p-3.5 border-b border-border flex items-center justify-between bg-muted/20">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">Chat em Direto</h3>
              </div>
              <Badge variant="secondary" className="text-[11px] gap-1 px-2">
                <Users className="w-3 h-3" /> {viewers}
              </Badge>
            </div>

            {/* Feed de Mensagens com Auto-scroll */}
            <div
              ref={chatScrollDesktopRef}
              className="flex-1 overflow-y-auto p-3.5 space-y-2.5 scrollbar-thin"
            >
              {feed.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-6 text-muted-foreground">
                  <MessageSquare className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-xs font-medium">Ainda sem mensagens no chat.</p>
                  <p className="text-[11px] opacity-70 mt-0.5">Sê o primeiro a comentar a transmissão!</p>
                </div>
              ) : (
                feed.map((item) => <FeedRow key={item.id} item={item} isOverlay={false} />)
              )}
            </div>

            {/* Área de Input e Envio Desktop */}
            <div className="p-3 border-t border-border bg-card/80 space-y-2">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={isConnected ? 'Escreva uma mensagem...' : 'A ligar...'}
                    maxLength={300}
                    disabled={!isConnected || streamEnded}
                    className="text-xs h-9 pr-14"
                  />
                  {chatMessage.length > 0 && (
                    <span
                      className={cn(
                        'absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono',
                        chatMessage.length >= 280 ? 'text-amber-500 font-bold' : 'text-muted-foreground'
                      )}
                    >
                      {chatMessage.length}/300
                    </span>
                  )}
                </div>

                <Button
                  size="icon"
                  onClick={handleSendMessage}
                  disabled={!chatMessage.trim() || !isConnected || isSending}
                  className="h-9 w-9 shrink-0"
                  title="Enviar mensagem"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>

              {/* Botão de Gorjeta rápido se elegível */}
              {!isCreator && user && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTipOpen(true)}
                  className="w-full gap-2 text-xs h-8 border-amber-500/30 text-amber-500 hover:bg-amber-500/10 hover:text-amber-400"
                >
                  <Gift className="w-3.5 h-3.5" />
                  Enviar Gorjeta ao Criador
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Modal de Gorjeta (partilhado para Mobile e Desktop) ──────────────────── */}
      <Dialog open={tipOpen} onOpenChange={setTipOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="w-5 h-5 text-amber-400" />
              Enviar Gorjeta
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="tip-valor">Valor (Kz)</Label>
              <Input
                id="tip-valor"
                type="number"
                min="1"
                placeholder="Ex: 500"
                value={tipValor}
                onChange={(e) => setTipValor(e.target.value)}
              />
            </div>

            {/* Atalhos rápidos */}
            <div className="flex gap-2 flex-wrap">
              {[100, 250, 500, 1000].map((v) => (
                <Button
                  key={v}
                  variant="outline"
                  size="sm"
                  onClick={() => setTipValor(String(v))}
                  className={tipValor === String(v) ? 'border-amber-500 text-amber-400' : ''}
                >
                  {v} Kz
                </Button>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="tip-mensagem">Mensagem (opcional)</Label>
              <Textarea
                id="tip-mensagem"
                placeholder="Deixa uma mensagem para o criador..."
                value={tipMensagem}
                onChange={(e) => setTipMensagem(e.target.value)}
                maxLength={255}
                rows={3}
              />
              <p className="text-xs text-muted-foreground text-right">{tipMensagem.length}/255</p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setTipOpen(false)} disabled={sendingTip}>
              Cancelar
            </Button>
            <Button
              onClick={handleSendTip}
              disabled={!tipValor || Number(tipValor) <= 0 || sendingTip}
              className="gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 border-0"
            >
              {sendingTip ? (
                <span className="animate-pulse">A enviar...</span>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Enviar {tipValor ? formatKz(Number(tipValor)) : ''}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
