import { useEffect, useRef, useState, useCallback } from 'react';
import { io, type Socket } from 'socket.io-client';

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

// ─── Hook ──────────────────────────────────────────────────────────────────────

interface UseSocketOptions {
  /** Número de gorjetas recentes a manter no feed (FIFO) */
  maxTips?: number;
}

interface UseSocketReturn {
  viewers: number;
  recentTips: TipEvent[];
  streamEnded: boolean;
  isConnected: boolean;
}

/**
 * Hook que gere a conexão Socket.io para uma sala de live stream.
 *
 * - Emite `viewer:join` ao montar (quando streamId e token estão disponíveis)
 * - Emite `viewer:leave` ao desmontar
 * - Subscreve `viewers:update`, `tip:sent`, `stream:ended`
 *
 * @param streamId  ID numérico do stream (null desliga o socket)
 * @param options   Opções adicionais
 */
export function useSocket(
  streamId: number | null,
  options: UseSocketOptions = {},
): UseSocketReturn {
  const { maxTips = 20 } = options;

  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [recentTips, setRecentTips] = useState<TipEvent[]>([]);
  const [streamEnded, setStreamEnded] = useState(false);

  const addTip = useCallback(
    (tip: TipEvent) => {
      setRecentTips((prev) => {
        const next = [tip, ...prev];
        return next.slice(0, maxTips);
      });
    },
    [maxTips],
  );

  useEffect(() => {
    if (streamId === null) return;

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
  }, [streamId, addTip]);

  return { viewers, recentTips, streamEnded, isConnected };
}
