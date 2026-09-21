import { useState, useRef, useEffect, useCallback } from 'react';
import OvenLiveKitPackage, {
  OvenLiveKitInstance,
  OvenLiveKitConnectionConfig,
} from 'ovenlivekit';

// Suporte para interoperabilidade CJS/ESM do Vite
const OvenLiveKit = (OvenLiveKitPackage as any)?.default || OvenLiveKitPackage;

export type LiveConnectionState =
  | 'idle'
  | 'requesting-permission'
  | 'preview-ready'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'error'
  | 'ended';

export interface UseLivePublisherOptions {
  /**
   * Base URL para WebSocket de sinalização WebRTC do OvenMediaEngine.
   * Exemplo: 'ws://live.xclusive.ao:3333/live' ou 'wss://live.xclusive.ao:3333/live'.
   * Se omitido, usa import.meta.env.VITE_OME_WEBRTC_URL ou auto-detecta conforme o protocolo da página.
   */
  defaultSignallingBaseUrl?: string;
  /**
   * Configuração WebRTC opcional (ICE servers, bitrate, etc.)
   */
  connectionConfig?: OvenLiveKitConnectionConfig;
}

export interface UseLivePublisherReturn {
  /** Estado atual da conexão / ciclo de vida */
  connectionState: LiveConnectionState;
  /** Stream de media local atual (câmara + áudio) */
  mediaStream: MediaStream | null;
  /** Mensagem de erro legível, quando aplicável */
  error: string | null;
  /** Se o microfone está ativo (não mutado) */
  isAudioEnabled: boolean;
  /** Se o vídeo da câmara está ativo (não desativado) */
  isVideoEnabled: boolean;
  /** Modo da câmara atual: 'user' (frontal) ou 'environment' (traseira) */
  facingMode: 'user' | 'environment';
  /** StreamKey atualmente a publicar (ou null) */
  currentStreamKey: string | null;

  /**
   * Solicita permissões de câmara e microfone e prepara a preview local
   */
  requestMedia: (customConstraints?: MediaStreamConstraints) => Promise<MediaStream>;
  /**
   * Inicia a transmissão WebRTC real para o streamKey especificado
   */
  startPublishing: (streamKey: string, customSignallingUrl?: string) => Promise<void>;
  /**
   * Termina a transmissão e desliga a publicação WebRTC
   */
  stopPublishing: () => Promise<void>;
  /**
   * Alterna entre câmara frontal ('user') e traseira ('environment')
   */
  switchCamera: () => Promise<void>;
  /**
   * Muta ou desmuta o microfone localmente (sem interromper a emissão)
   */
  toggleMicrophone: () => boolean;
  /**
   * Ativa ou desativa o vídeo localmente (sem interromper a emissão)
   */
  toggleCamera: () => boolean;
  /**
   * Anexa/desanexa um elemento HTMLVideoElement para preview
   */
  attachVideoElement: (videoElement: HTMLVideoElement | null) => void;
  /**
   * Liberta completamente todos os recursos (câmara, microfone e conexões)
   */
  cleanup: () => void;
}

/**
 * Sanitiza a streamKey garantindo formato puro de UUID:
 * - Descodifica percent-encoding (%7B, %7D, etc.)
 * - Remove quaisquer chavetas {} literais
 * - Remove colchetes [], parênteses (), aspas, barras e espaços em branco
 */
export function sanitizeStreamKey(key: string): string {
  if (!key) return '';
  let k = String(key).trim();
  try {
    k = decodeURIComponent(k);
  } catch {}
  try {
    k = decodeURIComponent(k);
  } catch {}
  return k
    .replace(/%7B/gi, '')
    .replace(/%7D/gi, '')
    .replace(/[{}[\]()"'`\\/]/g, '')
    .trim();
}

/**
 * Hook para encapsular a publicação de vídeo ao vivo via WebRTC usando OvenLiveKit.
 */
export function useLivePublisher(options: UseLivePublisherOptions = {}): UseLivePublisherReturn {
  const [connectionState, setConnectionState] = useState<LiveConnectionState>('idle');
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAudioEnabled, setIsAudioEnabled] = useState<boolean>(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState<boolean>(true);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [currentStreamKey, setCurrentStreamKey] = useState<string | null>(null);

  const kitRef = useRef<OvenLiveKitInstance | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const isStoppingRef = useRef<boolean>(false);

  // Determina o URL de sinalização garantindo o formato ws://host:porta/live/{streamKey}?direction=send
  const resolveSignallingUrl = useCallback(
    (streamKey: string, customUrl?: string): string => {
      const cleanKey = sanitizeStreamKey(streamKey);

      // Se foi fornecida uma URL customizada
      if (customUrl && customUrl.trim() !== '') {
        let url = customUrl.trim();

        // Descodificar caso a URL tenha sido colada com percent-encoding
        try {
          url = decodeURIComponent(url);
        } catch {}

        // Substituir qualquer placeholder literal {streamKey}, %7BstreamKey%7D, {chave}, etc.
        url = url
          .replace(/\{streamKey\}/gi, cleanKey)
          .replace(/%7BstreamKey%7D/gi, cleanKey)
          .replace(/\{chave_aqui\}/gi, cleanKey)
          .replace(/%7Bchave_aqui%7D/gi, cleanKey)
          .replace(/\{uuid[_-]?aqui\}/gi, cleanKey)
          .replace(/%7Buuid[_-]?aqui%7D/gi, cleanKey);

        // Remover quaisquer chavetas literais e %7B/%7D
        url = url
          .replace(/%7B/gi, '')
          .replace(/%7D/gi, '')
          .replace(/[{}]/g, '');

        // Se a streamKey limpa não está presente no caminho da URL
        if (cleanKey && !url.includes(cleanKey)) {
          const [basePart, queryPart] = url.split('?');
          const cleanBase = basePart.replace(/\/$/, '');
          const pathWithKey = cleanBase.endsWith('/live')
            ? `${cleanBase}/${cleanKey}`
            : `${cleanBase}/live/${cleanKey}`;
          url = queryPart ? `${pathWithKey}?${queryPart}` : pathWithKey;
        }

        // Garantir explicitamente ?direction=send
        if (url.includes('?')) {
          if (!url.includes('direction=send')) {
            url = `${url}&direction=send`;
          }
        } else {
          url = `${url}?direction=send`;
        }

        // Garantia final incontornável: remover quaisquer chavetas ou sequências %7B/%7D
        url = url
          .replace(/%7B/gi, '')
          .replace(/%7D/gi, '')
          .replace(/[{}]/g, '');

        return url;
      }

      const envUrl = import.meta.env.VITE_OME_WEBRTC_URL as string | undefined;
      const baseOption = options.defaultSignallingBaseUrl || envUrl;

      if (baseOption) {
        let cleanBase = baseOption.replace(/\/$/, '');
        try { cleanBase = decodeURIComponent(cleanBase); } catch {}
        cleanBase = cleanBase.replace(/%7B/gi, '').replace(/%7D/gi, '').replace(/[{}]/g, '');
        const pathWithKey = cleanBase.endsWith('/live')
          ? `${cleanBase}/${cleanKey}`
          : `${cleanBase}/live/${cleanKey}`;
        return `${pathWithKey}?direction=send`;
      }

      // Auto-deteção padrão para OvenMediaEngine:
      // Formato exacto validado no webrtc_test.html:
      // ws://live.xclusive.ao:3333/live/{streamKey}?direction=send
      const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
      const protocol = isHttps ? 'wss:' : 'ws:';
      const host = 'live.xclusive.ao:3333';
      return `${protocol}//${host}/live/${cleanKey}?direction=send`;
    },
    [options.defaultSignallingBaseUrl]
  );

  /**
   * Para todas as tracks de um MediaStream para desligar o indicador de câmara/microfone
   */
  const stopMediaStreamTracks = useCallback((stream: MediaStream | null) => {
    if (!stream) return;
    try {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignora erro ao parar track individual
        }
      });
    } catch (e) {
      console.warn('[useLivePublisher] Erro ao parar tracks:', e);
    }
  }, []);

  /**
   * Conecta um MediaStream ao elemento de vídeo de preview
   */
  const bindStreamToVideoElement = useCallback((stream: MediaStream | null) => {
    const videoEl = videoElementRef.current;
    if (!videoEl) return;

    if (stream) {
      videoEl.srcObject = stream;
      videoEl.playsInline = true;
      videoEl.muted = true; // Sempre muted localmente para evitar feedback/eco acústico
      videoEl.play().catch((err) => {
        console.warn('[useLivePublisher] Autoplay preview bloqueado:', err);
      });
    } else {
      videoEl.srcObject = null;
    }
  }, []);

  /**
   * Solicita permissão de câmara e microfone
   */
  const requestMedia = useCallback(
    async (customConstraints?: MediaStreamConstraints): Promise<MediaStream> => {
      setError(null);
      setConnectionState('requesting-permission');

      // Limpa tracks anteriores se existirem
      if (streamRef.current) {
        stopMediaStreamTracks(streamRef.current);
        streamRef.current = null;
        setMediaStream(null);
      }

      const constraints: MediaStreamConstraints = customConstraints || {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      };

      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        setMediaStream(stream);

        // Atualiza estados de mute baseados nas tracks obtidas
        const audioTrack = stream.getAudioTracks()[0];
        const videoTrack = stream.getVideoTracks()[0];
        setIsAudioEnabled(audioTrack ? audioTrack.enabled : false);
        setIsVideoEnabled(videoTrack ? videoTrack.enabled : false);

        bindStreamToVideoElement(stream);
        setConnectionState('preview-ready');
        return stream;
      } catch (err: any) {
        let msg = 'Não foi possível aceder à câmara e ao microfone.';
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
          msg = 'Permissão de acesso à câmara ou microfone foi recusada.';
        } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
          msg = 'Nenhuma câmara ou microfone compatível foi encontrado.';
        } else if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
          msg = 'A câmara ou microfone já está a ser usada por outra aplicação.';
        } else if (err?.message) {
          msg = err.message;
        }

        setError(msg);
        setConnectionState('error');
        throw new Error(msg);
      }
    },
    [facingMode, bindStreamToVideoElement, stopMediaStreamTracks]
  );

  /**
   * Inicia a transmissão WebRTC para o servidor OME
   */
  const startPublishing = useCallback(
    async (streamKey: string, customSignallingUrl?: string): Promise<void> => {
      const pureKey = sanitizeStreamKey(streamKey);
      if (!pureKey) {
        const err = 'Chave de transmissão (streamKey) inválida.';
        setError(err);
        setConnectionState('error');
        throw new Error(err);
      }

      setError(null);
      setConnectionState('connecting');
      setCurrentStreamKey(pureKey);
      isStoppingRef.current = false;

      // Se não temos stream de preview ainda, solicita os media
      let stream = streamRef.current;
      if (!stream || stream.getTracks().length === 0 || stream.getTracks().every((t) => t.readyState === 'ended')) {
        try {
          stream = await requestMedia();
        } catch (e) {
          return;
        }
      }

      // Limpa qualquer instância anterior do kit
      if (kitRef.current) {
        try {
          kitRef.current.remove();
        } catch {
          // Ignora erro no teardown
        }
        kitRef.current = null;
      }

      const wsUrl = resolveSignallingUrl(pureKey, customSignallingUrl);
      console.info('[useLivePublisher] A conectar ao OvenMediaEngine:', wsUrl);

      // Cria a nova instância do OvenLiveKit com os callbacks do ciclo de vida
      const kitInstance = OvenLiveKit.create({
        callbacks: {
          connected: () => {
            console.info('[useLivePublisher] ✅ Transmissão WebRTC conectada com sucesso ao OME!');
            setConnectionState('live');
            setError(null);
          },
          iceStateChange: (state: string) => {
            console.info('[useLivePublisher] Estado ICE:', state);
            if (state === 'connected' || state === 'completed') {
              setConnectionState('live');
            } else if (state === 'disconnected') {
              setConnectionState('reconnecting');
            } else if (state === 'failed') {
              setError('A ligação de rede da transmissão falhou (ICE failed).');
              setConnectionState('error');
            } else if (state === 'closed') {
              if (!isStoppingRef.current) {
                setConnectionState('ended');
              }
            }
          },
          connectionClosed: (type: string, details: any) => {
            console.info('[useLivePublisher] Conexão fechada:', type, details);
            if (type === 'user' || isStoppingRef.current) {
              setConnectionState('ended');
            } else {
              setConnectionState('ended');
            }
          },
          error: (err: any) => {
            console.error('[useLivePublisher] Erro OvenLiveKit:', err);
            const msg =
              typeof err === 'string'
                ? err
                : err?.error || err?.message || 'Erro durante a transmissão WebRTC.';
            setError(msg);
            setConnectionState('error');
          },
        },
      });

      kitRef.current = kitInstance;

      // Anexa o stream de media existente à instância do OvenLiveKit
      try {
        // Se tivermos um elemento de vídeo associado, anexa antes ao kit
        if (videoElementRef.current) {
          kitInstance.attachMedia(videoElementRef.current);
        }

        // Anexa o stream de media existente à instância do OvenLiveKit
        await kitInstance.setMediaStream(stream);

        // Inicia a negociação SDP via WebSocket
        kitInstance.startStreaming(wsUrl, options.connectionConfig);
      } catch (err: any) {
        const msg = err?.message || 'Falha ao iniciar streaming no OvenLiveKit.';
        setError(msg);
        setConnectionState('error');
        throw new Error(msg);
      }
    },
    [requestMedia, resolveSignallingUrl, options.connectionConfig]
  );

  /**
   * Termina a publicação WebRTC
   */
  const stopPublishing = useCallback(async (): Promise<void> => {
    isStoppingRef.current = true;
    try {
      if (kitRef.current) {
        await kitRef.current.stopStreaming();
        kitRef.current.remove();
        kitRef.current = null;
      }
    } catch (err) {
      console.warn('[useLivePublisher] Erro ao parar streaming:', err);
    } finally {
      setConnectionState('ended');
      setCurrentStreamKey(null);
    }
  }, []);

  /**
   * Alterna câmara frontal/traseira
   */
  const switchCamera = useCallback(async (): Promise<void> => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';

    try {
      // Pede nova track de vídeo com o novo facingMode
      const newVideoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: nextMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      const newVideoTrack = newVideoStream.getVideoTracks()[0];
      if (!newVideoTrack) {
        throw new Error('Nenhuma track de vídeo obtida na nova câmara.');
      }

      const currentStream = streamRef.current;
      if (currentStream) {
        // Remove e para a track de vídeo antiga
        const oldVideoTracks = currentStream.getVideoTracks();
        oldVideoTracks.forEach((track) => {
          track.stop();
          currentStream.removeTrack(track);
        });

        // Adiciona a nova track ao MediaStream atual
        currentStream.addTrack(newVideoTrack);

        // Se estiver a transmitir ativamente no WebRTC, substitui a track no sender
        const peerConnection = kitRef.current?.peerConnection;
        if (peerConnection) {
          const senders = peerConnection.getSenders();
          const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
          if (videoSender) {
            await videoSender.replaceTrack(newVideoTrack);
          }
        }

        // Reanexa a preview local
        bindStreamToVideoElement(currentStream);
        setMediaStream(currentStream);
      }

      setFacingMode(nextMode);
      setIsVideoEnabled(true);
    } catch (err: any) {
      console.error('[useLivePublisher] Erro ao alternar câmara:', err);
      setError(err?.message || 'Não foi possível alternar de câmara.');
    }
  }, [facingMode, bindStreamToVideoElement]);

  /**
   * Muta/desmuta o microfone localmente
   */
  const toggleMicrophone = useCallback((): boolean => {
    const stream = streamRef.current;
    if (!stream) return false;

    let nextState = false;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !track.enabled;
      nextState = track.enabled;
    });

    setIsAudioEnabled(nextState);
    return nextState;
  }, []);

  /**
   * Ativa/desativa o vídeo localmente
   */
  const toggleCamera = useCallback((): boolean => {
    const stream = streamRef.current;
    if (!stream) return false;

    let nextState = false;
    stream.getVideoTracks().forEach((track) => {
      track.enabled = !track.enabled;
      nextState = track.enabled;
    });

    setIsVideoEnabled(nextState);
    return nextState;
  }, []);

  /**
   * Anexa um elemento de vídeo para preview
   */
  const attachVideoElement = useCallback(
    (videoEl: HTMLVideoElement | null) => {
      videoElementRef.current = videoEl;
      if (videoEl && streamRef.current) {
        bindStreamToVideoElement(streamRef.current);
      }
    },
    [bindStreamToVideoElement]
  );

  /**
   * Liberta completamente todos os recursos (câmara, microfone e instância OME)
   */
  const cleanup = useCallback(() => {
    isStoppingRef.current = true;

    if (kitRef.current) {
      try {
        kitRef.current.remove();
      } catch (e) {
        console.warn('[useLivePublisher] Erro ao desmontar kit:', e);
      }
      kitRef.current = null;
    }

    if (streamRef.current) {
      stopMediaStreamTracks(streamRef.current);
      streamRef.current = null;
      setMediaStream(null);
    }

    if (videoElementRef.current) {
      videoElementRef.current.srcObject = null;
    }

    setConnectionState('idle');
    setCurrentStreamKey(null);
    setError(null);
  }, [stopMediaStreamTracks]);

  // Limpeza automática ao desmontar o componente que usa o hook
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    connectionState,
    mediaStream,
    error,
    isAudioEnabled,
    isVideoEnabled,
    facingMode,
    currentStreamKey,
    requestMedia,
    startPublishing,
    stopPublishing,
    switchCamera,
    toggleMicrophone,
    toggleCamera,
    attachVideoElement,
    cleanup,
  };
}

export default useLivePublisher;
