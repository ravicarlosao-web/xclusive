import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLivePublisher, LiveConnectionState, sanitizeStreamKey } from '@/hooks/useLivePublisher';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  SwitchCamera,
  Radio,
  Square,
  Play,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';

export default function LivePublishTest() {
  const { user, isAuthenticated } = useAuth();
  const [streamId, setStreamId] = useState<number | null>(null);
  const [streamKey, setStreamKey] = useState<string>('');
  const [backendStatus, setBackendStatus] = useState<string | null>(null);
  const [loadingBackend, setLoadingBackend] = useState<boolean>(false);
  const [customSignallingUrl, setCustomSignallingUrl] = useState<string>('');
  const [activeLives, setActiveLives] = useState<any[] | null>(null);
  const [checkingActive, setCheckingActive] = useState<boolean>(false);
  const [logs, setLogs] = useState<{ time: string; msg: string; type: 'info' | 'success' | 'warn' | 'error' }[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const publisher = useLivePublisher();

  const addLog = (msg: string, type: 'info' | 'success' | 'warn' | 'error' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [{ time, msg, type }, ...prev.slice(0, 49)]);
  };

  // Conecta o elemento de vídeo ao hook
  useEffect(() => {
    if (videoRef.current) {
      publisher.attachVideoElement(videoRef.current);
    }
  }, [publisher.attachVideoElement]);

  // Regista mudanças de estado nos logs visuais
  useEffect(() => {
    addLog(`Estado de conexão alterado para: [${publisher.connectionState}]`, 
      publisher.connectionState === 'live' ? 'success' :
      publisher.connectionState === 'error' ? 'error' :
      publisher.connectionState === 'reconnecting' ? 'warn' : 'info'
    );
  }, [publisher.connectionState]);

  // Se houver erro no hook, regista no log
  useEffect(() => {
    if (publisher.error) {
      addLog(`❌ Erro no publisher: ${publisher.error}`, 'error');
    }
  }, [publisher.error]);

  /**
   * Passo 1: Chamar POST /api/live/start com token do utilizador autenticado
   */
  const handleStartOnBackend = async () => {
    setLoadingBackend(true);
    addLog('A contactar backend: POST /api/live/start...', 'info');

    try {
      const token = localStorage.getItem('xclusive_token');
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
        throw new Error(errJson.error || `HTTP ${res.status}: Erro ao iniciar live.`);
      }

      const data = await res.json();
      const pureKey = sanitizeStreamKey(data.streamKey);
      setStreamId(data.id);
      setStreamKey(pureKey);
      setBackendStatus(data.status);

      addLog(`✅ Live criada/recuperada no backend! ID: ${data.id} | Status: "${data.status}" | StreamKey: ${pureKey}`, 'success');

      // Atualiza SEMPRE a URL de sinalização com a streamKey pura (sem chavetas)
      const isHttps = window.location.protocol === 'https:';
      const proto = isHttps ? 'wss:' : 'ws:';
      setCustomSignallingUrl(`${proto}//live.xclusive.ao:3333/live/${pureKey}?direction=send`);
    } catch (e: any) {
      addLog(`❌ Erro no POST /api/live/start: ${e.message}`, 'error');
    } finally {
      setLoadingBackend(false);
    }
  };

  /**
   * Passo 2: Pedir acesso à câmara/microfone para preview
   */
  const handleRequestMedia = async () => {
    addLog('A solicitar permissões de câmara e microfone...', 'info');
    try {
      await publisher.requestMedia();
      addLog('✅ Acesso à câmara e microfone concedido. Preview pronta.', 'success');
    } catch (e: any) {
      addLog(`❌ Falha ao obter media: ${e.message}`, 'error');
    }
  };

  /**
   * Passo 3: Iniciar transmissão WebRTC
   */
  const handleStartPublishing = async () => {
    const keyToUse = sanitizeStreamKey(streamKey);
    let cleanCustomUrl = customSignallingUrl.trim();
    if (cleanCustomUrl) {
      try { cleanCustomUrl = decodeURIComponent(cleanCustomUrl); } catch {}
      cleanCustomUrl = cleanCustomUrl
        .replace(/%7B/gi, '')
        .replace(/%7D/gi, '')
        .replace(/[{}]/g, '')
        .trim();
    }

    if (!keyToUse) {
      addLog('⚠️ Define ou obtém um streamKey antes de iniciar a transmissão.', 'warn');
      return;
    }

    addLog(`A iniciar transmissão WebRTC para streamKey: ${keyToUse} | URL: ${cleanCustomUrl || 'auto'}...`, 'info');
    try {
      await publisher.startPublishing(keyToUse, cleanCustomUrl || undefined);
    } catch (e: any) {
      addLog(`❌ Falha ao iniciar transmissão: ${e.message}`, 'error');
    }
  };

  /**
   * Passo 4: Terminar transmissão
   */
  const handleStopPublishing = async () => {
    addLog('A parar transmissão WebRTC...', 'info');
    try {
      await publisher.stopPublishing();
      addLog('Transmissão terminada.', 'info');
    } catch (e: any) {
      addLog(`Erro ao terminar: ${e.message}`, 'error');
    }
  };

  /**
   * Verificação externa: Consultar GET /api/live/active
   */
  const checkActiveStreams = async () => {
    setCheckingActive(true);
    try {
      const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
      const res = await fetch(`${base}/api/live/active`);
      const data = await res.json();
      setActiveLives(Array.isArray(data) ? data : []);
      addLog(`Lives ativas encontradas em /api/live/active: ${Array.isArray(data) ? data.length : 0}`, 'info');
    } catch (e: any) {
      addLog(`Erro ao consultar /api/live/active: ${e.message}`, 'error');
    } finally {
      setCheckingActive(false);
    }
  };

  // Helper de cor do status de conexão
  const getBadgeVariant = (state: LiveConnectionState) => {
    switch (state) {
      case 'live':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
      case 'connecting':
      case 'requesting-permission':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/40';
      case 'reconnecting':
        return 'bg-orange-500/20 text-orange-400 border-orange-500/40';
      case 'error':
        return 'bg-rose-500/20 text-rose-400 border-rose-500/40';
      case 'preview-ready':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/40';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="container mx-auto p-4 max-w-5xl space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Radio className="h-6 w-6 text-primary" />
            Teste de Transmissão WebRTC (Fase 4)
          </h1>
          <p className="text-sm text-muted-foreground">
            Ambiente de validação técnica do hook <code>useLivePublisher</code> e OvenLiveKit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={getBadgeVariant(publisher.connectionState)}>
            {publisher.connectionState === 'live' && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse mr-1.5" />
            )}
            {publisher.connectionState.toUpperCase()}
          </Badge>
        </div>
      </div>

      {/* Autenticação & Estado de Sessão */}
      <Card className="bg-card/50">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <span>Sessão Atual</span>
            {isAuthenticated ? (
              <span className="text-xs text-emerald-400 font-normal">
                Autenticado como: <strong>{user?.nomeExibicao || user?.username}</strong> ({user?.tipoConta})
              </span>
            ) : (
              <span className="text-xs text-rose-400 font-normal flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Não autenticado — faça login primeiro para testar o endpoint /start
              </span>
            )}
          </CardTitle>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Painel Esquerdo: Vídeo de Preview e Ações */}
        <div className="lg:col-span-7 space-y-4">
          <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-border shadow-inner flex items-center justify-center">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />

            {!publisher.mediaStream && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground p-4 text-center">
                <VideoOff className="h-12 w-12 mb-2 opacity-50" />
                <p className="text-sm">Nenhum stream de vídeo ativo.</p>
                <p className="text-xs opacity-75">Clica em "Pedir Permissão de Câmara" abaixo para iniciar a preview.</p>
              </div>
            )}

            {/* Overlays no vídeo */}
            <div className="absolute top-3 left-3 flex items-center gap-2">
              <Badge className={getBadgeVariant(publisher.connectionState)}>
                {publisher.connectionState === 'live' ? 'AO VIVO' : publisher.connectionState}
              </Badge>
              {streamId && (
                <Badge variant="outline" className="bg-black/60 backdrop-blur-sm text-xs">
                  Live #{streamId}
                </Badge>
              )}
            </div>

            {/* Microfone / Câmara Mute indicators */}
            <div className="absolute top-3 right-3 flex items-center gap-2">
              {!publisher.isAudioEnabled && (
                <Badge variant="destructive" className="text-xs flex items-center gap-1">
                  <MicOff className="h-3 w-3" /> Muted
                </Badge>
              )}
              {!publisher.isVideoEnabled && (
                <Badge variant="destructive" className="text-xs flex items-center gap-1">
                  <VideoOff className="h-3 w-3" /> Vídeo off
                </Badge>
              )}
            </div>
          </div>

          {/* Controles de Mídia */}
          <div className="flex flex-wrap items-center justify-center gap-2 bg-muted/40 p-2.5 rounded-lg border border-border">
            <Button
              variant={publisher.isAudioEnabled ? 'outline' : 'destructive'}
              size="sm"
              onClick={() => publisher.toggleMicrophone()}
              disabled={!publisher.mediaStream}
            >
              {publisher.isAudioEnabled ? <Mic className="h-4 w-4 mr-1.5" /> : <MicOff className="h-4 w-4 mr-1.5" />}
              {publisher.isAudioEnabled ? 'Mutar Mic' : 'Desmutar Mic'}
            </Button>

            <Button
              variant={publisher.isVideoEnabled ? 'outline' : 'destructive'}
              size="sm"
              onClick={() => publisher.toggleCamera()}
              disabled={!publisher.mediaStream}
            >
              {publisher.isVideoEnabled ? <Video className="h-4 w-4 mr-1.5" /> : <VideoOff className="h-4 w-4 mr-1.5" />}
              {publisher.isVideoEnabled ? 'Desligar Câmara' : 'Ligar Câmara'}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => publisher.switchCamera()}
              disabled={!publisher.mediaStream}
            >
              <SwitchCamera className="h-4 w-4 mr-1.5" />
              Alternar Câmara ({publisher.facingMode})
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="text-rose-400 hover:text-rose-300 hover:bg-rose-950/30"
              onClick={() => publisher.cleanup()}
              disabled={!publisher.mediaStream && publisher.connectionState === 'idle'}
            >
              Limpar / Desligar Tudo
            </Button>
          </div>
        </div>

        {/* Painel Direito: Configuração, Backend e Controles */}
        <div className="lg:col-span-5 space-y-4">
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm font-semibold">Passo 1: Obter Live no Backend</CardTitle>
              <CardDescription className="text-xs">
                Chama <code>POST /api/live/start</code> para criar ou recuperar live em estado <code>agendado</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              <div className="flex gap-2">
                <Button
                  className="w-full"
                  variant="secondary"
                  size="sm"
                  onClick={handleStartOnBackend}
                  disabled={loadingBackend}
                >
                  {loadingBackend ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  {loadingBackend ? 'A chamar...' : 'Obter / Iniciar via POST /api/live/start'}
                </Button>
              </div>

              {streamKey && (
                <div className="p-2.5 rounded bg-muted/60 text-xs space-y-1 font-mono break-all">
                  <div className="flex justify-between text-muted-foreground">
                    <span>ID: <strong>{streamId}</strong></span>
                    <span>Status na BD: <strong className="text-amber-400">{backendStatus}</strong></span>
                  </div>
                  <div className="pt-1">
                    <span className="text-muted-foreground">StreamKey:</span> {streamKey}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm font-semibold">Passo 2: Transmissão WebRTC</CardTitle>
              <CardDescription className="text-xs">
                Signalling URL e comando para iniciar ingest.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">StreamKey manual (ou use o do passo 1):</label>
                <Input
                  value={streamKey}
                  onChange={(e) => setStreamKey(sanitizeStreamKey(e.target.value))}
                  placeholder="UUID da live (ex: e9c73b57-cbae-4d0b-9c59-4807a9e65e2e)"
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">URL de Sinalização WebRTC:</label>
                <Input
                  value={customSignallingUrl}
                  onChange={(e) => {
                    let val = e.target.value;
                    try { val = decodeURIComponent(val); } catch {}
                    setCustomSignallingUrl(
                      val.replace(/%7B/gi, '').replace(/%7D/gi, '').replace(/[{}]/g, '')
                    );
                  }}
                  placeholder="ws://live.xclusive.ao:3333/live/UUID_DA_LIVE?direction=send"
                  className="font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                {!publisher.mediaStream ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="col-span-2"
                    onClick={handleRequestMedia}
                  >
                    <Video className="h-4 w-4 mr-1.5 text-primary" />
                    1. Pedir Permissão / Preview
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="col-span-2 text-emerald-400 border-emerald-500/40 bg-emerald-500/10"
                    disabled
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1.5" />
                    Preview Pronta
                  </Button>
                )}

                <Button
                  variant="default"
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                  onClick={handleStartPublishing}
                  disabled={
                    !streamKey ||
                    publisher.connectionState === 'connecting' ||
                    publisher.connectionState === 'live'
                  }
                >
                  <Radio className="h-4 w-4 mr-1.5" />
                  Transmitir WebRTC
                </Button>

                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleStopPublishing}
                  disabled={publisher.connectionState !== 'live' && publisher.connectionState !== 'connecting'}
                >
                  <Square className="h-4 w-4 mr-1.5" />
                  Parar Live
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Verificação em GET /api/live/active */}
          <Card>
            <CardHeader className="py-2.5 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-semibold">Validação: GET /api/live/active</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={checkActiveStreams}
                  disabled={checkingActive}
                >
                  <RefreshCw className={`h-3 w-3 mr-1 ${checkingActive ? 'animate-spin' : ''}`} />
                  Verificar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {activeLives === null ? (
                <p className="text-xs text-muted-foreground">Clica em "Verificar" para consultar as lives visíveis aos espectadores.</p>
              ) : activeLives.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma live com status <code>ao_vivo</code> no momento.</p>
              ) : (
                <div className="space-y-1.5">
                  {activeLives.map((st) => (
                    <div key={st.id} className="text-xs p-2 rounded bg-emerald-500/10 border border-emerald-500/20 flex justify-between items-center">
                      <span>Live #{st.id} ({st.criador?.nomeExibicao || st.criador?.username})</span>
                      <Badge variant="outline" className="text-[10px] text-emerald-400">AO VIVO</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Logs do Evento */}
      <Card className="bg-black/40 border-border">
        <CardHeader className="py-2.5 px-4 flex flex-row items-center justify-between">
          <CardTitle className="text-xs font-mono text-muted-foreground">Logs de Sinalização e Transmissão</CardTitle>
          <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={() => setLogs([])}>
            Limpar
          </Button>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <div className="h-44 overflow-y-auto font-mono text-xs space-y-1 rounded bg-black/60 p-2 border border-border/50">
            {logs.length === 0 ? (
              <span className="text-muted-foreground text-[11px]">Nenhum log registado ainda...</span>
            ) : (
              logs.map((lg, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-muted-foreground opacity-60">[{lg.time}]</span>
                  <span
                    className={
                      lg.type === 'success'
                        ? 'text-emerald-400'
                        : lg.type === 'error'
                        ? 'text-rose-400 font-semibold'
                        : lg.type === 'warn'
                        ? 'text-amber-400'
                        : 'text-zinc-300'
                    }
                  >
                    {lg.msg}
                  </span>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
