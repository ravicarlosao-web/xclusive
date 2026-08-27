import { Router } from "express";
import { requireAuth, type AuthRequest } from "../lib/auth";
import { db, usersTable, purchasesTable, liveStreamsTable, liveTipsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { validate } from "../lib/validate";
import { getIO } from "../lib/socket";

class PaymentError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "PaymentError";
    this.statusCode = statusCode;
  }
}

const router = Router();

// ── GET /api/live/active ──────────────────────────────────────────────────
// Retorna a lista de lives ativas
router.get("/live/active", async (req, res): Promise<void> => {
  try {
    const activeStreams = await db
      .select({
        id: liveStreamsTable.id,
        streamKey: liveStreamsTable.streamKey,
        criadorId: liveStreamsTable.criadorId,
        iniciadoEm: liveStreamsTable.iniciadoEm,
        totalVisualizadores: liveStreamsTable.totalVisualizadores,
        criador: {
          username: usersTable.username,
          nomeExibicao: usersTable.nomeExibicao,
          avatarUrl: usersTable.avatarUrl,
        }
      })
      .from(liveStreamsTable)
      .innerJoin(usersTable, eq(usersTable.id, liveStreamsTable.criadorId))
      .where(eq(liveStreamsTable.status, "ao_vivo"));

    res.json(activeStreams);
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao obter lives ativas");
    res.status(500).json({ error: "Erro interno do servidor." });
  }
});

// ── POST /api/live/start ──────────────────────────────────────────────────
// Criador inicia ou recupera uma live ativa
router.post("/live/start", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const creatorId = req.userId!;
    
    // Verificar se o utilizador é criador
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, creatorId)).limit(1);
    if (user?.tipoConta !== "criador") {
      res.status(403).json({ error: "Apenas criadores podem iniciar transmissões ao vivo." });
      return;
    }

    // Verificar se já existe uma live ativa
    let [stream] = await db
      .select()
      .from(liveStreamsTable)
      .where(and(eq(liveStreamsTable.criadorId, creatorId), eq(liveStreamsTable.status, "ao_vivo")))
      .limit(1);

    if (!stream) {
      // Criar nova live
      const newStreamId = crypto.randomUUID();
      [stream] = await db
        .insert(liveStreamsTable)
        .values({
          criadorId: creatorId,
          streamKey: newStreamId,
          status: "ao_vivo",
          iniciadoEm: new Date(),
        })
        .returning();
    }

    res.status(201).json(stream);
  } catch (err) {
    req.log?.error({ err }, "Erro ao iniciar live");
    res.status(500).json({ error: "Erro interno do servidor." });
  }
});

// ── POST /api/live/:streamId/end ──────────────────────────────────────────
// Criador (ou admin) termina a live
router.post("/live/:streamId/end", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const streamId = Number(req.params.streamId);
    
    const [stream] = await db.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, streamId)).limit(1);
    if (!stream) {
      res.status(404).json({ error: "Live não encontrada." });
      return;
    }

    // Apenas o próprio criador ou um admin podem terminar
    const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
    if (stream.criadorId !== req.userId && user?.role !== "admin" && user?.role !== "superadmin") {
      res.status(403).json({ error: "Não tens permissões para terminar esta live." });
      return;
    }

    const [updated] = await db
      .update(liveStreamsTable)
      .set({ 
        status: "terminado",
        terminadoEm: new Date(),
      })
      .where(eq(liveStreamsTable.id, streamId))
      .returning();

    // Notificar todos na sala que o stream terminou
    try {
      getIO().to(`live:${streamId}`).emit("stream:ended", { streamId });
    } catch {
      // Socket.io pode não estar inicializado em testes — ignorar silenciosamente
    }

    res.json(updated);
  } catch (err) {
    req.log?.error({ err }, "Erro ao terminar live");
    res.status(500).json({ error: "Erro interno do servidor." });
  }
});

// ── POST /api/live/:streamId/tip ──────────────────────────────────────────
const liveTipSchema = z.object({
  valor: z.number().int().positive("O valor deve ser superior a zero"),
  mensagem: z.string().max(255).optional(),
});

// Envia uma gorjeta para uma live ativa
router.post("/live/:streamId/tip", requireAuth, validate(liveTipSchema), async (req: AuthRequest, res): Promise<void> => {
  try {
    const streamId = Number(req.params.streamId);
    const { valor, mensagem } = req.body;
    const senderId = req.userId!;

    const [stream] = await db.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, streamId)).limit(1);
    if (!stream) {
      res.status(404).json({ error: "Live não encontrada." });
      return;
    }

    if (stream.status !== "ao_vivo") {
      res.status(400).json({ error: "Esta live já não está ativa." });
      return;
    }

    if (stream.criadorId === senderId) {
      res.status(400).json({ error: "Não podes dar gorjeta à tua própria live." });
      return;
    }

    const result = await db.transaction(async (tx) => {
      // 1. Bloquear linha do remetente
      const [sender] = await tx
        .select({ saldo: usersTable.saldo })
        .from(usersTable)
        .where(eq(usersTable.id, senderId))
        .for("update");

      if (!sender) throw new PaymentError("Utilizador não encontrado.", 404);

      // 2. Verificar saldo
      if (Number(sender.saldo) < valor) {
        throw new PaymentError("Saldo insuficiente para enviar esta gorjeta.", 402);
      }

      // 3. Debitar remetente
      await tx
        .update(usersTable)
        .set({ saldo: sql`${usersTable.saldo} - ${valor}` })
        .where(eq(usersTable.id, senderId));

      // 4. Creditar ganhos do criador da live
      await tx
        .update(usersTable)
        .set({ ganhos: sql`${usersTable.ganhos} + ${valor}` })
        .where(eq(usersTable.id, stream.criadorId));

      // 5. Registar a gorjeta específica da live
      const [tip] = await tx
        .insert(liveTipsTable)
        .values({
          streamId,
          remetenteId: senderId,
          valor,
          mensagem: mensagem || null,
        })
        .returning();

      // 6. Registar transação genérica na carteira (para histórico e gráficos)
      await tx
        .insert(purchasesTable)
        .values({
          compradorId: senderId,
          vendedorId: stream.criadorId,
          tipo: "gorjeta",
          valor: String(valor),
          conteudoId: streamId, // Aqui conteudoId faz referência ao streamId
          descricao: `Gorjeta na Live #${streamId}${mensagem ? ` - ${mensagem}` : ""}`,
        });

      return tip;
    });

    res.status(201).json({ tip: result });

    // Notificar todos na sala sobre a gorjeta (fire-and-forget — não bloqueia a resposta HTTP)
    try {
      // Buscar username do remetente para o evento
      const [sender] = await db
        .select({ username: usersTable.username })
        .from(usersTable)
        .where(eq(usersTable.id, senderId))
        .limit(1);

      getIO().to(`live:${streamId}`).emit("tip:sent", {
        streamId,
        username: sender?.username ?? "Anónimo",
        valor,
        mensagem: mensagem ?? null,
        enviadoEm: new Date().toISOString(),
      });
    } catch {
      // Ignorar — não deve falhar o pedido HTTP
    }
  } catch (err) {
    if (err instanceof PaymentError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    req.log?.error({ err: err instanceof Error ? err.message : String(err) }, "Erro ao processar gorjeta na live");
    res.status(500).json({ error: "Erro interno do servidor." });
  }
});

export default router;
