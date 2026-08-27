import type { Server as HttpServer } from "node:http";
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
    /** streamId da sala em que o socket está actualmente */
    currentStreamId: number | null;
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
        .select({ ativo: usersTable.ativo, username: usersTable.username })
        .from(usersTable)
        .where(eq(usersTable.id, payload.userId))
        .limit(1);

      if (!user || !user.ativo) {
        return next(new Error("Conta suspensa ou não encontrada."));
      }

      socket.data.userId = payload.userId;
      socket.data.username = user.username;
      socket.data.currentStreamId = null;
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

      // Sair de qualquer sala anterior antes de entrar numa nova
      if (socket.data.currentStreamId !== null) {
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

        logger.debug({ userId: socket.data.userId, streamId }, "viewer:join");
      } catch (err) {
        logger.error({ err, streamId }, "Erro ao processar viewer:join");
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
