import { useEffect, useState, useRef } from 'react';
import { useRoute, useLocation } from 'wouter';
import Hls from 'hls.js';
import { useAuth } from '@/contexts/AuthContext';
import { useSocket } from '@/hooks/useSocket';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Radio, Send, Gift, ArrowLeft, AlertTriangle, Wifi, WifiOff, Loader2, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { getFreshAuthToken } from '@workspace/api-client-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Configuração CDN ─────────────────────────────────────────────────────────
// Hostname padrão da Pull Zone Bunny CDN para entrega LL-HLS.
// Pode ser substituído via variável de ambiente VITE_BUNNY_LIVE_CDN_HOSTNAME.
const BUNNY_LIVE_CDN_HOSTNAME =
  import.meta.env.VITE_BUNNY_LIVE_CDN_HOSTNAME || 'xclusivelive.b-cdn.net';

// ─── Componente do Player de Vídeo HLS ────────────────────────────────────────

interface LiveVideoPlayerProps {
  streamKey?: string;
  viewers: number;
}

function LiveVideoPlayer({ streamKey, viewers }: LiveVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const streamUrl = streamKey
    ? `https://${BUNNY_LIVE_CDN_HOSTNAME}/live/${streamKey}/llhls.m3u8`
    : null;

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
        lowLatencyMode: true,
        backBufferLength: 30,
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 2000,
      });

      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoading(false);
        setHasError(false);
        video.play().catch(() => {
          // Autoplay com som bloqueado pelo browser; mantém mudo e tenta novamente
          video.muted = true;
          video.play().catch(() => {
            // Utilizador pode clicar no botão de play nativo
          });
        });
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // Erro de rede (ex: 404 se o criador ainda não começou a transmitir)
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
      // Suporte nativo para HLS (Safari / iOS WebKit)
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
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [streamUrl]);

  return (
    <div className="relative aspect-video rounded-2xl overflow-hidden bg-black border border-white/10 flex items-center justify-center">
      {/* Elemento de vídeo nativo com controlos */}
      <video
        ref={videoRef}
        controls
        playsInline
        muted
        autoPlay
        onPlaying={() => {
          setIsPlaying(true);
          setIsLoading(false);
          setHasError(false);
        }}
        onWaiting={() => setIsLoading(true)}
        className="w-full h-full object-contain"
      />

      {/* Estado: Sem streamKey ou a carregar */}
      {!isPlaying && (isLoading || !streamKey) && !hasError && (
        <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm flex flex-col items-center justify-center text-center p-6 gap-3 z-10">
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
            className="gap-2 text-xs border-white/20 hover:bg-white/10"
          >
            <RotateCw className="w-3.5 h-3.5" />
            Tentar novamente
          </Button>
        </div>
      )}

      {/* Badges sobrepostos no vídeo */}
      <div className="absolute bottom-4 left-4 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5 pointer-events-none z-20">
        <Users className="w-4 h-4 text-white" />
        <span className="text-white text-sm font-medium">{viewers}</span>
      </div>

      <div className="absolute top-4 left-4 flex items-center gap-1.5 bg-red-600 rounded-full px-3 py-1 pointer-events-none z-20">
        <span className="w-2 h-2 bg-white rounded-full animate-ping" />
        <span className="text-white text-xs font-bold">AO VIVO</span>
      </div>
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
  criador: {
    username: string;
    nomeExibicao: string | null;
    avatarUrl: string | null;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatKz(valor: number): string {
  return `${valor.toLocaleString('pt-PT')} Kz`;
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `há ${diff}s`;
  if (diff < 3600) return `há ${Math.floor(diff / 60)}m`;
  return `há ${Math.floor(diff / 3600)}h`;
}

// ─── Componente de Gorjeta no Feed ───────────────────────────────────────────

function TipItem({ tip }: { tip: { username: string; valor: number; mensagem: string | null; enviadoEm: string } }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -20, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 20, scale: 0.95 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex items-start gap-3 p-3 rounded-xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20"
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
        <Gift className="w-4 h-4 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-amber-400">@{tip.username}</span>
          <span className="text-xs text-muted-foreground">enviou</span>
          <span className="font-bold text-sm text-amber-300">{formatKz(tip.valor)}</span>
          <span className="text-xs text-muted-foreground ml-auto">{timeAgo(tip.enviadoEm)}</span>
        </div>
        {tip.mensagem && (
          <p className="text-sm text-foreground/80 mt-0.5 break-words">{tip.mensagem}</p>
        )}
      </div>
    </motion.div>
  );
}

// ─── Ecrã de Stream Terminado ─────────────────────────────────────────────────

function StreamEndedScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
      <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
        <Radio className="w-10 h-10 text-muted-foreground" />
      </div>
      <div>
        <h2 className="text-2xl font-bold mb-2">Live terminada</h2>
        <p className="text-muted-foreground">O criador terminou a transmissão.</p>
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

  const { viewers, recentTips, streamEnded, isConnected } = useSocket(streamId);

  // Dados do stream (para mostrar criador, etc.)
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
    refetchInterval: 30_000,
  });

  const stream = activeStreams?.find((s) => s.id === streamId);
  const isCreator = stream?.criadorId === user?.id;

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

  // Redireccionamento quando stream termina
  useEffect(() => {
    if (streamEnded) {
      toast.info('A live terminou.');
    }
  }, [streamEnded]);

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
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/home')}
          className="rounded-full"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>

        {isLoading ? (
          <Skeleton className="h-10 w-48" />
        ) : stream ? (
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Avatar className="w-10 h-10 border-2 border-red-500">
              <AvatarImage src={stream.criador.avatarUrl ?? undefined} />
              <AvatarFallback>
                {(stream.criador.nomeExibicao ?? stream.criador.username).slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="font-semibold text-sm leading-tight truncate">
                {stream.criador.nomeExibicao ?? stream.criador.username}
              </p>
              <p className="text-xs text-muted-foreground">@{stream.criador.username}</p>
            </div>
            <Badge className="bg-red-600 text-white border-0 animate-pulse shrink-0">
              <Radio className="w-3 h-3 mr-1" />
              AO VIVO
            </Badge>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-amber-500">
            <AlertTriangle className="w-5 h-5" />
            <span className="text-sm">Live não encontrada ou já terminou</span>
          </div>
        )}

        {/* Estado de ligação */}
        <div className="flex items-center gap-1.5 ml-auto text-xs shrink-0">
          {isConnected ? (
            <><Wifi className="w-4 h-4 text-green-500" /><span className="text-green-500 hidden sm:inline">Ligado</span></>
          ) : (
            <><WifiOff className="w-4 h-4 text-muted-foreground" /><span className="text-muted-foreground hidden sm:inline">A ligar...</span></>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Área de vídeo com player HLS */}
        <div className="lg:col-span-2 space-y-3">
          <LiveVideoPlayer streamKey={stream?.streamKey} viewers={viewers} />

          {/* Contador de viewers (abaixo do vídeo em mobile) */}
          <div className="flex items-center gap-4 px-1 lg:hidden">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="w-4 h-4" />
              <span><strong className="text-foreground">{viewers}</strong> a ver</span>
            </div>
          </div>
        </div>

        {/* Painel lateral — gorjetas + acções */}
        <div className="flex flex-col gap-4">
          {/* Contador de viewers (só desktop) */}
          <div className="hidden lg:flex items-center gap-3 p-4 rounded-xl bg-muted/40 border border-border">
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold leading-tight">{viewers}</p>
              <p className="text-xs text-muted-foreground">a ver agora</p>
            </div>
          </div>

          {/* Botão de gorjeta (não mostrar ao criador) */}
          {!isCreator && user && (
            <Button
              onClick={() => setTipOpen(true)}
              className="w-full gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0 font-semibold"
            >
              <Gift className="w-4 h-4" />
              Enviar Gorjeta
            </Button>
          )}

          {/* Feed de gorjetas */}
          <div className="flex-1 flex flex-col gap-2 min-h-0">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide px-1">
              Gorjetas recentes
            </h3>

            <div className="flex flex-col gap-2 max-h-80 lg:max-h-none overflow-y-auto scrollbar-thin">
              <AnimatePresence initial={false}>
                {recentTips.length === 0 ? (
                  <motion.p
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-sm text-muted-foreground text-center py-8"
                  >
                    Ainda não há gorjetas. Sê o primeiro! 🎁
                  </motion.p>
                ) : (
                  recentTips.map((tip, i) => (
                    <TipItem key={`${tip.username}-${tip.enviadoEm}-${i}`} tip={tip} />
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Gorjeta */}
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
    </div>
  );
}
