import type { Server as HttpServer } from "node:http";
import crypto from "node:crypto";
import { Server as SocketServer, type Socket } from "socket.io";
import { verifyToken } from "./auth";
import { db, liveStreamsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { userHasLiveAccess } from "./liveAccess";

// ─── Tipos ────────────────────────────────────────────────────────────────────

declare module "socket.io" {
  interface SocketData {
    userId: number;
    username: string;
    avatarUrl: string | null;
    /** streamId da sala em que o socket está actualmente */
    currentStreamId: number | null;
    /** Sala a que o socket está a tentar entrar (evita contar dois joins simultâneos) */
    joiningStreamId?: number | null;
    /** Timestamps das mensagens recentes para rate-limiting em memória */
    recentMessageTimestamps?: number[];
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let io: SocketServer | null = null;
/** Reposição do contador no arranque; as escritas do contador esperam por ela (nunca rejeita). */
let startupReset: Promise<void> = Promise.resolve();

export function getIO(): SocketServer {
  if (!io) throw new Error("Socket.io não foi inicializado. Chama initSocket() primeiro.");
  return io;
}

// ─── Inicialização ────────────────────────────────────────────────────────────

export function initSocket(httpServer: HttpServer): SocketServer {
  if (io) return io;

  io = new SocketServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (process.env.NODE_ENV === "development") {
          if (
            origin.includes("localhost") ||
            origin.includes("127.0.0.1") ||
            origin.includes(".replit.dev") ||
            origin.includes(".repl.co")
          ) {
            return callback(null, true);
          }
        }
        const allowed = process.env.ALLOWED_ORIGINS
          ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
          : [];
        if (allowed.includes(origin)) return callback(null, true);
        callback(new Error(`Socket.io CORS: origem não permitida — ${origin}`));
      },
      credentials: true,
    },
    // Path padrão /socket.io — mantemos para compatibilidade com o proxy do Vite
    path: "/socket.io",
    // Desligar long-polling para forçar WebSocket puro e evitar problemas com proxies
    transports: ["websocket", "polling"],
  });

  // ── Middleware de autenticação ───────────────────────────────────────────────
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error("Não autenticado: token em falta."));
    }

    try {
      const payload = verifyToken(token);
      if (payload.type === "refresh") {
        return next(new Error("Não autenticado: token inválido."));
      }

      // Verificar se a conta existe e está activa (sem verificar revogação —
      // aceitável para WebSocket de curta duração; revogação é verificada na REST API)
      const [user] = await db
        .select({
          ativo: usersTable.ativo,
          username: usersTable.username,
          avatarUrl: usersTable.avatarUrl,
        })
        .from(usersTable)
        .where(eq(usersTable.id, payload.userId))
        .limit(1);

      if (!user || !user.ativo) {
        return next(new Error("Conta suspensa ou não encontrada."));
      }

      socket.data.userId = payload.userId;
      socket.data.username = user.username;
      socket.data.avatarUrl = user.avatarUrl ?? null;
      socket.data.currentStreamId = null;
      socket.data.recentMessageTimestamps = [];
      next();
    } catch {
      next(new Error("Não autenticado: token inválido."));
    }
  });

  // ── Handlers de eventos ─────────────────────────────────────────────────────
  io.on("connection", (socket: Socket) => {
    logger.debug({ userId: socket.data.userId, username: socket.data.username }, "Socket conectado");

    // ── viewer:join ────────────────────────────────────────────────────────────
    socket.on("viewer:join", async (streamId: number) => {
      if (!streamId || typeof streamId !== "number") return;

      // Join duplicado (já na sala, ou a entrar): não conta outra vez.
      if (socket.data.currentStreamId === streamId || socket.data.joiningStreamId === streamId) return;
      socket.data.joiningStreamId = streamId;

      // Sair de qualquer sala anterior antes de entrar numa nova
      if (socket.data.currentStreamId !== null) {
        await handleLeave(socket, socket.data.currentStreamId);
      }

      try {
        // Verificar se a live existe e está activa
        const [stream] = await db
          .select({
            id: liveStreamsTable.id,
            status: liveStreamsTable.status,
            criadorId: liveStreamsTable.criadorId,
            tipo: liveStreamsTable.tipo,
          })
          .from(liveStreamsTable)
          .where(eq(liveStreamsTable.id, streamId))
          .limit(1);

        if (!stream || stream.status !== "ao_vivo") {
          socket.emit("error", { message: "Live não encontrada ou já terminada." });
          return;
        }

        // Mesma regra de acesso do /playback: sem acesso não entra na sala nem conta.
        if (!(await userHasLiveAccess(socket.data.userId, stream))) {
          socket.emit("error", { message: "Precisas de bilhete para entrar nesta live.", code: "ACCESS_DENIED" });
          return;
        }

        await socket.join(`live:${streamId}`);
        socket.data.currentStreamId = streamId;

        // Emitir contagem actualizada (derivada das ligações reais da sala) para todos na sala
        await emitViewerCount(streamId);

        // Notificar os outros espectadores na sala que este utilizador entrou
        if (socket.data.username) {
          socket.to(`live:${streamId}`).emit("chat:joined", {
            streamId,
            username: socket.data.username,
            criadoEm: new Date().toISOString(),
          });
        }

        logger.debug({ userId: socket.data.userId, streamId }, "viewer:join");
      } catch (err) {
        logger.error({ err, streamId }, "Erro ao processar viewer:join");
      } finally {
        socket.data.joiningStreamId = null;
      }
    });

    // ── chat:send ──────────────────────────────────────────────────────────────
    socket.on("chat:send", async (data: { streamId: number; mensagem: string }) => {
      try {
        if (!data || typeof data !== "object") return;

        const streamId = Number(data.streamId);
        if (!streamId || isNaN(streamId)) {
          socket.emit("chat:error", { message: "ID de live inválido." });
          return;
        }

        // Só quem entrou na sala (viewer:join já verificou o acesso) pode escrever.
        if (socket.data.currentStreamId !== streamId) {
          socket.emit("chat:error", { message: "Não tens acesso ao chat desta live." });
          return;
        }

        const texto = typeof data.mensagem === "string" ? data.mensagem.trim() : "";
        if (!texto) {
          socket.emit("chat:error", { message: "A mensagem não pode estar vazia." });
          return;
        }

        if (texto.length > 300) {
          socket.emit("chat:error", {
            message: "A mensagem excede o limite máximo de 300 caracteres.",
          });
          return;
        }

        // Rate-limiting em memória por socket (máx. 5 mensagens em 5 segundos)
        const now = Date.now();
        const timestamps = (socket.data.recentMessageTimestamps || []).filter(
          (t: number) => now - t < 5000
        );
        if (timestamps.length >= 5) {
          socket.emit("chat:error", {
            message: "Estás a enviar mensagens demasiado depressa. Aguarda um momento.",
          });
          return;
        }
        timestamps.push(now);
        socket.data.recentMessageTimestamps = timestamps;

        // Verificar se a live existe e está ao vivo
        const [stream] = await db
          .select({ id: liveStreamsTable.id, status: liveStreamsTable.status })
          .from(liveStreamsTable)
          .where(eq(liveStreamsTable.id, streamId))
          .limit(1);

        if (!stream || stream.status !== "ao_vivo") {
          socket.emit("chat:error", { message: "Esta live não está ativa." });
          return;
        }

        // Emitir mensagem para toda a sala live:${streamId} (incluindo o próprio remetente)
        const chatMessage = {
          id: crypto.randomUUID(),
          streamId,
          userId: socket.data.userId,
          username: socket.data.username,
          avatarUrl: socket.data.avatarUrl ?? null,
          mensagem: texto,
          criadoEm: new Date().toISOString(),
        };

        io!.to(`live:${streamId}`).emit("chat:message", chatMessage);
        logger.debug(
          { userId: socket.data.userId, streamId, messageId: chatMessage.id },
          "chat:message emitido"
        );
      } catch (err) {
        logger.error({ err, data }, "Erro ao processar chat:send");
        socket.emit("chat:error", { message: "Erro interno ao processar a mensagem." });
      }
    });

    // ── viewer:leave ───────────────────────────────────────────────────────────
    socket.on("viewer:leave", async (streamId: number) => {
      if (!streamId || typeof streamId !== "number") return;
      await handleLeave(socket, streamId);
    });

    // ── disconnect ─────────────────────────────────────────────────────────────
    socket.on("disconnect", async () => {
      logger.debug({ userId: socket.data.userId }, "Socket desconectado");
      if (socket.data.currentStreamId !== null) {
        await handleLeave(socket, socket.data.currentStreamId);
      }
    });
  });

  // Depois de um reinício não há ninguém ligado: o valor guardado pelo processo anterior está desactualizado.
  // Os clientes reconectam, voltam a emitir viewer:join e o número converge para o real.
  startupReset = db
    .update(liveStreamsTable)
    .set({ totalVisualizadores: 0 })
    .where(eq(liveStreamsTable.status, "ao_vivo"))
    .then(
      () => undefined,
      (err) => {
        logger.error({ err }, "Erro ao repor o contador de espectadores no arranque");
      },
    );

  logger.info("Socket.io inicializado");
  return io;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function handleLeave(socket: Socket, streamId: number): Promise<void> {
  try {
    await socket.leave(`live:${streamId}`);
    socket.data.currentStreamId = null;

    await emitViewerCount(streamId);
    logger.debug({ userId: socket.data.userId, streamId }, "viewer:leave");
  } catch (err) {
    logger.error({ err, streamId }, "Erro ao processar viewer:leave");
  }
}

/**
 * Espectadores reais da sala: utilizadores únicos com pelo menos um socket ligado, sem a criadora.
 * Derivado do estado actual das ligações (nunca incrementado/decrementado por eventos), por isso
 * repetir ou perder um evento não o desvia e um reinício converge no primeiro join.
 */
function countRoomViewers(streamId: number, criadorId: number): number {
  if (!io) return 0;
  const room = io.sockets.adapter.rooms.get(`live:${streamId}`);
  const users = new Set<number>();
  if (room) {
    for (const sid of room) {
      const uid = io.sockets.sockets.get(sid)?.data.userId;
      if (uid !== undefined && uid !== criadorId) users.add(uid);
    }
  }
  return users.size;
}

/** Recalcula o número de espectadores a partir da sala, guarda-o na BD e emite-o para toda a sala */
async function emitViewerCount(streamId: number): Promise<void> {
  if (!io) return;
  await startupReset; // o reset do arranque nunca ultrapassa (nem apaga) uma contagem real
  const [stream] = await db
    .select({ criadorId: liveStreamsTable.criadorId })
    .from(liveStreamsTable)
    .where(eq(liveStreamsTable.id, streamId))
    .limit(1);
  if (!stream) return;

  const count = countRoomViewers(streamId, stream.criadorId);
  await db.update(liveStreamsTable).set({ totalVisualizadores: count }).where(eq(liveStreamsTable.id, streamId));

  io.to(`live:${streamId}`).emit("viewers:update", { streamId, count });
}
