import { useEffect, useRef, useState, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';

// ─── Tipos dos eventos recebidos pelo cliente ──────────────────────────────────

export interface TipEvent {
  streamId: number;
  username: string;
  valor: number;
  mensagem: string | null;
  enviadoEm: string;
}

export interface ViewersUpdateEvent {
  streamId: number;
  count: number;
}

export interface StreamEndedEvent {
  streamId: number;
}

export interface ChatMessageEvent {
  id: string;
  streamId: number;
  userId: number;
  username: string;
  avatarUrl: string | null;
  mensagem: string;
  criadoEm: string;
}

export interface ChatJoinedEvent {
  streamId: number;
  username: string;
  criadoEm: string;
}

export interface ChatErrorEvent {
  message: string;
}

export type LiveFeedItem =
  | {
      type: 'chat';
      id: string;
      streamId: number;
      userId: number;
      username: string;
      avatarUrl: string | null;
      mensagem: string;
      criadoEm: string;
    }
  | {
      type: 'joined';
      id: string;
      streamId: number;
      username: string;
      criadoEm: string;
    }
  | {
      type: 'tip';
      id: string;
      streamId: number;
      username: string;
      valor: number;
      mensagem: string | null;
      enviadoEm: string;
    };

// ─── Hook ──────────────────────────────────────────────────────────────────────

interface UseSocketOptions {
  /** Número de gorjetas recentes a manter no feed de gorjetas isolado (FIFO) */
  maxTips?: number;
  /** Número máximo de itens no feed unificado em memória (FIFO) */
  maxFeedItems?: number;
  /** Callback opcional para quando o servidor emite "chat:error" */
  onChatError?: (error: ChatErrorEvent) => void;
}

interface UseSocketReturn {
  viewers: number;
  recentTips: TipEvent[];
  feed: LiveFeedItem[];
  messages: LiveFeedItem[];
  streamEnded: boolean;
  isConnected: boolean;
  sendMessage: (arg1?: number | string, arg2?: string) => boolean;
  chatError: string | null;
}

/**
 * Hook que gere a conexão Socket.io para uma sala de live stream.
 *
 * - Emite `viewer:join` ao montar (quando streamId e token estão disponíveis)
 * - Emite `viewer:leave` ao desmontar
 * - Subscreve `viewers:update`, `tip:sent`, `stream:ended`, `chat:message`, `chat:joined`, `chat:error`
 * - Expõe `sendMessage` para emitir `chat:send`
 *
 * @param streamId  ID numérico do stream (null desliga o socket)
 * @param options   Opções adicionais
 */
export function useSocket(
  streamId: number | null,
  options: UseSocketOptions = {},
): UseSocketReturn {
  const { maxTips = 20, maxFeedItems = 200, onChatError } = options;

  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [recentTips, setRecentTips] = useState<TipEvent[]>([]);
  const [feed, setFeed] = useState<LiveFeedItem[]>([]);
  const [streamEnded, setStreamEnded] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const addTip = useCallback(
    (tip: TipEvent) => {
      setRecentTips((prev) => {
        const next = [tip, ...prev];
        return next.slice(0, maxTips);
      });
    },
    [maxTips],
  );

  const addFeedItem = useCallback(
    (item: LiveFeedItem) => {
      setFeed((prev) => {
        const next = [...prev, item];
        return next.slice(-maxFeedItems);
      });
    },
    [maxFeedItems],
  );

  useEffect(() => {
    if (streamId === null) {
      setFeed([]);
      setRecentTips([]);
      setViewers(0);
      setStreamEnded(false);
      setChatError(null);
      return;
    }

    const token = localStorage.getItem('xclusive_token');
    if (!token) return; // Utilizador não autenticado — não conectar

    // Criar socket (usando o proxy do Vite em dev, ou o servidor em produção)
    const socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { token },
      // Reconectar automaticamente até 5 vezes antes de desistir
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    // ── Eventos de ciclo de vida ─────────────────────────────────────────────
    socket.on('connect', () => {
      setIsConnected(true);
      // Entrar na sala do stream logo após conectar
      socket.emit('viewer:join', streamId);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] Erro de conexão:', err.message);
      setIsConnected(false);
    });

    // ── Eventos de negócio ───────────────────────────────────────────────────
    socket.on('viewers:update', (data: ViewersUpdateEvent) => {
      if (data.streamId === streamId) {
        setViewers(data.count);
      }
    });

    socket.on('tip:sent', (data: TipEvent) => {
      if (data.streamId === streamId) {
        addTip(data);
        addFeedItem({
          type: 'tip',
          id: `tip-${data.username}-${data.enviadoEm || Date.now()}-${Math.random()}`,
          streamId: data.streamId,
          username: data.username,
          valor: data.valor,
          mensagem: data.mensagem,
          enviadoEm: data.enviadoEm || new Date().toISOString(),
        });
      }
    });

    socket.on('chat:message', (data: ChatMessageEvent) => {
      if (data.streamId === streamId) {
        addFeedItem({
          type: 'chat',
          id: data.id || `chat-${Date.now()}-${Math.random()}`,
          streamId: data.streamId,
          userId: data.userId,
          username: data.username,
          avatarUrl: data.avatarUrl ?? null,
          mensagem: data.mensagem,
          criadoEm: data.criadoEm || new Date().toISOString(),
        });
      }
    });

    socket.on('chat:joined', (data: ChatJoinedEvent) => {
      if (data.streamId === streamId) {
        addFeedItem({
          type: 'joined',
          id: `joined-${data.username}-${Date.now()}-${Math.random()}`,
          streamId: data.streamId,
          username: data.username,
          criadoEm: data.criadoEm || new Date().toISOString(),
        });
      }
    });

    socket.on('chat:error', (data: ChatErrorEvent) => {
      const msg = data?.message || 'Erro no chat.';
      setChatError(msg);
      if (onChatError) {
        onChatError(data);
      } else {
        toast.error(msg);
      }
    });

    socket.on('stream:ended', (data: StreamEndedEvent) => {
      if (data.streamId === streamId) {
        setStreamEnded(true);
      }
    });

    // ── Limpeza ──────────────────────────────────────────────────────────────
    return () => {
      socket.emit('viewer:leave', streamId);
      socket.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    };
  }, [streamId, addTip, addFeedItem, onChatError]);

  const sendMessage = useCallback(
    (arg1?: number | string, arg2?: string): boolean => {
      let targetStreamId = streamId;
      let text = '';

      if (typeof arg1 === 'number') {
        targetStreamId = arg1;
        text = typeof arg2 === 'string' ? arg2 : '';
      } else if (typeof arg1 === 'string') {
        text = arg1;
      }

      const trimmed = text.trim();
      if (!targetStreamId || !trimmed) {
        return false;
      }

      if (!socketRef.current?.connected) {
        toast.error('Não estás ligado ao chat da transmissão.');
        return false;
      }

      socketRef.current.emit('chat:send', {
        streamId: targetStreamId,
        mensagem: trimmed,
      });
      return true;
    },
    [streamId],
  );

  return {
    viewers,
    recentTips,
    feed,
    messages: feed,
    streamEnded,
    isConnected,
    sendMessage,
    chatError,
  };
}

