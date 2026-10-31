import { Router } from "express";
import { db, conversationsTable, conversationParticipantsTable, messagesTable, usersTable, messageTipsTable, reportsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { permissaoMensagem, textoRegra, TEXTO_BLOQUEASTE } from "../lib/permissaoMensagem";
import { GORJETA_MENSAGEM, GorjetaErro, enviarGorjetaMensagem, erroDePermissaoGorjeta, formatarKz } from "../lib/gorjetaMensagem";
import { CommissionNotConfiguredError } from "../lib/commission";
import { validate } from "../lib/validate";
import { criarDenuncia, denunciaMensagemSchema, limiteUtilizador, tratarErro } from "./reports";
import { prepararProvaMensagem, apagarCopiasDeProva } from "../lib/denunciaMensagem";
import { requireAuth, type AuthRequest } from "../lib/auth";
import { z } from "zod";
import { urlMedia, urlImagemMensagem, verificarImagemMensagem } from "../lib/storage";

const sendMessageSchema = z.object({
  tipo: z.enum(["texto", "imagem", "audio", "post_partilhado"]).default("texto"),
  conteudo: z.string().max(4000).optional(),
  // Só para tipo "imagem": URL do nosso CDN de um ficheiro do próprio remetente (validado abaixo).
  mediaUrl: z.string().max(1000).optional(),
});

const router = Router();

const CONVERSATIONS_MAX_LIMIT = 50;

// Lista de conversas (paginada)
router.get("/conversations", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(CONVERSATIONS_MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));
  const offset = (page - 1) * limit;

  const participations = await db.select({ conversationId: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable)
    .where(and(eq(conversationParticipantsTable.utilizadorId, userId), semParticipanteInativo(conversationParticipantsTable.conversationId), semBloqueadoPorMim(userId, conversationParticipantsTable.conversationId)))
    .limit(limit)
    .offset(offset);

  const conversationIds = participations.map(p => p.conversationId);

  if (conversationIds.length === 0) {
    res.json([]);
    return;
  }

  const result = await Promise.all(conversationIds.map(async (convId) => {
    const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, convId));
    const participants = await db.select({ u: usersTable })
      .from(conversationParticipantsTable)
      .innerJoin(usersTable, eq(conversationParticipantsTable.utilizadorId, usersTable.id))
      .where(and(eq(conversationParticipantsTable.conversationId, convId)));

    const [ultima] = await db.select({ m: messagesTable, valorGorjeta: messageTipsTable.valor }).from(messagesTable)
      .leftJoin(messageTipsTable, eq(messageTipsTable.messageId, messagesTable.id))
      .where(eq(messagesTable.conversationId, convId))
      .orderBy(desc(messagesTable.criadoEm))
      .limit(1);
    const lastMsg = ultima?.m;

    const [{ unread }] = await db.select({ unread: sql<number>`count(*)::int` })
      .from(messagesTable)
      .where(and(eq(messagesTable.conversationId, convId), eq(messagesTable.lido, false)));

    return {
      id: convId,
      participantes: participants.map(({ u }) => ({
        id: u.id, username: u.username, nomeExibicao: u.nomeExibicao,
        avatarUrl: urlMedia(u.avatarUrl), verificado: u.verificado, tipoConta: u.tipoConta,
        estaASeguir: false, segueVoce: false, totalSeguidores: 0,
      })),
      tipo: conv?.tipo || "privada",
      ultimaMensagem: lastMsg ? {
        id: lastMsg.id,
        autorId: lastMsg.autorId,
        tipo: lastMsg.tipo,
        conteudo: lastMsg.retiradoEm ? null : lastMsg.conteudo,
        mediaUrl: lastMsg.retiradoEm ? null : urlMedia(lastMsg.mediaUrl),
        lido: lastMsg.lido,
        criadoEm: lastMsg.criadoEm.toISOString(),
        // Gorjeta: só o valor (o front compõe a pré-visualização "Gorjeta de X Kz")
        ...(!lastMsg.retiradoEm && lastMsg.tipo === "gorjeta" && ultima?.valorGorjeta != null ? { gorjeta: { valor: Number(ultima.valorGorjeta) } } : {}),
        ...(lastMsg.retiradoEm ? { retirada: true } : {}),
      } : null,
      totalNaoLidas: unread || 0,
      criadoEm: conv?.criadoEm?.toISOString() || new Date().toISOString(),
    };
  }));

  res.json(result);
});

// Criar conversa (ou devolver a existente)
router.post("/conversations", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const raw = req.body?.participanteId;
  if (raw === undefined || raw === null || raw === "") { res.status(400).json({ error: "participanteId é obrigatório" }); return; }
  const alvoId = Number(raw);
  if (!Number.isInteger(alvoId) || alvoId <= 0) { res.status(400).json({ error: "participanteId inválido" }); return; }
  if (alvoId === userId) { res.status(400).json({ error: "Não podes iniciar uma conversa contigo próprio." }); return; }

  // Não se abre conversa com uma conta inativa (suspensa ou encerrada).
  const [alvo] = await db.select({ ativo: usersTable.ativo }).from(usersTable).where(eq(usersTable.id, alvoId));
  if (!alvo || !alvo.ativo) { res.status(404).json({ error: "Utilizador não encontrado" }); return; }

  // Bloqueio em qualquer sentido: mesma resposta que a conta inativa (não revela o bloqueio).
  const perm = await permissaoMensagem(userId, { destinatarioId: alvoId });
  if (perm.estado === "fui_bloqueado" || perm.estado === "bloqueaste") { res.status(404).json({ error: "Utilizador não encontrado" }); return; }

  const participantesDe = async (conversationId: number) => (await db.select({ u: usersTable })
    .from(conversationParticipantsTable)
    .innerJoin(usersTable, eq(conversationParticipantsTable.utilizadorId, usersTable.id))
    .where(eq(conversationParticipantsTable.conversationId, conversationId)))
    .map(({ u }) => ({ id: u.id, username: u.username, nomeExibicao: u.nomeExibicao, avatarUrl: urlMedia(u.avatarUrl), verificado: u.verificado, tipoConta: u.tipoConta, estaASeguir: false, segueVoce: false, totalSeguidores: 0 }));

  // Conversa já existente com este participante (uma só consulta): devolve-a, mesmo que a regra impeça novos envios (modo leitura).
  const cpAlvo = alias(conversationParticipantsTable, "cp_alvo");
  const [existente] = await db.select({ id: conversationsTable.id, tipo: conversationsTable.tipo, criadoEm: conversationsTable.criadoEm })
    .from(conversationParticipantsTable)
    .innerJoin(cpAlvo, eq(cpAlvo.conversationId, conversationParticipantsTable.conversationId))
    .innerJoin(conversationsTable, eq(conversationsTable.id, conversationParticipantsTable.conversationId))
    .where(and(eq(conversationParticipantsTable.utilizadorId, userId), eq(cpAlvo.utilizadorId, alvoId), eq(conversationsTable.tipo, "privada")))
    .limit(1);
  if (existente) {
    res.json({
      id: existente.id,
      participantes: await participantesDe(existente.id),
      tipo: existente.tipo,
      ultimaMensagem: null,
      totalNaoLidas: 0,
      criadoEm: existente.criadoEm.toISOString(),
    });
    return;
  }

  // Conversa nova: aplica-se a regra de quem pode escrever
  if (perm.estado === "regra") {
    res.status(403).json({ error: textoRegra(perm), codigo: "mensagens_restritas", regra: perm.regra });
    return;
  }

  const conv = await db.transaction(async (tx) => {
    const [c] = await tx.insert(conversationsTable).values({ tipo: "privada" }).returning();
    await tx.insert(conversationParticipantsTable).values([{ conversationId: c.id, utilizadorId: userId }, { conversationId: c.id, utilizadorId: alvoId }]);
    return c;
  });

  res.status(201).json({
    id: conv.id,
    participantes: await participantesDe(conv.id),
    tipo: conv.tipo,
    ultimaMensagem: null,
    totalNaoLidas: 0,
    criadoEm: conv.criadoEm.toISOString(),
  });
});

// Contagem de conversas com mensagens não lidas (enviadas por outros)
router.get("/conversations/unread-count", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;

  // Contar mensagens não lidas enviadas por outros utilizadores, em conversas onde o user participa
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(messagesTable)
    .innerJoin(conversationParticipantsTable, eq(messagesTable.conversationId, conversationParticipantsTable.conversationId))
    .where(and(
      eq(conversationParticipantsTable.utilizadorId, userId),
      eq(messagesTable.lido, false),
      sql`${messagesTable.autorId} != ${userId}`,
      semParticipanteInativo(messagesTable.conversationId),
      semBloqueadoPorMim(userId, messagesTable.conversationId),
    ));

  res.json({ count: count || 0 });
});

/** Conversa com um participante inativo (conta suspensa ou encerrada): fica invisível e não aceita mensagens. */
async function temParticipanteInativo(conversationId: number): Promise<boolean> {
  const r = await db.select({ id: conversationParticipantsTable.utilizadorId }).from(conversationParticipantsTable)
    .innerJoin(usersTable, eq(conversationParticipantsTable.utilizadorId, usersTable.id))
    .where(and(eq(conversationParticipantsTable.conversationId, conversationId), eq(usersTable.ativo, false)))
    .limit(1);
  return r.length > 0;
}

/** SQL: a conversa (coluna) NÃO tem participantes inativos. */
const semParticipanteInativo = (col: unknown) => sql`NOT EXISTS (SELECT 1 FROM conversation_participants cp2 JOIN users u2 ON u2.id = cp2.utilizador_id WHERE cp2.conversation_id = ${col} AND NOT u2.ativo)`;

/** SQL: a conversa (coluna) NÃO tem um participante que EU bloqueei (o bloqueado continua a ver as conversas). */
const semBloqueadoPorMim = (userId: number, col: unknown) => sql`NOT EXISTS (SELECT 1 FROM user_blocks ub JOIN conversation_participants cp3 ON cp3.utilizador_id = ub.blocked_id WHERE ub.blocker_id = ${userId} AND cp3.conversation_id = ${col})`;

/** Verifica se o utilizador é participante da conversa */
async function verificarParticipante(conversationId: number, userId: number): Promise<boolean> {
  const [p] = await db.select({ id: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable)
    .where(and(
      eq(conversationParticipantsTable.conversationId, conversationId),
      eq(conversationParticipantsTable.utilizadorId, userId),
    ))
    .limit(1);
  return !!p;
}

// Mensagens de uma conversa
router.get("/conversations/:id/messages", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  // IDOR: verificar que o utilizador é participante desta conversa
  if (!(await verificarParticipante(id, req.userId!))) {
    res.status(403).json({ error: "Sem acesso a esta conversa" });
    return;
  }
  if (await temParticipanteInativo(id)) { res.status(404).json({ error: "Conversa indisponível." }); return; }
  const perm = await permissaoMensagem(req.userId!, { conversationId: id });

  const messages = await db.select({ m: messagesTable, u: usersTable, valorGorjeta: messageTipsTable.valor })
    .from(messagesTable)
    .innerJoin(usersTable, eq(messagesTable.autorId, usersTable.id))
    .leftJoin(messageTipsTable, eq(messageTipsTable.messageId, messagesTable.id))
    .where(eq(messagesTable.conversationId, id))
    .orderBy(desc(messagesTable.criadoEm))
    .limit(50);

  res.json({
    messages: messages.reverse().map(({ m, u, valorGorjeta }) => ({
      id: m.id,
      autorId: m.autorId,
      autor: { id: u.id, username: u.username, nomeExibicao: u.nomeExibicao, avatarUrl: urlMedia(u.avatarUrl), verificado: u.verificado, tipoConta: u.tipoConta, estaASeguir: false, segueVoce: false, totalSeguidores: 0 },
      tipo: m.tipo,
      // Mensagem retirada pela moderação: texto, imagem e gorjeta ficam ocultos (a conversa mantém-se)
      conteudo: m.retiradoEm ? null : m.conteudo,
      mediaUrl: m.retiradoEm ? null : urlMedia(m.mediaUrl),
      lido: m.lido,
      criadoEm: m.criadoEm.toISOString(),
      // Gorjeta: só o valor (nunca saldo nem comissão)
      ...(!m.retiradoEm && m.tipo === "gorjeta" && valorGorjeta != null ? { gorjeta: { valor: Number(valorGorjeta) } } : {}),
      ...(m.retiradoEm ? { retirada: true } : {}),
    })),
    page: 1,
    hasMore: false,
    // Sem pedido novo: o composer sabe se pode enviar. O bloqueio nunca é revelado a quem foi bloqueado (restricao null).
    podeEnviar: perm.pode,
    restricao: perm.estado === "regra" ? "regra" : perm.estado === "bloqueaste" ? "bloqueaste" : null,
  });
});

// Marcar como lidas as mensagens recebidas numa conversa
router.patch("/conversations/:id/read", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  if (!(await verificarParticipante(id, req.userId!))) {
    res.status(403).json({ error: "Sem acesso a esta conversa" });
    return;
  }

  await db.update(messagesTable)
    .set({ lido: true })
    .where(and(
      eq(messagesTable.conversationId, id),
      eq(messagesTable.lido, false),
      sql`${messagesTable.autorId} != ${req.userId!}`,
    ));

  res.json({ ok: true });
});

// Enviar mensagem
router.post("/conversations/:id/messages", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  // IDOR: verificar que o utilizador é participante desta conversa
  if (!(await verificarParticipante(id, req.userId!))) {
    res.status(403).json({ error: "Sem acesso a esta conversa" });
    return;
  }
  if (await temParticipanteInativo(id)) { res.status(404).json({ error: "Conversa indisponível." }); return; }

  // Bloqueio e regra de quem pode escrever (avaliados a cada envio; o histórico não é afetado)
  const perm = await permissaoMensagem(req.userId!, { conversationId: id });
  if (perm.estado === "fui_bloqueado") { res.status(404).json({ error: "Conversa indisponível." }); return; } // igual à conta inativa
  if (perm.estado === "bloqueaste") { res.status(403).json({ error: TEXTO_BLOQUEASTE, codigo: "bloqueaste" }); return; }
  if (perm.estado === "regra") { res.status(403).json({ error: textoRegra(perm), codigo: "mensagens_restritas", regra: perm.regra }); return; }

  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Input inválido", detalhes: parsed.error.flatten().fieldErrors });
    return;
  }
  const { tipo, conteudo, mediaUrl } = parsed.data;

  // Imagem: exige mediaUrl; qualquer outro tipo não aceita mediaUrl.
  let mediaGuardada: string | null = null;
  if (tipo === "imagem") {
    if (!mediaUrl) { res.status(400).json({ error: "A imagem é obrigatória." }); return; }
    const canonico = urlImagemMensagem(mediaUrl, req.userId!);
    if (!canonico) { res.status(400).json({ error: "Imagem inválida." }); return; }
    const estado = await verificarImagemMensagem(canonico);
    if (estado === "grande") { res.status(400).json({ error: "A imagem excede o limite de 10 MB." }); return; }
    if (estado !== "ok") { res.status(400).json({ error: "Imagem inválida ou indisponível." }); return; }
    mediaGuardada = canonico;
  } else if (mediaUrl !== undefined) {
    res.status(400).json({ error: "Este tipo de mensagem não aceita imagem." });
    return;
  }

  const [msg] = await db.insert(messagesTable).values({
    conversationId: id,
    autorId: req.userId!,
    tipo,
    conteudo: conteudo ?? null,
    mediaUrl: mediaGuardada,
  }).returning();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));

  res.status(201).json({
    id: msg.id,
    autorId: msg.autorId,
    autor: { id: user.id, username: user.username, nomeExibicao: user.nomeExibicao, avatarUrl: urlMedia(user.avatarUrl), verificado: user.verificado, tipoConta: user.tipoConta, estaASeguir: false, segueVoce: false, totalSeguidores: 0 },
    tipo: msg.tipo,
    conteudo: msg.conteudo,
    mediaUrl: urlMedia(msg.mediaUrl),
    lido: msg.lido,
    criadoEm: msg.criadoEm.toISOString(),
  });
});

/**
 * POST /api/conversations/:id/gorjeta  { valor: inteiro (50 a 100 000 Kz), mensagem?: ≤ 255, chave: 16-64 [A-Za-z0-9_-] }
 * Gorjeta a um criador dentro da conversa: debita a carteira do remetente, credita os ganhos do criador menos a comissão e cria uma
 * mensagem tipo 'gorjeta'. Atómica e idempotente (mesma chave = mesma mensagem, 200; outro pedido com a chave = 409). Ver lib/gorjetaMensagem.ts.
 */
router.post("/conversations/:id/gorjeta", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const remetenteId = req.userId!;

  if (!(await verificarParticipante(id, remetenteId))) { res.status(403).json({ error: "Sem acesso a esta conversa" }); return; }
  if (await temParticipanteInativo(id)) { res.status(404).json({ error: "Conversa indisponível." }); return; }

  // Bloqueio, regra, admin, auto-gorjeta e destinatário (os mesmos códigos e textos do envio de mensagens)
  const perm = await permissaoMensagem(remetenteId, { conversationId: id });
  const erroPerm = erroDePermissaoGorjeta(perm, remetenteId);
  if (erroPerm) { res.status(erroPerm.httpStatus).json({ error: erroPerm.message, ...(erroPerm.codigo ? { codigo: erroPerm.codigo } : {}), ...(erroPerm.extra ?? {}) }); return; }

  const b = (req.body ?? {}) as Record<string, unknown>;
  const { valor, mensagem, chave } = b;
  if (typeof valor !== "number" || !Number.isFinite(valor) || !Number.isInteger(valor)) { res.status(400).json({ error: "O valor da gorjeta tem de ser um número inteiro de Kz.", codigo: "valor_invalido" }); return; }
  if (valor < GORJETA_MENSAGEM.MIN_KZ) { res.status(400).json({ error: `O valor mínimo da gorjeta é ${formatarKz(GORJETA_MENSAGEM.MIN_KZ)} Kz.`, codigo: "valor_invalido" }); return; }
  if (valor > GORJETA_MENSAGEM.MAX_KZ) { res.status(400).json({ error: `O valor máximo por gorjeta é ${formatarKz(GORJETA_MENSAGEM.MAX_KZ)} Kz.`, codigo: "valor_invalido" }); return; }
  if (typeof chave !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(chave)) { res.status(400).json({ error: "Chave de idempotência inválida.", codigo: "chave_invalida" }); return; }
  if (mensagem !== undefined && mensagem !== null && typeof mensagem !== "string") { res.status(400).json({ error: "Mensagem inválida." }); return; }
  const texto = typeof mensagem === "string" ? mensagem.trim() : "";
  if (texto.length > GORJETA_MENSAGEM.MENSAGEM_MAX) { res.status(400).json({ error: `A mensagem da gorjeta pode ter no máximo ${GORJETA_MENSAGEM.MENSAGEM_MAX} caracteres.` }); return; }

  try {
    const r = await enviarGorjetaMensagem({ remetenteId, destinatarioId: perm.destinatarioId!, conversationId: id, valor, mensagem: texto || null, chave });
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, remetenteId));
    res.status(r.criada ? 201 : 200).json({
      id: r.mensagem.id,
      autorId: r.mensagem.autorId,
      autor: { id: user.id, username: user.username, nomeExibicao: user.nomeExibicao, avatarUrl: urlMedia(user.avatarUrl), verificado: user.verificado, tipoConta: user.tipoConta, estaASeguir: false, segueVoce: false, totalSeguidores: 0 },
      tipo: r.mensagem.tipo,
      conteudo: r.mensagem.conteudo,
      mediaUrl: null,
      lido: r.mensagem.lido,
      criadoEm: r.mensagem.criadoEm.toISOString(),
      gorjeta: { valor: r.valor },
    });
  } catch (err) {
    if (err instanceof GorjetaErro) { res.status(err.httpStatus).json({ error: err.message, ...(err.codigo ? { codigo: err.codigo } : {}), ...(err.extra ?? {}) }); return; }
    if (err instanceof CommissionNotConfiguredError) {
      req.log?.error({ motivo: err.motivo }, "Comissão não configurada: gorjeta recusada, nada foi cobrado");
      res.status(503).json({ error: err.message });
      return;
    }
    req.log?.error({ err }, "Gorjeta em mensagem: erro");
    res.status(500).json({ error: "Erro interno." });
  }
});

/**
 * POST /api/conversations/:id/denunciar  { mensagemId, motivo, descricao? }
 * Denuncia uma mensagem do OUTRO participante. Só participantes; a mensagem tem de ser da conversa; nunca as tuas. Mesmo limitador (10/h) e
 * mesma unicidade por denunciante que as outras denúncias. Congela a prova: a mensagem, até 20 antes e 20 depois (dos dois lados) e cópias
 * privadas das imagens (provas/<denúncia>/…). Se a cópia falhar a denúncia cria-se na mesma (copiaEstado 'falhou' no snapshot).
 * Motivo 'menor': urgente, alerta os admins e a mensagem é retirada (escondida, nunca apagada) até haver decisão.
 */
router.post("/conversations/:id/denunciar", requireAuth, limiteUtilizador, validate(denunciaMensagemSchema), async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const reporterId = req.userId!;
  const { mensagemId, motivo, descricao } = req.body as { mensagemId: number; motivo: string; descricao?: string };

  if (!(await verificarParticipante(id, reporterId))) { res.status(403).json({ error: "Sem acesso a esta conversa" }); return; }

  const [m] = await db.select({ id: messagesTable.id, autorId: messagesTable.autorId, retiradoEm: messagesTable.retiradoEm }).from(messagesTable)
    .where(and(eq(messagesTable.id, mensagemId), eq(messagesTable.conversationId, id))).limit(1);
  if (!m) { res.status(404).json({ error: "Mensagem não encontrada." }); return; }
  if (m.autorId === reporterId) { res.status(400).json({ error: "Não podes denunciar o teu próprio conteúdo." }); return; }
  if (m.retiradoEm) { res.status(404).json({ error: "Conteúdo indisponível." }); return; }
  // Verificações baratas ANTES de copiar imagens (a transação repete-as com a linha bloqueada)
  const [jaDenunciou] = await db.select({ id: reportsTable.id }).from(reportsTable)
    .where(and(eq(reportsTable.reporterId, reporterId), eq(reportsTable.targetType, "mensagem"), eq(reportsTable.targetId, m.id))).limit(1);
  if (jaDenunciou) { res.status(409).json({ error: "Já denunciaste este conteúdo." }); return; }

  const [{ id: reportId }] = (await db.execute(sql`SELECT nextval(pg_get_serial_sequence('reports', 'id'))::int AS id`)).rows as { id: number }[];
  const prova = await prepararProvaMensagem({ conversationId: id, mensagemId: m.id, donoId: m.autorId, reportId });
  try {
    const r = await criarDenuncia({
      reporterId, targetType: "mensagem", targetId: m.id, reason: motivo, description: descricao, autoRetirar: true,
      reportId, snapshotPronto: prova.snapshot,
    });
    res.status(201).json({ id: r.id, retiradoTemporariamente: r.retiradoAuto });
  } catch (err) {
    await apagarCopiasDeProva(prova.copias); // a denúncia não foi criada: não ficam cópias órfãs
    tratarErro(err, res, req.log);
  }
});

export default router;
