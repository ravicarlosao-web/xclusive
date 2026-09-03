import { Router } from "express";
import { requireAuth, type AuthRequest } from "../lib/auth";
import { db, usersTable, purchasesTable, liveStreamsTable, liveTipsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { validate } from "../lib/validate";
import { getIO } from "../lib/socket";
import { getCommissionRate, calcComissao } from "../lib/commission";

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

      // 2b. Ler taxa de comissão activa (FOR SHARE).
      const commissionRate = await getCommissionRate(tx, stream.criadorId);
      const { valorCriador, comissao } = calcComissao(valor, commissionRate);

      // 3. Debitar remetente (valor total — o fã paga sempre o valor cheio)
      await tx
        .update(usersTable)
        .set({ saldo: sql`${usersTable.saldo} - ${valor}` })
        .where(eq(usersTable.id, senderId));

      // 4. Creditar ganhos líquidos ao criador da live
      await tx
        .update(usersTable)
        .set({ ganhos: sql`${usersTable.ganhos} + ${valorCriador}` })
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

      // 6. Registar transação genérica na carteira com comissão gravada
      await tx
        .insert(purchasesTable)
        .values({
          compradorId: senderId,
          vendedorId: stream.criadorId,
          tipo: "gorjeta",
          valor: String(valor),
          comissao: String(comissao),
          conteudoId: streamId,
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

// ── POST /api/live/admission ──────────────────────────────────────────────
router.post("/live/admission", async (req, res): Promise<void> => {
  try {
    // 1. Validar autenticação do webhook via header secreto partilhado
    const configuredSecret = process.env.LIVE_ADMISSION_SECRET;
    const providedSecret = req.headers["x-webhook-secret"];

    if (!configuredSecret || !providedSecret || providedSecret !== configuredSecret) {
      res.status(401).json({ error: "Unauthorized: Invalid or missing webhook secret." });
      return;
    }

    const payload = req.body ?? {};
    const requestInfo = payload.request ?? {};
    const url = String(requestInfo.url ?? "");
    const status = String(requestInfo.status ?? "opening").toLowerCase();
    const direction = String(requestInfo.direction ?? "incoming").toLowerCase();

    // 2. Extrair o streamKey do URL (ex: "rtmp://host:1935/app/streamKey" ou query string)
    // Remove qualquer query string primeiro e obtém o último segmento do caminho
    const urlWithoutQuery = url.split("?")[0].trim();
    const streamKey = urlWithoutQuery.substring(urlWithoutQuery.lastIndexOf("/") + 1);

    // Validação de formato UUID (v1-v5) antes de consultar o banco para evitar erro de sintaxe Postgres (HTTP 500)
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!streamKey || !UUID_REGEX.test(streamKey)) {
      (req as any).log?.warn?.({ streamKey, url }, "Live admission negada: streamKey inválida ou não é UUID");
      res.json({ allowed: false });
      return;
    }

    // 3. Consultar a stream na base de dados
    const [stream] = await db
      .select()
      .from(liveStreamsTable)
      .where(eq(liveStreamsTable.streamKey, streamKey))
      .limit(1);

    if (!stream) {
      (req as any).log?.info?.({ streamKey }, "Live admission negada: streamKey inexistente");
      res.json({ allowed: false });
      return;
    }

    // Tratar evento de encerramento do OvenMediaEngine (quando o encoder desliga ou a sessão fecha)
    if (status === "closing") {
      if (stream.status !== "terminado") {
        await db
          .update(liveStreamsTable)
          .set({
            status: "terminado",
            terminadoEm: new Date(),
          })
          .where(eq(liveStreamsTable.id, stream.id));

        try {
          getIO().to(`live:${stream.id}`).emit("stream:ended", { streamId: stream.id });
        } catch {
          // Socket.io pode não estar inicializado em testes
        }
      }
      res.json({});
      return;
    }

    // Para requisições de publicação/abertura (opening):
    // Se o status já for 'terminado', não permitir reutilização da chave
    if (stream.status === "terminado") {
      (req as any).log?.info?.({ streamId: stream.id }, "Live admission negada: live já terminada");
      res.json({ allowed: false });
      return;
    }

    // Se estiver 'agendado', actualizar para 'ao_vivo' e definir iniciadoEm
    if (stream.status === "agendado") {
      await db
        .update(liveStreamsTable)
        .set({
          status: "ao_vivo",
          iniciadoEm: new Date(),
        })
        .where(eq(liveStreamsTable.id, stream.id));
    }

    (req as any).log?.info?.({ streamId: stream.id, direction, status }, "Live admission autorizada");
    res.json({ allowed: true });
  } catch (err) {
    (req as any).log?.error?.({ err }, "Erro no admission webhook de live");
    res.status(500).json({ allowed: false, error: "Internal server error." });
  }
});

export default router;
