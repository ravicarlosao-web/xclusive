import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { useLivePublisher, sanitizeStreamKey } from '@/hooks/useLivePublisher';
import { useSocket, TipEvent } from '@/hooks/useSocket';
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
} from 'lucide-react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

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

  const videoRef = useRef<HTMLVideoElement | null>(null);

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

  // Socket para espectadores e gorjetas em tempo real
  const { viewers, recentTips } = useSocket(streamId);

  // Anexa o elemento de vídeo ao hook do publisher
  useEffect(() => {
    if (videoRef.current) {
      publisher.attachVideoElement(videoRef.current);
    }
  }, [publisher.attachVideoElement]);

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

  const isLive = publisher.connectionState === 'live';
  const isConnecting = publisher.connectionState === 'connecting' || isStarting;
  const isReconnecting = publisher.connectionState === 'reconnecting';
  const isError = publisher.connectionState === 'error';

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
                <div className="text-xl sm:text-2xl font-bold font-mono text-amber-400">
                  {recentTips.length}
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
    <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6">
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

        {/* Informação do Criador e Ação de Término */}
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
            <Button
              onClick={() => setShowEndDialog(true)}
              disabled={isEnding}
              variant="destructive"
              className="gap-2 font-semibold shadow-lg shadow-red-950/40"
            >
              <Square className="w-4 h-4 fill-current" />
              Terminar Live
            </Button>
          )}
        </div>
      </div>

      {/* Alerta de erro amigável se aplicável */}
      {isError && publisher.error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 flex items-start gap-3 text-destructive"
        >
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-semibold">Erro no dispositivo ou conexão</p>
            <p className="mt-0.5 text-destructive/90">{getHumanFriendlyError(publisher.error)}</p>
            <div className="mt-3">
              <Button
                onClick={() => publisher.requestMedia()}
                variant="outline"
                size="sm"
                className="gap-2 border-destructive/40 hover:bg-destructive/10"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Tentar Reativar Câmara
              </Button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Grid Principal: Vídeo na esquerda/centro, Painel lateral na direita */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Coluna de Vídeo (Ocupa 2 colunas em telas grandes) */}
        <div className="lg:col-span-2 space-y-4">
          <div className="relative aspect-[16/9] w-full bg-zinc-950 rounded-2xl overflow-hidden border border-border/80 shadow-2xl flex items-center justify-center group">
            {/* Elemento de Vídeo Local */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover transition-transform ${
                publisher.facingMode === 'user' ? 'scale-x-[-1]' : ''
              }`}
            />

            {/* Placeholder quando a câmara está desativada ou sem stream */}
            {(!publisher.isVideoEnabled || !publisher.mediaStream) && !isConnecting && (
              <div className="absolute inset-0 bg-zinc-950 flex flex-col items-center justify-center gap-3 text-muted-foreground z-10">
                <div className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                  <VideoOff className="w-8 h-8 text-zinc-500" />
                </div>
                <p className="text-sm font-medium">Câmara desativada ou sem sinal</p>
                {publisher.connectionState === 'idle' && (
                  <Button
                    onClick={() => publisher.requestMedia()}
                    variant="outline"
                    className="gap-2 mt-2"
                  >
                    <Video className="w-4 h-4" /> Ativar Câmara
                  </Button>
                )}
              </div>
            )}

            {/* Overlay de Conexão (Connecting) */}
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

            {/* Badges Superiores no Vídeo */}
            <div className="absolute top-4 left-4 right-4 flex justify-between items-center pointer-events-none z-20">
              {/* Esquerda: Status + Cronómetro */}
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

              {/* Direita: Espectadores ao vivo */}
              {isLive && (
                <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-md text-white text-xs font-semibold px-3 py-1.5 rounded-full border border-white/10 shadow-lg pointer-events-auto">
                  <Users className="w-3.5 h-3.5 text-blue-400" />
                  <span>{viewers} {viewers === 1 ? 'espectador' : 'espectadores'}</span>
                </div>
              )}
            </div>

            {/* Banner de Reconexão se houver oscilação de rede */}
            {isReconnecting && (
              <div className="absolute top-16 left-4 right-4 bg-amber-500/90 backdrop-blur-md text-black px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg z-20 animate-pulse">
                <AlertTriangle className="w-4 h-4" />
                Ligação instável. A reconectar ao servidor...
              </div>
            )}

            {/* Barra Flutuante de Controlos do Dispositivo (Overlay Inferior) */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 sm:gap-3 bg-zinc-950/80 backdrop-blur-xl border border-white/10 px-4 py-2 rounded-full shadow-2xl z-20">
              {/* Alternar Microfone */}
              <button
                type="button"
                onClick={() => publisher.toggleMicrophone()}
                title={publisher.isAudioEnabled ? 'Desativar Microfone' : 'Ativar Microfone'}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                  publisher.isAudioEnabled
                    ? 'bg-zinc-800/80 text-white hover:bg-zinc-700'
                    : 'bg-red-600 text-white hover:bg-red-700 shadow-md shadow-red-950/40'
                }`}
              >
                {publisher.isAudioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </button>

              {/* Alternar Câmara */}
              <button
                type="button"
                onClick={() => publisher.toggleCamera()}
                title={publisher.isVideoEnabled ? 'Desligar Vídeo' : 'Ligar Vídeo'}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                  publisher.isVideoEnabled
                    ? 'bg-zinc-800/80 text-white hover:bg-zinc-700'
                    : 'bg-red-600 text-white hover:bg-red-700 shadow-md shadow-red-950/40'
                }`}
              >
                {publisher.isVideoEnabled ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
              </button>

              {/* Trocar Câmara Frontal / Traseira */}
              <button
                type="button"
                onClick={() => publisher.switchCamera()}
                title={`Alternar para câmara ${publisher.facingMode === 'user' ? 'traseira' : 'frontal'}`}
                className="w-10 h-10 rounded-full bg-zinc-800/80 text-white hover:bg-zinc-700 flex items-center justify-center transition-all"
              >
                <SwitchCamera className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Dica discreta de dispositivos */}
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>
              Câmara: <strong className="text-foreground">{publisher.facingMode === 'user' ? 'Frontal' : 'Traseira'}</strong>
            </span>
            <span>
              Microfone: <strong className={publisher.isAudioEnabled ? 'text-emerald-400' : 'text-red-400'}>
                {publisher.isAudioEnabled ? 'Ligado' : 'Mutado'}
              </strong>
            </span>
            <span>
              Vídeo: <strong className={publisher.isVideoEnabled ? 'text-emerald-400' : 'text-red-400'}>
                {publisher.isVideoEnabled ? 'Ativo' : 'Desligado'}
              </strong>
            </span>
          </div>
        </div>

        {/* Coluna Lateral: Controlos, Partilha e Gorjetas em Tempo Real */}
        <div className="space-y-4">
          {!isLive ? (
            /* Card de Preparação Pré-Transmissão */
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
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>Conexão WebRTC com baixa latência (~1s)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>Notificação automática enviada aos seguidores</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>Gorjetas em Kz creditadas diretamente na tua carteira</span>
                  </div>
                </div>

                <Button
                  onClick={handleStartBroadcast}
                  disabled={isStarting || !publisher.mediaStream}
                  className="w-full h-12 text-base font-bold bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 text-white shadow-xl shadow-red-950/40 gap-2.5 transition-all group"
                >
                  {isStarting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      A Preparar Live...
                    </>
                  ) : (
                    <>
                      <Radio className="w-5 h-5 animate-pulse group-hover:scale-110 transition-transform" />
                      Iniciar Live Agora
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          ) : (
            /* Card da Live em Curso: Link e Feed de Interação */
            <div className="space-y-4">
              {/* Partilhar Link */}
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
                    <Input
                      readOnly
                      value={
                        streamId
                          ? `${typeof window !== 'undefined' ? window.location.origin : ''}/live/${streamId}`
                          : ''
                      }
                      className="bg-secondary/50 font-mono text-xs h-9 select-all"
                    />
                    <Button
                      onClick={handleCopyShareLink}
                      variant="outline"
                      size="sm"
                      className="gap-1.5 h-9 shrink-0"
                    >
                      {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      <span className="hidden sm:inline">{copiedLink ? 'Copiado' : 'Copiar'}</span>
                    </Button>
                  </div>

                  {streamId && (
                    <a
                      href={`/live/${streamId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Abrir visualização do espectador numa nova aba
                    </a>
                  )}
                </CardContent>
              </Card>

              {/* Feed de Gorjetas Recebidas ao Vivo */}
              <Card className="border-border/60 bg-card/60 backdrop-blur-md shadow-xl">
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Gift className="w-4 h-4 text-amber-400" />
                    Gorjetas ao Vivo
                  </CardTitle>
                  <span className="text-xs font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
                    {recentTips.length}
                  </span>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                    {recentTips.length === 0 ? (
                      <div className="py-8 text-center text-xs text-muted-foreground">
                        <Gift className="w-6 h-6 mx-auto mb-2 opacity-30 text-amber-400" />
                        As gorjetas enviadas pelos espectadores aparecerão aqui em tempo real.
                      </div>
                    ) : (
                      <AnimatePresence>
                        {recentTips.map((tip: TipEvent, idx: number) => (
                          <motion.div
                            key={`${tip.enviadoEm}-${idx}`}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0 }}
                            className="p-2.5 rounded-xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 text-xs"
                          >
                            <div className="flex items-center justify-between font-semibold">
                              <span className="text-amber-400">@{tip.username}</span>
                              <span className="text-amber-300 font-bold font-mono">
                                +{formatKz(tip.valor)}
                              </span>
                            </div>
                            {tip.mensagem && (
                              <p className="mt-1 text-foreground/80 break-words">{tip.mensagem}</p>
                            )}
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
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
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  A Encerrar...
                </>
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
