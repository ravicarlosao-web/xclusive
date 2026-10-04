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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getFreshAuthToken } from '@workspace/api-client-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  connectOvenWebrtcViewer,
  isWebrtcViewerSupported,
  type WebrtcFailReason,
  type WebrtcViewerSession,
} from '@/lib/ovenWebrtcViewer';

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

// ─── WebRTC primeiro, HLS como reserva ────────────────────────────────────────

/** Resposta de GET /api/live/:id/playback já reduzida ao que o player precisa. */
type PlaybackResult =
  | { ok: true; streamKey: string | null; webrtcUrl: string | null } // streamKey null = HLS desligado
  | { ok: false; status: number | null; code?: 'live_full' | 'webrtc_unavailable' }; // status null = erro de rede

const WEBRTC_MAX_ATTEMPTS = 3;
const WEBRTC_RETRY_DELAYS_MS = [0, 1500, 4000];
/** Teto da fase WebRTC antes do primeiro frame; passado isto cai para o HLS. */
const WEBRTC_PHASE_CAP_MS = 12_000;
/** Máximo de pedidos a /playback por sessão do player (por live, até recarregar a página). */
const WEBRTC_MAX_PLAYBACK_CALLS = 6;
/** Depois de tanto tempo de reprodução estável, o contador de tentativas volta a zero. */
const WEBRTC_STABLE_MS = 30_000;
/** Falha de ICE (timeout) memorizada neste dispositivo, para não pagar o atraso em cada live. */
const WEBRTC_ICE_FAIL_MEMORY_MS = 15 * 60 * 1000;
const WEBRTC_ICE_FAIL_KEY = 'xclusive_webrtc_ice_fail_until';
/** Transporte TCP (relay) que funcionou neste dispositivo: as lives seguintes começam por ele. */
const WEBRTC_TCP_MEMORY_MS = 15 * 60 * 1000;
const WEBRTC_TCP_KEY = 'xclusive_webrtc_tcp_until';
/**
 * Valor de `transport` na URL de sinalização durante a fase TCP. No OME recente `transport=tcp` é TCP ICE
 * direto (RFC 6544); o relé TURN embutido (que traz ice_servers no offer) pede-se com `transport=relay`.
 */
const TCP_PHASE_TRANSPORT = 'relay';
/** Intervalo mínimo entre cliques em "Tentar novamente". */
const WEBRTC_RETRY_BUTTON_MIN_INTERVAL_MS = 3000;

/** Lives (por id, "live:<id>") em que o WebRTC já não volta a ser tentado nesta sessão da página (só com HLS). */
const webrtcGivenUp = new Set<string>();
/** Pedidos a /playback já feitos por live ("live:<id>") nesta sessão da página. */
const webrtcPlaybackCalls = new Map<string, number>();

function isIceFailureRemembered(): boolean {
  try {
    const until = Number(localStorage.getItem(WEBRTC_ICE_FAIL_KEY));
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

function rememberIceFailure(): void {
  try {
    localStorage.setItem(WEBRTC_ICE_FAIL_KEY, String(Date.now() + WEBRTC_ICE_FAIL_MEMORY_MS));
  } catch {
    /* localStorage indisponível: ignora */
  }
}

function isTcpRemembered(): boolean {
  try {
    const until = Number(localStorage.getItem(WEBRTC_TCP_KEY));
    return Number.isFinite(until) && until > Date.now();
  } catch {
    return false;
  }
}

function rememberTcpWorked(): void {
  try {
    localStorage.setItem(WEBRTC_TCP_KEY, String(Date.now() + WEBRTC_TCP_MEMORY_MS));
  } catch {
    /* localStorage indisponível: ignora */
  }
}

/** Só estados e códigos fixos — nunca URL, token, SDP, candidatos, IPs ou error.message. */
function auditWebrtc(event: string, data?: Record<string, string | number | boolean>): void {
  console.info(`[AUDIT][WebRTC-Player] ${event}`, data ?? '');
}

// ─── Componente do Player de Vídeo HLS ────────────────────────────────────────

interface LiveVideoPlayerProps {
  streamKey?: string;
  viewers: number;
  className?: string;
  hideOverlayBadges?: boolean;
  isMuted?: boolean;
  onToggleMute?: () => void;
  /**
   * Pede GET /api/live/:id/playback na hora de ligar (o token do WebRTC vale 90 s
   * desde o pedido). Sem esta função, o player usa só o HLS.
   */
  fetchPlayback?: () => Promise<PlaybackResult>;
  /** Id da live: chave do estado do WebRTC (a streamKey, do HLS, pode não existir). */
  liveId?: number | null;
  /** A consulta da página a /playback já respondeu (sucesso ou erro): já se sabe se há HLS. */
  playbackSettled?: boolean;
  /** Pede à página que volte a consultar /playback (ex.: o HLS foi religado). */
  onRefreshPlayback?: () => void;
}

function LiveVideoPlayer({
  streamKey,
  viewers,
  className,
  hideOverlayBadges = false,
  isMuted = true,
  onToggleMute,
  fetchPlayback,
  liveId = null,
  playbackSettled = true,
  onRefreshPlayback,
}: LiveVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // ─── WebRTC (espectador) ──────────────────────────────────────────────
  const webrtcSessionRef = useRef<WebrtcViewerSession | null>(null);
  /** Incrementa a cada (re)arranque/limpeza: cancela trabalho assíncrono antigo. */
  const startSeqRef = useRef(0);
  const webrtcRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webrtcStableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webrtcAttemptsRef = useRef(0);
  const webrtcPhaseStartRef = useRef(0);
  const webrtcDeniedRef = useRef(false);
  /** Já houve primeiro frame nesta fase de ligação (o teto de 12 s só vale antes dele). */
  const webrtcHadFrameRef = useRef(false);
  /** Fase TCP (transport=TCP_PHASE_TRANSPORT + política relay): só corre quando não há HLS. */
  const webrtcTcpPhaseRef = useRef(false);
  /** Caminho ICE reportado pela ligação atual (udp | tcp_relay | other). */
  const webrtcPathRef = useRef<'udp' | 'tcp_relay' | 'other' | null>(null);
  const retryBlockedUntilRef = useRef(0);
  const [retryCooling, setRetryCooling] = useState(false);
  const [errorKind, setErrorKind] = useState<'generic' | 'live_full' | 'unavailable' | 'unsupported' | 'denied' | null>(null);
  /** Há HLS? (o /playback devolve a streamKey só com LIVE_HLS_ENABLED=true) */
  const hlsAvailable = !!streamKey;
  const liveKey = liveId !== null ? `live:${liveId}` : null;

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
        liveSyncDuration: 6.0,
        liveMaxLatencyDuration: 12.0,
        maxLiveSyncPlaybackRate: 1.1,
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

  // ─── WebRTC primeiro; HLS (initPlayer) como reserva — ou só WebRTC, sem HLS ─────────

  const clearWebrtc = () => {
    if (webrtcRetryTimerRef.current) clearTimeout(webrtcRetryTimerRef.current);
    if (webrtcStableTimerRef.current) clearTimeout(webrtcStableTimerRef.current);
    webrtcRetryTimerRef.current = null;
    webrtcStableTimerRef.current = null;
    webrtcSessionRef.current?.close();
    webrtcSessionRef.current = null;
  };

  /** Estado de erro claro (sem HLS para onde cair): mensagem + "Tentar novamente". */
  const showWebrtcError = (kind: 'generic' | 'live_full' | 'unavailable' | 'unsupported' | 'denied', message: string) => {
    clearWebrtc();
    auditWebrtc('ERROR_STATE', { kind });
    setIsPlaying(false);
    setIsLoading(false);
    setHasError(true);
    setErrorKind(kind);
    setErrorMessage(message);
  };

  /**
   * Desmonta o WebRTC e, se há HLS, arranca o HLS atual (o mesmo <video>, sem dois players).
   * Sem HLS (LIVE_HLS_ENABLED=false) mostra o estado de erro: nunca chama o hls.js nem o Safari nativo.
   */
  const fallbackToHls = (reason: string) => {
    if (!hlsAvailable) {
      auditWebrtc('NO_HLS_FALLBACK', { reason });
      showWebrtcError('generic', 'Não foi possível ligar à transmissão.');
      return;
    }
    if (liveKey) webrtcGivenUp.add(liveKey);
    clearWebrtc();
    auditWebrtc('FALLBACK_HLS', { reason });
    initPlayer();
  };

  const startPlayback = () => {
    startSeqRef.current += 1;
    clearWebrtc();
    webrtcDeniedRef.current = false;
    if (liveId === null || !liveKey || !playbackSettled) return;

    if (hlsAvailable) {
      if (
        !fetchPlayback ||
        webrtcGivenUp.has(liveKey) ||
        !isWebrtcViewerSupported() ||
        isIceFailureRemembered()
      ) {
        initPlayer();
        return;
      }
    } else {
      if (!fetchPlayback) return;
      if (!isWebrtcViewerSupported()) {
        showWebrtcError('unsupported', 'O teu navegador não suporta esta transmissão ao vivo.');
        return;
      }
    }

    webrtcAttemptsRef.current = 0;
    webrtcHadFrameRef.current = false;
    webrtcPhaseStartRef.current = Date.now();
    // Sem HLS, uma rede em que o UDP já falhou começa logo pelo TCP (relay).
    webrtcTcpPhaseRef.current = !hlsAvailable && isTcpRemembered();
    setIsPlaying(false);
    setErrorKind(null);
    void attemptWebrtc(startSeqRef.current);
  };

  const attemptWebrtc = async (seq: number) => {
    const video = videoRef.current;
    if (!video || !liveKey || !fetchPlayback || seq !== startSeqRef.current) return;

    setIsLoading(true);
    setHasError(false);
    setErrorKind(null);
    setErrorMessage(null);

    const attemptNo = webrtcAttemptsRef.current + 1;
    webrtcAttemptsRef.current = attemptNo;
    const tcpPhase = webrtcTcpPhaseRef.current;
    auditWebrtc('ATTEMPT', { n: attemptNo, of: WEBRTC_MAX_ATTEMPTS, transport: tcpPhase ? 'tcp' : 'udp' });

    // Cada ligação pede um /playback novo e usa o token já (os 90 s contam desde o pedido).
    const calls = webrtcPlaybackCalls.get(liveKey) ?? 0;
    if (calls >= WEBRTC_MAX_PLAYBACK_CALLS) {
      if (hlsAvailable) {
        fallbackToHls('playback_calls_exhausted');
      } else {
        auditWebrtc('PLAYBACK_CALLS_EXHAUSTED');
        showWebrtcError('generic', 'Demasiadas tentativas. Aguarda um momento e tenta novamente.');
      }
      return;
    }
    webrtcPlaybackCalls.set(liveKey, calls + 1);

    const pb = await fetchPlayback();
    if (seq !== startSeqRef.current) return;

    if (!pb.ok) {
      if (pb.status === 401 || pb.status === 403 || pb.status === 404 || pb.status === 409) {
        // Sem acesso / não encontrada / terminada: não cai para o HLS.
        auditWebrtc('PLAYBACK_REFUSED', { status: pb.status });
        webrtcDeniedRef.current = true;
        showWebrtcError('denied', pb.status === 409 ? 'A transmissão terminou.' : 'Não tens acesso a esta transmissão.');
        return;
      }
      if (pb.status === 503 && !hlsAvailable && (pb.code === 'live_full' || pb.code === 'webrtc_unavailable')) {
        // HLS desligado: live cheia (teto duro) ou WebRTC indisponível.
        auditWebrtc('PLAYBACK_UNAVAILABLE', { code: pb.code });
        if (pb.code === 'live_full') {
          showWebrtcError('live_full', 'Esta live está cheia. Tenta novamente dentro de instantes.');
        } else {
          showWebrtcError('unavailable', 'A transmissão ao vivo não está disponível neste momento.');
        }
        return;
      }
      auditWebrtc('PLAYBACK_ERROR', { status: pb.status ?? 0 });
      onWebrtcFailed(seq, 'playback_error');
      return;
    }

    // O HLS foi religado entretanto: a página volta a consultar /playback e o player reinicia com a chave.
    if (pb.streamKey && !hlsAvailable) {
      auditWebrtc('HLS_AVAILABLE_AGAIN');
      onRefreshPlayback?.();
      return;
    }

    // Sem campo webrtc (modo off, sem segredo…): HLS direto, sem erro; sem HLS, estado de erro.
    if (!pb.webrtcUrl) {
      auditWebrtc('NO_WEBRTC_OFFERED');
      fallbackToHls('not_offered');
      return;
    }

    // Nunca liga a um URL sem token. Fase TCP: acrescenta transport=<TCP_PHASE_TRANSPORT> (token novo, pedido agora).
    let connectUrl = pb.webrtcUrl;
    let hasToken = false;
    try {
      const u = new URL(pb.webrtcUrl);
      hasToken = !!u.searchParams.get('token');
      if (hasToken && tcpPhase) {
        u.searchParams.set('transport', TCP_PHASE_TRANSPORT);
        connectUrl = u.toString();
      }
    } catch {
      hasToken = false;
    }
    if (!hasToken) {
      auditWebrtc('NO_TOKEN');
      fallbackToHls('no_token');
      return;
    }

    webrtcPathRef.current = null;
    const t0 = performance.now();
    webrtcSessionRef.current = connectOvenWebrtcViewer({
      url: connectUrl,
      video,
      // UDP primeiro (política 'all' + ice_servers do offer); na fase TCP só relay.
      iceTransportPolicy: tcpPhase ? 'relay' : 'all',
      callbacks: {
        // Só contagens, booleanos e nomes de chaves — nunca URLs, utilizador, credencial, IPs, SDP ou candidatos.
        onIceInfo: (info) => {
          if (seq !== startSeqRef.current) return;
          auditWebrtc('ICE_SERVERS', { shape: info.shape, count: info.count, usable: info.usable, turn: info.turn });
          auditWebrtc('OFFER_KEYS', { top: JSON.stringify(info.topKeys), ice: JSON.stringify(info.iceKeys) });
          if (info.relayRequested && !info.relayApplied) auditWebrtc('NO_TURN_SERVERS', { code: 'no_turn_servers', relay: false });
        },
        onState: (state) => {
          if (seq !== startSeqRef.current) return;
          if (state === 'path_udp' || state === 'path_tcp_relay' || state === 'path_other') {
            const path = state === 'path_udp' ? 'udp' : state === 'path_tcp_relay' ? 'tcp_relay' : 'other';
            webrtcPathRef.current = path;
            auditWebrtc('PATH', { path });
          } else if (state === 'first_frame') {
            auditWebrtc('FIRST_FRAME', { ms: Math.round(performance.now() - t0) });
            webrtcHadFrameRef.current = true;
            setIsLoading(false);
            setHasError(false);
            setErrorKind(null);
            // Só memoriza o TCP se foi o TCP (relay) que funcionou, e só sem HLS.
            if (!hlsAvailable && webrtcPathRef.current === 'tcp_relay') rememberTcpWorked();
            if (webrtcStableTimerRef.current) clearTimeout(webrtcStableTimerRef.current);
            webrtcStableTimerRef.current = setTimeout(() => {
              webrtcAttemptsRef.current = 0;
              auditWebrtc('STABLE');
            }, WEBRTC_STABLE_MS);
          } else {
            auditWebrtc(state.toUpperCase());
          }
        },
        onStats: (st) => {
          if (seq !== startSeqRef.current) return;
          auditWebrtc('STATS', { fps: st.fps, kbps: st.kbps, lost: st.packetsLost });
        },
        onFailed: (reason) => onWebrtcFailed(seq, reason),
      },
    });
  };

  const onWebrtcFailed = (seq: number, reason: WebrtcFailReason | 'playback_error') => {
    if (seq !== startSeqRef.current) return;
    auditWebrtc('FAILED', { reason });
    if (webrtcStableTimerRef.current) clearTimeout(webrtcStableTimerRef.current);
    webrtcStableTimerRef.current = null;
    webrtcSessionRef.current = null;
    setIsPlaying(false);
    setIsLoading(true);

    // Uma queda depois de já ter reproduzido abre uma nova fase de reconexão (teto de 12 s).
    if (webrtcHadFrameRef.current) {
      webrtcHadFrameRef.current = false;
      webrtcPhaseStartRef.current = Date.now();
    }

    const iceFailure = reason === 'ice_timeout' || reason === 'ice_failed';
    if (hlsAvailable) {
      // Com HLS: só o timeout de ICE (rede sem UDP, p. ex.) é memorizado e vai ao HLS.
      if (reason === 'ice_timeout') {
        rememberIceFailure();
        fallbackToHls(reason);
        return;
      }
    } else if (iceFailure) {
      // Sem HLS: UDP falhou → uma tentativa por TCP (relay) com token novo; se já era TCP, erro.
      if (!webrtcTcpPhaseRef.current) {
        webrtcTcpPhaseRef.current = true;
        auditWebrtc('TCP_PHASE');
        webrtcRetryTimerRef.current = setTimeout(() => void attemptWebrtc(seq), 0);
        return;
      }
      showWebrtcError('generic', 'Não foi possível ligar à transmissão.');
      return;
    }
    if (reason === 'unsupported') {
      fallbackToHls(reason);
      return;
    }

    const used = webrtcAttemptsRef.current;
    const delay = (WEBRTC_RETRY_DELAYS_MS[used] ?? 4000) + Math.floor(Math.random() * 300);
    const overCap = Date.now() - webrtcPhaseStartRef.current + delay > WEBRTC_PHASE_CAP_MS;
    if (used >= WEBRTC_MAX_ATTEMPTS || overCap) {
      fallbackToHls('attempts_exhausted');
      return;
    }
    auditWebrtc('RETRY_SCHEDULED', { n: used + 1, delayMs: delay });
    webrtcRetryTimerRef.current = setTimeout(() => void attemptWebrtc(seq), delay);
  };

  const handleRetry = () => {
    // Intervalo mínimo de 3 s entre cliques.
    const now = Date.now();
    if (now < retryBlockedUntilRef.current) return;
    retryBlockedUntilRef.current = now + WEBRTC_RETRY_BUTTON_MIN_INTERVAL_MS;
    setRetryCooling(true);
    setTimeout(() => setRetryCooling(false), WEBRTC_RETRY_BUTTON_MIN_INTERVAL_MS);

    if (!hlsAvailable) {
      // Sem HLS: pedido novo (token novo), contadores a zero; e a página volta a perguntar pela chave
      // (se o HLS foi religado, o player passa a usá-lo).
      if (liveKey) {
        webrtcPlaybackCalls.delete(liveKey);
        webrtcGivenUp.delete(liveKey);
      }
      onRefreshPlayback?.();
      startPlayback();
    } else if (webrtcDeniedRef.current) {
      // Recusa do /playback (sem acesso/terminada): volta a verificar em vez de ir ao HLS.
      webrtcAttemptsRef.current = 0;
      startPlayback();
    } else {
      initPlayer();
    }
  };

  useEffect(() => {
    startPlayback();

    return () => {
      startSeqRef.current += 1;
      clearWebrtc();
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
  }, [streamUrl, liveId, playbackSettled]);

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
      {!isPlaying && (isLoading || !playbackSettled) && !hasError && (
        <div className="absolute inset-0 bg-zinc-950/85 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 gap-3 z-10">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm font-medium text-white/90">
            {errorMessage || 'A ligar à transmissão ao vivo…'}
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
              {errorKind === 'live_full'
                ? 'Há muitos espectadores neste momento.'
                : errorKind === 'unsupported'
                  ? 'Abre o link no Chrome ou no Safari para ver a transmissão.'
                  : errorKind
                    ? 'Verifica a tua ligação à internet e tenta novamente.'
                    : 'O criador pode estar a iniciar o encoder ou a conexão ainda está a ser sincronizada.'}
            </p>
          </div>
          {errorKind !== 'unsupported' && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleRetry}
              disabled={retryCooling}
              className="gap-2 text-xs border-white/20 hover:bg-white/10 text-white"
            >
              <RotateCw className="w-3.5 h-3.5" />
              Tentar novamente
            </Button>
          )}
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
  criadorId: number;
  iniciadoEm: string;
  totalVisualizadores: number;
  status?: string;
  /** Live gratuita ou paga (bilhete) — fixo desde a abertura */
  tipo: 'gratuita' | 'paga';
  /** Preço do bilhete em Kz (0 se gratuita) */
  preco: number;
  /** Se o utilizador atual pode ver (gratuita, bilhete, criadora ou admin) */
  temAcesso: boolean;
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

// ─── Ecrã de compra do bilhete (live paga, sem acesso) ────────────────────────

function LiveTicketGate({
  stream,
  saldo,
  durationSeconds,
  isBuying,
  onBuy,
  onTopUp,
  onBack,
}: {
  stream: ActiveStream;
  saldo: number | null;
  durationSeconds: number;
  isBuying: boolean;
  onBuy: () => void;
  onTopUp: () => void;
  onBack: () => void;
}) {
  const insuficiente = saldo !== null && saldo < stream.preco;
  const nome = stream.criador.nomeExibicao || stream.criador.username;
  return (
    <div className="fixed inset-0 z-50 bg-black overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-center gap-6 text-center px-4 py-10">
        <button
          type="button"
          onClick={onBack}
          className="absolute top-4 left-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <Avatar className="w-20 h-20 border-2 border-primary/60">
          <AvatarImage src={stream.criador.avatarUrl ?? undefined} alt={nome} />
          <AvatarFallback>{nome.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>

        <div>
          <Badge className="bg-red-600 text-white gap-1 mb-3">
            <Radio className="w-3 h-3" /> AO VIVO · live paga
          </Badge>
          <h2 className="text-2xl font-bold text-white">{nome}</h2>
          <p className="text-sm text-white/60 flex items-center justify-center gap-1.5 mt-1">
            <Clock className="w-3.5 h-3.5" /> A decorrer há {formatDuration(durationSeconds)}
          </p>
        </div>

        <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-white/5 p-5 space-y-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-white/60">Preço do bilhete</span>
            <span className="text-2xl font-extrabold text-white">{formatKz(stream.preco)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-white/60">O teu saldo</span>
            <span className={cn('text-sm font-semibold', insuficiente ? 'text-red-400' : 'text-white')}>
              {saldo !== null ? formatKz(saldo) : '—'}
            </span>
          </div>

          <p className="text-xs text-white/70 leading-relaxed">
            Esta live já começou. O bilhete tem o preço inteiro e dá acesso até ao fim.
          </p>

          {insuficiente && (
            <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-left text-xs text-red-300">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Saldo insuficiente: faltam {formatKz(stream.preco - (saldo ?? 0))}. Carrega a tua carteira para comprar o bilhete.
              </span>
            </div>
          )}

          {insuficiente ? (
            <Button onClick={onTopUp} className="w-full h-11 font-bold">
              Carregar carteira
            </Button>
          ) : (
            <Button onClick={onBuy} disabled={isBuying} className="w-full h-11 font-bold gap-2">
              {isBuying ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> A comprar...</>
              ) : (
                <>Comprar bilhete · {formatKz(stream.preco)}</>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Página Principal ─────────────────────────────────────────────────────────

export default function LivePage() {
  const [, params] = useRoute('/live/:streamId');
  const [, navigate] = useLocation();
  const { user, saldo, refreshSaldo } = useAuth();
  const queryClient = useQueryClient();

  const streamId = params?.streamId ? Number(params.streamId) : null;

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

  // Só entra na sala do socket quem tem acesso (o servidor volta a verificar sempre).
  const { viewers, feed, streamEnded, isConnected, sendMessage } = useSocket(
    stream && !stream.temAcesso ? null : streamId,
  );

  // A streamKey só chega a quem tem acesso (GET /api/live/:id/playback).
  // Com LIVE_HLS_ENABLED=false a resposta não traz streamKey (streamKey ausente = sem HLS).
  const { data: playback, isPending: playbackPending } = useQuery<{ streamKey?: string | null }>({
    queryKey: ['/api/live', streamId, 'playback'],
    enabled: streamId !== null && !!stream?.temAcesso,
    staleTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const token = await getFreshAuthToken();
      const res = await fetch(`/api/live/${streamId}/playback`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      // 503 (live cheia / WebRTC indisponível, só sem HLS): sem chave; o player mostra o estado.
      if (res.status === 503) return { streamKey: null };
      if (!res.ok) throw new Error('Sem acesso à live');
      return res.json();
    },
  });
  // A consulta já respondeu (com sucesso ou erro): já se sabe se existe HLS.
  const playbackSettled = !playbackPending;
  const refreshPlayback = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['/api/live', streamId, 'playback'] });
  }, [queryClient, streamId]);

  // Pedido fresco a /playback para cada ligação WebRTC (token de 90 s, nunca reutilizado).
  const fetchPlayback = useCallback(async (): Promise<PlaybackResult> => {
    try {
      const token = await getFreshAuthToken();
      const res = await fetch(`/api/live/${streamId}/playback`, {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const code = body?.code === 'live_full' || body?.code === 'webrtc_unavailable' ? body.code : undefined;
        return { ok: false, status: res.status, code };
      }
      const data = await res.json();
      return {
        ok: true,
        streamKey: typeof data?.streamKey === 'string' ? data.streamKey : null,
        webrtcUrl: typeof data?.webrtc?.url === 'string' ? data.webrtc.url : null,
      };
    } catch {
      return { ok: false, status: null };
    }
  }, [streamId]);

  // Compra do bilhete (live paga)
  const [isBuyingTicket, setIsBuyingTicket] = useState(false);
  const handleBuyTicket = async () => {
    if (!stream) return;
    setIsBuyingTicket(true);
    try {
      const token = await getFreshAuthToken();
      const res = await fetch(`/api/live/${stream.id}/ticket`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Não foi possível comprar o bilhete.');
        return;
      }
      toast.success(data.jaTinha ? 'Já tinhas bilhete para esta live.' : 'Bilhete comprado! Bom espetáculo.');
      refreshSaldo();
      await queryClient.invalidateQueries({ queryKey: ['/api/live/active'] });
    } catch {
      toast.error('Erro de ligação. Tenta novamente.');
    } finally {
      setIsBuyingTicket(false);
    }
  };

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

  // Breakpoint lg (Tailwind, 1024px): só um <LiveVideoPlayer> montado de cada vez,
  // para não criar duas instâncias do hls.js a pedir os mesmos segmentos.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

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

  // Live paga sem acesso: ecrã de compra (preço, saldo, botão).
  if (stream && !stream.temAcesso) {
    return (
      <LiveTicketGate
        stream={stream}
        saldo={saldo}
        durationSeconds={durationSeconds}
        isBuying={isBuyingTicket}
        onBuy={handleBuyTicket}
        onTopUp={() => navigate('/carteira')}
        onBack={() => navigate('/home')}
      />
    );
  }

  return (
    <>
      {/* ══════════════════════════════════════════════════════════════════════════
          LAYOUT MOBILE: FULL-BLEED (ECRÃ INTEIRO COM OVERLAYS)
          ══════════════════════════════════════════════════════════════════════════ */}
      <div className="lg:hidden fixed inset-0 z-50 bg-black flex flex-col justify-between overflow-hidden touch-manipulation">
        {/* Vídeo em fundo full-bleed */}
        <div className="absolute inset-0 w-full h-full">
          {!isDesktop && (
            <LiveVideoPlayer
              streamKey={playback?.streamKey ?? undefined}
              fetchPlayback={fetchPlayback}
              liveId={streamId}
              playbackSettled={playbackSettled}
              onRefreshPlayback={refreshPlayback}
              viewers={viewers}
              className="w-full h-full border-0 rounded-none"
              hideOverlayBadges={true}
              isMuted={isMuted}
              onToggleMute={toggleMute}
            />
          )}
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
              {isDesktop && (
                <LiveVideoPlayer
                  streamKey={playback?.streamKey ?? undefined}
                  fetchPlayback={fetchPlayback}
                  liveId={streamId}
                  playbackSettled={playbackSettled}
                  onRefreshPlayback={refreshPlayback}
                  viewers={viewers}
                  className="aspect-video rounded-2xl overflow-hidden bg-black border border-white/10 shadow-2xl"
                  hideOverlayBadges={false}
                  isMuted={isMuted}
                  onToggleMute={toggleMute}
                />
              )}

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
