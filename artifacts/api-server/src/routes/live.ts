import { Router } from "express";
import crypto from "node:crypto";
import { requireAuth, optionalAuth, type AuthRequest } from "../lib/auth";
import { db, usersTable, purchasesTable, liveStreamsTable, liveTipsTable, liveTicketsTable } from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { validate } from "../lib/validate";
import { getIO } from "../lib/socket";
import { getCommissionRate, calcComissao } from "../lib/commission";
import { userHasLiveAccess, liveIdsWithAccess, isAdminRole } from "../lib/liveAccess";
import { liveStartSchema } from "../lib/liveTicket";
import { signViewerToken, verifyViewerToken, buildWebrtcViewerUrl, isViewerTokenConfigured } from "../lib/liveViewerToken";
import { logger } from "../lib/logger";

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
// Retorna a lista de lives ativas (só metadados). NUNCA devolve a streamKey:
// quem tem acesso obtém-na em GET /api/live/:streamId/playback.
// optionalAuth: sem sessão → temAcesso:false.
router.get("/live/active", optionalAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const activeStreams = await db
      .select({
        id: liveStreamsTable.id,
        criadorId: liveStreamsTable.criadorId,
        iniciadoEm: liveStreamsTable.iniciadoEm,
        totalVisualizadores: liveStreamsTable.totalVisualizadores,
        tipo: liveStreamsTable.tipo,
        preco: liveStreamsTable.preco,
        criador: {
          username: usersTable.username,
          nomeExibicao: usersTable.nomeExibicao,
          avatarUrl: usersTable.avatarUrl,
        }
      })
      .from(liveStreamsTable)
      .innerJoin(usersTable, eq(usersTable.id, liveStreamsTable.criadorId))
      .where(eq(liveStreamsTable.status, "ao_vivo"));

    const allowed = await liveIdsWithAccess(req.userId, activeStreams);

    res.json(
      activeStreams.map((s) => ({
        ...s,
        preco: Number(s.preco),
        temAcesso: allowed.has(s.id),
      })),
    );
  } catch (err) {
    (req as any).log?.error({ err }, "Erro ao obter lives ativas");
    res.status(500).json({ error: "Erro interno do servidor." });
  }
});

// ── POST /api/live/start ──────────────────────────────────────────────────
// Prepara a live do criador e devolve os dados necessários para o encoder ligar.
// O status inicial é "agendado" — a transição para "ao_vivo" só ocorre quando
// o OvenMediaEngine confirmar um publisher real através do admission webhook
// (POST /api/live/admission). Desta forma, a live só aparece para espectadores
// em /api/live/active DEPOIS de existir uma ligação real de publisher.
router.post("/live/start", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const creatorId = req.userId!;

    // Verificar se o utilizador é criador
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, creatorId)).limit(1);
    if (user?.tipoConta !== "criador") {
      res.status(403).json({ error: "Apenas criadores podem iniciar transmissões ao vivo." });
      return;
    }

    // Reutilizar live existente se já estiver em curso (ao_vivo) ou preparada (agendado).
    // Incluir "agendado" evita criar duplicados se o criador carregar em "iniciar"
    // várias vezes antes de ligar o encoder.
    let [stream] = await db
      .select()
      .from(liveStreamsTable)
      .where(
        and(
          eq(liveStreamsTable.criadorId, creatorId),
          inArray(liveStreamsTable.status, ["agendado", "ao_vivo"])
        )
      )
      .limit(1);

    // Tipo e preço ficam fixos desde a abertura: se já existe live, o corpo é ignorado.
    if (!stream) {
      const parsed = liveStartSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: parsed.error.issues[0]?.message ?? "Dados inválidos",
          details: parsed.error.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message })),
        });
        return;
      }
      const { tipo, preco } = parsed.data;

      // Criar nova live em estado "agendado".
      // iniciadoEm é definido pelo admission webhook quando o OME confirmar publisher real.
      const newStreamId = crypto.randomUUID();
      [stream] = await db
        .insert(liveStreamsTable)
        .values({
          criadorId: creatorId,
          streamKey: newStreamId,
          status: "agendado",
          tipo,
          preco: String(tipo === "paga" ? preco : 0),
        })
        .returning();
    }

    res.status(201).json({ ...stream, preco: Number(stream.preco) });
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

    // Numa live paga, só quem tem acesso (bilhete/admin) pode dar gorjeta.
    if (!(await userHasLiveAccess(senderId, stream))) {
      res.status(403).json({ error: "Precisas de bilhete para participar nesta live." });
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

// Interruptor do WebRTC dos espectadores: LIVE_WEBRTC_VIEWER_MODE = off | admin | all.
// Lido a cada pedido (basta editar o .env e reiniciar o processo). Por defeito, ou
// com um valor inválido, é "off" (falha fechada): o campo `webrtc` não é emitido.
type WebrtcViewerMode = "off" | "admin" | "all";
let warnedInvalidWebrtcMode = false;
function getWebrtcViewerMode(log?: { warn?: (msg: string) => void }): WebrtcViewerMode {
  const raw = (process.env.LIVE_WEBRTC_VIEWER_MODE ?? "").trim().toLowerCase();
  if (raw === "off" || raw === "admin" || raw === "all") return raw;
  if (raw !== "" && !warnedInvalidWebrtcMode) {
    warnedInvalidWebrtcMode = true;
    log?.warn?.("LIVE_WEBRTC_VIEWER_MODE inválido (esperado off, admin ou all) — a usar off.");
  }
  return "off";
}


// Interruptor do HLS: LIVE_HLS_ENABLED = true | false (defeito true: nada muda). Com false o
// /playback NÃO inclui o campo `streamKey` (só `webrtc`; o URL do WebRTC leva a chave no
// caminho, como o OME exige) e os limites de espectadores passam a ser MOLES (ver abaixo).
// ATENÇÃO: isto não desliga o HLS na origem — o OME/Bunny continuam a servir HLS a quem
// tiver a chave; desativar os publishers HLS/LLHLS no OME (ou a pull zone) é à parte.
let warnedInvalidHlsFlag = false;
function getHlsEnabled(log?: { warn?: (msg: string) => void }): boolean {
  const raw = (process.env.LIVE_HLS_ENABLED ?? "").trim().toLowerCase();
  if (raw === "false") return false;
  if (raw === "" || raw === "true") return true;
  if (!warnedInvalidHlsFlag) {
    warnedInvalidHlsFlag = true;
    log?.warn?.("LIVE_HLS_ENABLED inválido (esperado true ou false) — a usar true.");
  }
  return true;
}

// ── Limites de capacidade do WebRTC dos espectadores ──────────────────────────
// O /playback só inclui `webrtc` se, além do modo, houver capacidade:
//   • espectadores da live < LIVE_WEBRTC_MAX_VIEWERS_PER_LIVE (defeito 15)
//   • espectadores em todas as lives ativas < LIVE_WEBRTC_MAX_VIEWERS_TOTAL (defeito 30)
// Atingido o limite o espectador recebe só { streamKey } e usa o HLS (HTTP 200, sem erro).
// admin e superadmin ignoram os limites. Variáveis lidas a cada pedido; inteiros ≥ 0
// (0 = ninguém, exceto admin); por definir ou inválidas → defeito. Um limite por live
// maior do que o total fica limitado pelo total.
//
// ATENÇÃO — como se conta: pelas salas do socket.io em memória (nunca pela coluna
// total_visualizadores, que deriva após reinícios). A contagem INCLUI os espectadores
// do HLS (os sockets não distinguem o transporte), por isso estes limites são valores
// CONSERVADORES, a rever depois do teste de carga. Fora da contagem: a criadora da
// live e o próprio pedido (um socket do próprio utilizador; uma 2.ª aba conta).
// Só é válido com uma instância (PM2 em fork); em cluster seria preciso o adaptador Redis.
const WEBRTC_DEFAULT_MAX_PER_LIVE = 15;
const WEBRTC_DEFAULT_MAX_TOTAL = 30;
/**
 * Com LIVE_HLS_ENABLED=false os limites acima são MOLES (só avisam). Só se recusa (live cheia)
 * quando o total de espectadores atinge LIVE_WEBRTC_HARD_CEILING_TOTAL (defeito 120).
 */
const WEBRTC_DEFAULT_HARD_CEILING_TOTAL = 120;
/** Quem acabou de receber `webrtc` mantém-no (reconexões) durante este tempo. */
const WEBRTC_REGRANT_GRACE_MS = 2 * 60 * 1000;
/** No máximo um aviso de "limite atingido" por este intervalo. */
const WEBRTC_CAPACITY_WARN_INTERVAL_MS = 60 * 1000;

const warnedInvalidLimitVars = new Set<string>();
function readLimit(name: string, fallback: number): number {
  const raw = (process.env[name] ?? "").trim();
  if (raw === "") return fallback;
  if (/^\d{1,7}$/.test(raw)) return Number(raw);
  if (!warnedInvalidLimitVars.has(name)) {
    warnedInvalidLimitVars.add(name);
    logger.warn({ variable: name, default: fallback }, "Variável de limite WebRTC inválida (esperado inteiro ≥ 0) — a usar o defeito.");
  }
  return fallback;
}

/** Limites efetivos: o limite por live nunca excede o total. */
function getWebrtcLimits(): { perLive: number; total: number } {
  const total = readLimit("LIVE_WEBRTC_MAX_VIEWERS_TOTAL", WEBRTC_DEFAULT_MAX_TOTAL);
  const perLive = Math.min(readLimit("LIVE_WEBRTC_MAX_VIEWERS_PER_LIVE", WEBRTC_DEFAULT_MAX_PER_LIVE), total);
  return { perLive, total };
}

/** Teto duro (só vale com o HLS desligado). */
function getWebrtcHardCeiling(): number {
  return readLimit("LIVE_WEBRTC_HARD_CEILING_TOTAL", WEBRTC_DEFAULT_HARD_CEILING_TOTAL);
}

// Regista uma vez, no arranque, os limites efetivos (só números). O setTimeout garante
// que o .env já foi carregado quando as variáveis são lidas.
setTimeout(() => {
  const { perLive, total } = getWebrtcLimits();
  logger.info(
    { perLive, total, regrantGraceSeconds: WEBRTC_REGRANT_GRACE_MS / 1000 },
    "Limites WebRTC de espectadores (a contagem inclui espectadores HLS: valores conservadores, rever após o teste de carga)",
  );

  const hlsEnabled = getHlsEnabled({ warn: (m) => logger.warn(m) });
  logger.info({ hlsEnabled, hardCeilingTotal: getWebrtcHardCeiling() }, "Interruptor do HLS (LIVE_HLS_ENABLED) e teto duro WebRTC");
  if (!hlsEnabled) {
    const rawCeiling = (process.env.LIVE_WEBRTC_HARD_CEILING_TOTAL ?? "").trim();
    if (!/^\d{1,7}$/.test(rawCeiling)) {
      logger.warn(
        { default: WEBRTC_DEFAULT_HARD_CEILING_TOTAL },
        "LIVE_HLS_ENABLED=false e LIVE_WEBRTC_HARD_CEILING_TOTAL não definido: a valer o defeito de 120.",
      );
    }
    // Sem HLS não há reserva: uma configuração que não deixe ninguém ver é um erro grave.
    const mode = getWebrtcViewerMode({ warn: (m) => logger.warn(m) });
    if (mode === "off") {
      logger.error("LIVE_HLS_ENABLED=false com LIVE_WEBRTC_VIEWER_MODE=off: NINGUÉM consegue ver as lives (503 webrtc_unavailable).");
    } else if (mode === "admin") {
      logger.warn("LIVE_HLS_ENABLED=false com LIVE_WEBRTC_VIEWER_MODE=admin: só admin e superadmin conseguem ver as lives.");
    }
    if (!isViewerTokenConfigured()) {
      logger.error("LIVE_HLS_ENABLED=false sem LIVE_VIEWER_TOKEN_SECRET: NINGUÉM consegue ver as lives (503 webrtc_unavailable).");
    }
  }
}, 0);

/** Concessões recentes de `webrtc` (utilizador+live): tolerância de reconexão e reserva de vaga. */
const webrtcGrants = new Map<string, { userId: number; liveId: number; until: number }>();

let lastCapacityWarnAt = 0;
let capacityDenialsSuppressed = 0;
type CapacityNote = {
  scope: "per_live" | "total" | "count_unavailable";
  /** limit: recusa (HLS ligado) · soft: limite mole ultrapassado (HLS desligado) · ceiling: teto duro */
  kind: "limit" | "soft" | "ceiling";
  liveId: number;
  count: number;
  limit: number;
};
/** Um aviso por minuto (todos os tipos), sem dados pessoais (nem req.log, que inclui o IP). */
function noteWebrtcCapacityReached(info: CapacityNote): void {
  const now = Date.now();
  if (now - lastCapacityWarnAt >= WEBRTC_CAPACITY_WARN_INTERVAL_MS) {
    const msg =
      info.kind === "soft"
        ? "Limite WebRTC de espectadores ultrapassado (limite mole, HLS desligado) — a emitir WebRTC na mesma"
        : info.kind === "ceiling"
          ? "Teto duro WebRTC de espectadores atingido (HLS desligado) — live cheia"
          : "Limite WebRTC de espectadores atingido — novos espectadores usam HLS";
    logger.warn({ ...info, suppressed: capacityDenialsSuppressed }, msg);
    lastCapacityWarnAt = now;
    capacityDenialsSuppressed = 0;
  } else {
    capacityDenialsSuppressed += 1;
  }
}

type WebrtcDecision =
  | { allowed: true; reservedNew: boolean }
  | { allowed: false; code: "live_full" | "webrtc_unavailable" };

/** Liberta uma vaga reservada (compra que não chegou a cobrar). */
function releaseWebrtcSlot(userId: number, liveId: number): void {
  webrtcGrants.delete(`${liveId}:${userId}`);
}

/**
 * Há capacidade WebRTC para este pedido? A contagem e a reserva da vaga são síncronas
 * (sem await entre elas), por isso pedidos simultâneos não ultrapassam o limite.
 *  • HLS ligado: limites duros (acima → só HLS); falha da contagem → só admin/superadmin.
 *  • HLS desligado: limites MOLES (avisa e emite na mesma); só o teto duro recusa (live_full);
 *    falha da contagem → emite na mesma (não há HLS para onde cair).
 * admin e superadmin ignoram limites e teto.
 */
async function webrtcCapacityDecision(userId: number, liveId: number, hlsEnabled: boolean): Promise<WebrtcDecision> {
  const now = Date.now();
  for (const [k, g] of webrtcGrants) if (g.until <= now) webrtcGrants.delete(k);

  const grantKey = `${liveId}:${userId}`;
  const grant = () => webrtcGrants.set(grantKey, { userId, liveId, until: now + WEBRTC_REGRANT_GRACE_MS });

  // Tolerância: quem acabou de receber webrtc nesta live mantém-no (não renova a validade).
  if (webrtcGrants.has(grantKey)) return { allowed: true, reservedNew: false };

  const { perLive: maxPerLive, total: maxTotal } = getWebrtcLimits();
  const ceiling = getWebrtcHardCeiling();
  let blockedBy: CapacityNote | null = null;

  try {
    const active = await db
      .select({ id: liveStreamsTable.id, criadorId: liveStreamsTable.criadorId })
      .from(liveStreamsTable)
      .where(eq(liveStreamsTable.status, "ao_vivo"));

    // ── secção síncrona: contar + decidir + reservar ──
    const io = getIO();
    const rooms = io.sockets.adapter.rooms;
    const sockets = io.sockets.sockets;
    const activeIds = new Set(active.map((l) => l.id));
    let perLive = 0;
    let total = 0;
    const presentByLive = new Map<number, Set<number>>();

    for (const live of active) {
      const room = rooms.get(`live:${live.id}`);
      const present = new Set<number>();
      presentByLive.set(live.id, present);
      if (!room) continue;
      let n = 0;
      let skippedSelf = false;
      for (const sid of room) {
        const uid = sockets.get(sid)?.data.userId;
        if (uid === undefined) continue;
        if (uid === live.criadorId) continue; // a criadora fica fora da contagem
        present.add(uid);
        if (live.id === liveId && uid === userId && !skippedSelf) {
          skippedSelf = true; // o próprio pedido não conta
          continue;
        }
        n += 1;
      }
      total += n;
      if (live.id === liveId) perLive = n;
    }
    // Reservas: concessões recentes de outros utilizadores que ainda não estão na sala.
    for (const g of webrtcGrants.values()) {
      if (g.userId === userId || !activeIds.has(g.liveId)) continue;
      if (presentByLive.get(g.liveId)?.has(g.userId)) continue;
      total += 1;
      if (g.liveId === liveId) perLive += 1;
    }

    if (hlsEnabled) {
      if (perLive >= maxPerLive) blockedBy = { scope: "per_live", kind: "limit", liveId, count: perLive, limit: maxPerLive };
      else if (total >= maxTotal) blockedBy = { scope: "total", kind: "limit", liveId, count: total, limit: maxTotal };
    } else if (total >= ceiling) {
      blockedBy = { scope: "total", kind: "ceiling", liveId, count: total, limit: ceiling };
    } else if (perLive >= maxPerLive) {
      noteWebrtcCapacityReached({ scope: "per_live", kind: "soft", liveId, count: perLive, limit: maxPerLive });
    } else if (total >= maxTotal) {
      noteWebrtcCapacityReached({ scope: "total", kind: "soft", liveId, count: total, limit: maxTotal });
    }

    if (!blockedBy) {
      grant();
      return { allowed: true, reservedNew: true };
    }
  } catch {
    if (!hlsEnabled) {
      // Contagem indisponível e sem HLS: não bloqueia ninguém (só avisa).
      noteWebrtcCapacityReached({ scope: "count_unavailable", kind: "soft", liveId, count: -1, limit: ceiling });
      grant();
      return { allowed: true, reservedNew: true };
    }
    // Contagem indisponível com HLS ligado: falha fechada (o espectador usa o HLS).
    blockedBy = { scope: "count_unavailable", kind: "limit", liveId, count: -1, limit: maxTotal };
  }

  // Excedido: admin e superadmin ignoram os limites.
  const [me] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (isAdminRole(me?.role)) return { allowed: true, reservedNew: false };
  noteWebrtcCapacityReached(blockedBy);
  return { allowed: false, code: "live_full" };
}

/**
 * Este utilizador pode receber WebRTC agora? Modo (off | admin | all), segredo do token e
 * capacidade. Usado pelo /playback e, antes de cobrar, pela compra do bilhete.
 */
async function evaluateWebrtcAccess(
  userId: number,
  liveId: number,
  hlsEnabled: boolean,
  log?: { warn?: (msg: string) => void },
): Promise<WebrtcDecision> {
  const mode = getWebrtcViewerMode(log);
  if (mode === "off" || !isViewerTokenConfigured()) return { allowed: false, code: "webrtc_unavailable" };
  if (mode === "admin") {
    const [me] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    return isAdminRole(me?.role) ? { allowed: true, reservedNew: false } : { allowed: false, code: "webrtc_unavailable" };
  }
  return webrtcCapacityDecision(userId, liveId, hlsEnabled);
}

const WEBRTC_UNAVAILABLE_MESSAGES = {
  live_full: "Esta live está cheia. Tenta novamente dentro de instantes.",
  webrtc_unavailable: "A transmissão ao vivo não está disponível neste momento.",
} as const;

// ── GET /api/live/:streamId/playback ──────────────────────────────────────
// Devolve a streamKey SÓ a quem tem acesso (gratuita: qualquer sessão; paga:
// bilhete, criadora ou admin). O acesso é verificado sempre na base de dados.
router.get("/live/:streamId/playback", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const streamId = Number(req.params.streamId);
    if (!Number.isInteger(streamId) || streamId <= 0) {
      res.status(400).json({ error: "ID de live inválido." });
      return;
    }

    const [stream] = await db.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, streamId)).limit(1);
    if (!stream) {
      res.status(404).json({ error: "Live não encontrada." });
      return;
    }
    if (stream.status !== "ao_vivo") {
      res.status(409).json({ error: "Esta live não está ativa." });
      return;
    }

    if (!(await userHasLiveAccess(req.userId, stream))) {
      res.status(403).json({
        error: "Precisas de bilhete para ver esta live.",
        tipo: stream.tipo,
        preco: Number(stream.preco),
      });
      return;
    }

    res.set("Cache-Control", "no-store");

    // WebRTC (OvenMediaEngine): URL com token de vida curta, novo a cada pedido
    // (uma reconexão volta a chamar este endpoint). Só é emitido se o modo o permitir
    // (off: ninguém; admin: admin/superadmin; all: todos, dentro dos limites de capacidade)
    // e houver segredo configurado.
    // Caso contrário a resposta é a de sempre, só com a streamKey.
    const hlsEnabled = getHlsEnabled(req.log);
    const decision = await evaluateWebrtcAccess(req.userId!, stream.id, hlsEnabled, req.log);
    const viewerToken = decision.allowed
      ? signViewerToken({ userId: req.userId!, liveId: stream.id, streamKey: stream.streamKey })
      : null;
    const webrtc = viewerToken
      ? { url: buildWebrtcViewerUrl(stream.streamKey, viewerToken.token), expiresAt: viewerToken.expiresAt.toISOString() }
      : null;

    if (!hlsEnabled) {
      // Sem HLS: nunca se devolve o campo streamKey; sem WebRTC não há nada para ver (503).
      if (!webrtc) {
        const code = decision.allowed ? "webrtc_unavailable" : decision.code;
        if (decision.allowed && decision.reservedNew) releaseWebrtcSlot(req.userId!, stream.id);
        if (code === "live_full") res.set("Retry-After", "5");
        res.status(503).json({ code, error: WEBRTC_UNAVAILABLE_MESSAGES[code] });
        return;
      }
      res.json({ webrtc });
      return;
    }

    res.json(webrtc ? { streamKey: stream.streamKey, webrtc } : { streamKey: stream.streamKey });
  } catch (err) {
    req.log?.error({ err }, "Erro ao obter playback da live");
    res.status(500).json({ error: "Erro interno do servidor." });
  }
});

// ── POST /api/live/:streamId/ticket ───────────────────────────────────────
// Compra do bilhete de uma live paga com o saldo da plataforma.
// Preço = o da live (base de dados), nunca do pedido; paga-se sempre o valor
// inteiro, mesmo a meio da live. Comissão e crédito como nas gorjetas.
// Idempotente e seguro em pedidos simultâneos: a linha do comprador é bloqueada
// (FOR UPDATE), o que serializa pedidos do mesmo utilizador; unique(live_id,
// user_id) é a segunda barreira, e se o INSERT não inserir nada faz-se rollback
// de tudo (nunca fica débito sem bilhete).
class TicketNotInsertedError extends Error {}

router.post("/live/:streamId/ticket", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  // Vaga WebRTC reservada para este comprador (só com o HLS desligado); libertada se não cobrar.
  let reservedSlot: { userId: number; liveId: number } | null = null;
  try {
    const streamId = Number(req.params.streamId);
    const buyerId = req.userId!;
    if (!Number.isInteger(streamId) || streamId <= 0) {
      res.status(400).json({ error: "ID de live inválido." });
      return;
    }

    const [stream0] = await db.select().from(liveStreamsTable).where(eq(liveStreamsTable.id, streamId)).limit(1);
    if (!stream0) {
      res.status(404).json({ error: "Live não encontrada." });
      return;
    }
    if (stream0.status !== "ao_vivo") {
      res.status(409).json({ error: "Esta live já não está ativa." });
      return;
    }
    if (stream0.tipo !== "paga") {
      res.status(400).json({ error: "Esta live é gratuita." });
      return;
    }
    if (stream0.criadorId === buyerId) {
      res.status(400).json({ error: "És a criadora desta live." });
      return;
    }
    const [buyerRow] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, buyerId)).limit(1);
    if (isAdminRole(buyerRow?.role)) {
      res.status(400).json({ error: "Já tens acesso a esta live." });
      return;
    }

    // Com o HLS desligado, quem compra só pode ver por WebRTC: verifica a capacidade e RESERVA a vaga
    // ANTES de qualquer débito. Sem vaga (ou com o WebRTC indisponível) responde 503 sem cobrar.
    // Quem já tem bilhete não reserva nem paga de novo (a transação devolve `jaTinha`).
    if (!getHlsEnabled(req.log)) {
      const [owned] = await db
        .select({ id: liveTicketsTable.id })
        .from(liveTicketsTable)
        .where(and(eq(liveTicketsTable.liveId, streamId), eq(liveTicketsTable.userId, buyerId)))
        .limit(1);
      if (!owned) {
        const decision = await evaluateWebrtcAccess(buyerId, streamId, false, req.log);
        if (!decision.allowed) {
          if (decision.code === "live_full") res.set("Retry-After", "5");
          res.status(503).json({
            code: decision.code,
            error: `${WEBRTC_UNAVAILABLE_MESSAGES[decision.code]} Não foste cobrado.`,
          });
          return;
        }
        if (decision.reservedNew) reservedSlot = { userId: buyerId, liveId: streamId };
      }
    }

    const attempt = async () =>
      db.transaction(async (tx) => {
        // 1. Estado da live fixado até ao fim da transação (o /end espera).
        const [stream] = await tx
          .select()
          .from(liveStreamsTable)
          .where(eq(liveStreamsTable.id, streamId))
          .for("share");
        if (!stream) throw new PaymentError("Live não encontrada.", 404);
        if (stream.status !== "ao_vivo") throw new PaymentError("Esta live já não está ativa.", 409);
        if (stream.tipo !== "paga") throw new PaymentError("Esta live é gratuita.", 400);

        // 2. Bloquear a linha do comprador (serializa pedidos simultâneos dele).
        const [buyer] = await tx
          .select({ saldo: usersTable.saldo })
          .from(usersTable)
          .where(eq(usersTable.id, buyerId))
          .for("update");
        if (!buyer) throw new PaymentError("Utilizador não encontrado.", 404);

        // 3. Já tem bilhete → idempotente, não cobra.
        const [existing] = await tx
          .select({ id: liveTicketsTable.id })
          .from(liveTicketsTable)
          .where(and(eq(liveTicketsTable.liveId, streamId), eq(liveTicketsTable.userId, buyerId)))
          .limit(1);
        if (existing) return { jaTinha: true as const, saldo: Number(buyer.saldo) };

        // 4. Saldo
        const preco = Number(stream.preco);
        if (Number(buyer.saldo) < preco) {
          throw new PaymentError("Saldo insuficiente para comprar este bilhete.", 402);
        }

        // 5. Comissão (mesma lógica das gorjetas)
        const commissionRate = await getCommissionRate(tx, stream.criadorId);
        const { valorCriador, comissao } = calcComissao(preco, commissionRate);

        // 6. Registo na carteira
        const [purchase] = await tx
          .insert(purchasesTable)
          .values({
            compradorId: buyerId,
            vendedorId: stream.criadorId,
            tipo: "bilhete_live",
            valor: String(preco),
            comissao: String(comissao),
            conteudoId: streamId,
            descricao: `Bilhete da Live #${streamId}`,
          })
          .returning({ id: purchasesTable.id });

        // 7. Bilhete: se não inserir nenhuma linha → rollback de TUDO.
        const inserted = await tx
          .insert(liveTicketsTable)
          .values({
            liveId: streamId,
            userId: buyerId,
            valor: String(preco),
            comissao: String(comissao),
            purchaseId: purchase.id,
          })
          .onConflictDoNothing()
          .returning({ id: liveTicketsTable.id });
        if (inserted.length === 0) throw new TicketNotInsertedError();

        // 8. Debitar o comprador (valor inteiro) e creditar a criadora (líquido)
        const [updated] = await tx
          .update(usersTable)
          .set({ saldo: sql`${usersTable.saldo} - ${preco}` })
          .where(eq(usersTable.id, buyerId))
          .returning({ saldo: usersTable.saldo });
        await tx
          .update(usersTable)
          .set({ ganhos: sql`${usersTable.ganhos} + ${valorCriador}` })
          .where(eq(usersTable.id, stream.criadorId));

        return { jaTinha: false as const, saldo: Number(updated.saldo), ticketId: inserted[0].id };
      });

    let result;
    try {
      result = await attempt();
    } catch (err) {
      // Transação revertida (nada foi cobrado). Se entretanto o bilhete existe, é um repetido.
      if (!(err instanceof TicketNotInsertedError)) throw err;
      const [existing] = await db
        .select({ id: liveTicketsTable.id })
        .from(liveTicketsTable)
        .where(and(eq(liveTicketsTable.liveId, streamId), eq(liveTicketsTable.userId, buyerId)))
        .limit(1);
      if (!existing) throw err;
      const [u] = await db.select({ saldo: usersTable.saldo }).from(usersTable).where(eq(usersTable.id, buyerId)).limit(1);
      result = { jaTinha: true as const, saldo: Number(u?.saldo ?? 0) };
    }

    // Já tinha bilhete: nada foi cobrado, não fica vaga reservada por esta compra.
    if (result.jaTinha && reservedSlot) releaseWebrtcSlot(reservedSlot.userId, reservedSlot.liveId);

    res.status(result.jaTinha ? 200 : 201).json({
      temAcesso: true,
      jaTinha: result.jaTinha,
      saldo: result.saldo,
    });
  } catch (err) {
    // A compra não se concluiu (nada cobrado): liberta a vaga reservada.
    if (reservedSlot) releaseWebrtcSlot(reservedSlot.userId, reservedSlot.liveId);
    if (err instanceof PaymentError) {
      res.status(err.statusCode).json({ error: err.message });
      return;
    }
    req.log?.error({ err: err instanceof Error ? err.message : String(err) }, "Erro ao comprar bilhete da live");
    res.status(500).json({ error: "Erro interno do servidor." });
  }
});

// Valida o pedido WebRTC de um espectador: token (assinatura, expiração, streamKey
// e live coincidem com a URL) e acesso verificado de novo na base de dados.
async function admitWebrtcViewer(
  url: string,
  streamKey: string,
  stream: { id: number; criadorId: number; tipo: "gratuita" | "paga"; status: string },
): Promise<boolean> {
  let token: string | null;
  try {
    token = new URL(url).searchParams.get("token");
  } catch {
    return false;
  }
  if (!token) return false;

  const claims = verifyViewerToken(token);
  if (!claims) return false;
  if (claims.streamKey.toLowerCase() !== streamKey.toLowerCase()) return false;
  if (claims.liveId !== stream.id) return false;
  if (stream.status !== "ao_vivo") return false;

  return userHasLiveAccess(claims.userId, stream);
}

// Comparação da assinatura em tempo constante. Comprimentos diferentes → false
// (timingSafeEqual lançaria erro), sem revelar nada pelo tempo de resposta.
function signaturesMatch(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

// ── POST /api/live/admission ──────────────────────────────────────────────
// O OvenMediaEngine envia X-OME-Signature: HMAC-SHA1 do raw body JSON,
// codificado em base64 url-safe, usando o <SecretKey> configurado no VHostDefault.xml.
// Referência: https://airensoft.gitbook.io/ovenmediaengine/access-control/admission-webhooks
//
// IMPORTANTE — raw body:
//   O app.ts regista express.raw({ type: "application/json" }) especificamente
//   para esta rota, ANTES do express.json() global. Por isso req.body chega aqui
//   como um Buffer com os bytes exactos enviados pelo OME — não um objecto JS
//   reconstruído. O HMAC é calculado sobre esse Buffer, garantindo correspondência
//   exacta com a assinatura que o OME gerou.
router.post("/live/admission", async (req, res): Promise<void> => {
  try {
    // 1. Garantir que LIVE_ADMISSION_SECRET está configurado — nunca aceitar sem segredo
    const configuredSecret = process.env.LIVE_ADMISSION_SECRET;
    if (!configuredSecret) {
      // Erro de configuração de servidor — não é culpa do cliente
      (req as any).log?.error?.(
        "LIVE_ADMISSION_SECRET não definido em produção — admission webhook recusado por segurança"
      );
      res.status(500).json({ error: "Server misconfiguration: admission secret not configured." });
      return;
    }

    // 2. Verificar X-OME-Signature: HMAC-SHA1 do raw body, base64url
    //    req.body é um Buffer (graças ao express.raw() registado em app.ts antes do express.json())
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    const receivedSig = req.headers["x-ome-signature"] as string | undefined;

    const expectedSig = crypto
      .createHmac("sha1", configuredSecret)
      .update(rawBody)
      .digest("base64url"); // base64 url-safe sem padding '=' — comportamento do OME

    if (!receivedSig || !signaturesMatch(receivedSig, expectedSig)) {
      (req as any).log?.warn?.(
        { receivedSig, expectedSigPrefix: expectedSig.slice(0, 8) + "..." },
        "Live admission 401: assinatura X-OME-Signature inválida ou ausente"
      );
      res.status(401).json({ error: "Unauthorized: Invalid X-OME-Signature." });
      return;
    }

    // 3. Parse manual do body (que chegou como Buffer, não como objecto JS)
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.status(400).json({ error: "Bad request: invalid JSON body." });
      return;
    }

    const requestInfo = payload.request ?? {};
    const url = String(requestInfo.url ?? "");
    const status = String(requestInfo.status ?? "opening").toLowerCase();
    const direction = String(requestInfo.direction ?? "incoming").toLowerCase();
    const protocol = String(requestInfo.protocol ?? "").toLowerCase();

    // Espectador a sair (outgoing + closing): no-op. Nunca termina a live nem
    // escreve na base de dados.
    if (direction === "outgoing" && status === "closing") {
      res.json({});
      return;
    }

    // 4. Extrair o streamKey do URL (ex: "rtmp://host:1935/app/streamKey" ou query string)
    // Remove qualquer query string primeiro e obtém o último segmento do caminho
    const urlWithoutQuery = url.split("?")[0].trim();

    let rawStreamKey = urlWithoutQuery.substring(urlWithoutQuery.lastIndexOf("/") + 1).trim();
    try {
      rawStreamKey = decodeURIComponent(rawStreamKey);
    } catch {}
    try {
      rawStreamKey = decodeURIComponent(rawStreamKey);
    } catch {}
    // Remove chavetas {}, %7B, %7D, aspas ou barras remanescentes para garantir UUID puro
    const streamKey = rawStreamKey
      .replace(/%7B/gi, "")
      .replace(/%7D/gi, "")
      .replace(/[{}[\]()"'`\\/]/g, "")
      .trim();

    // Validação de formato UUID (v1-v5) antes de consultar o banco para evitar erro de sintaxe Postgres (HTTP 500)
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!streamKey || !UUID_REGEX.test(streamKey)) {
      // URL sem query string: nunca registar o token de espectador.
      (req as any).log?.warn?.({ streamKey, url: urlWithoutQuery }, "Live admission negada: streamKey inválida ou não é UUID");
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

    // Espectador WebRTC (outgoing + webrtc): exige token válido e acesso na BD.
    // Falha fechada: qualquer problema → allowed:false (nunca 500).
    // Outros protocolos em outgoing (hls, llhls) mantêm o comportamento permissivo abaixo.
    if (direction === "outgoing" && protocol === "webrtc") {
      let allowed = false;
      try {
        allowed = await admitWebrtcViewer(url, streamKey, stream);
      } catch {
        allowed = false;
      }
      (req as any).log?.info?.({ streamId: stream.id, allowed }, "Live admission WebRTC espectador");
      res.json({ allowed });
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
