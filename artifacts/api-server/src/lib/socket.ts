import type { Server as HttpServer } from "node:http";
import crypto from "node:crypto";
import { Server as SocketServer, type Socket } from "socket.io";
import { verifyToken } from "./auth";
import { db, liveStreamsTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";

// ─── Tipos ────────────────────────────────────────────────────────────────────

declare module "socket.io" {
  interface SocketData {
    userId: number;
    username: string;
    avatarUrl: string | null;
    /** streamId da sala em que o socket está actualmente */
    currentStreamId: number | null;
    /** Timestamps das mensagens recentes para rate-limiting em memória */
    recentMessageTimestamps?: number[];
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let io: SocketServer | null = null;

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

      const isNewRoom = socket.data.currentStreamId !== streamId;

      // Sair de qualquer sala anterior antes de entrar numa nova
      if (socket.data.currentStreamId !== null && isNewRoom) {
        await handleLeave(socket, socket.data.currentStreamId);
      }

      try {
        // Verificar se a live existe e está activa
        const [stream] = await db
          .select({ id: liveStreamsTable.id, status: liveStreamsTable.status })
          .from(liveStreamsTable)
          .where(eq(liveStreamsTable.id, streamId))
          .limit(1);

        if (!stream || stream.status !== "ao_vivo") {
          socket.emit("error", { message: "Live não encontrada ou já terminada." });
          return;
        }

        await socket.join(`live:${streamId}`);
        socket.data.currentStreamId = streamId;

        // Incrementar contador de visualizadores na BD
        await db
          .update(liveStreamsTable)
          .set({ totalVisualizadores: sql`${liveStreamsTable.totalVisualizadores} + 1` })
          .where(eq(liveStreamsTable.id, streamId));

        // Emitir contagem actualizada para todos na sala
        await emitViewerCount(streamId);

        // Notificar os outros espectadores na sala que este utilizador entrou
        if (isNewRoom && socket.data.username) {
          socket.to(`live:${streamId}`).emit("chat:joined", {
            streamId,
            username: socket.data.username,
            criadoEm: new Date().toISOString(),
          });
        }

        logger.debug({ userId: socket.data.userId, streamId }, "viewer:join");
      } catch (err) {
        logger.error({ err, streamId }, "Erro ao processar viewer:join");
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

  logger.info("Socket.io inicializado");
  return io;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function handleLeave(socket: Socket, streamId: number): Promise<void> {
  try {
    await socket.leave(`live:${streamId}`);
    socket.data.currentStreamId = null;

    // Decrementar, mas nunca ficar negativo
    await db
      .update(liveStreamsTable)
      .set({
        totalVisualizadores: sql`GREATEST(${liveStreamsTable.totalVisualizadores} - 1, 0)`,
      })
      .where(eq(liveStreamsTable.id, streamId));

    await emitViewerCount(streamId);
    logger.debug({ userId: socket.data.userId, streamId }, "viewer:leave");
  } catch (err) {
    logger.error({ err, streamId }, "Erro ao processar viewer:leave");
  }
}

/** Lê o totalVisualizadores actualizado e emite para toda a sala */
async function emitViewerCount(streamId: number): Promise<void> {
  if (!io) return;
  const [stream] = await db
    .select({ totalVisualizadores: liveStreamsTable.totalVisualizadores })
    .from(liveStreamsTable)
    .where(eq(liveStreamsTable.id, streamId))
    .limit(1);

  io.to(`live:${streamId}`).emit("viewers:update", {
    streamId,
    count: stream?.totalVisualizadores ?? 0,
  });
}
