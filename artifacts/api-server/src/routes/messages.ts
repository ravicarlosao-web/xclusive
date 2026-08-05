import { Router } from "express";
import { db, conversationsTable, conversationParticipantsTable, messagesTable, usersTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../lib/auth";
import { z } from "zod";

const sendMessageSchema = z.object({
  tipo: z.enum(["texto", "imagem", "audio", "post_partilhado"]).default("texto"),
  conteudo: z.string().max(4000).optional(),
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
    .where(eq(conversationParticipantsTable.utilizadorId, userId))
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

    const [lastMsg] = await db.select().from(messagesTable)
      .where(eq(messagesTable.conversationId, convId))
      .orderBy(desc(messagesTable.criadoEm))
      .limit(1);

    const [{ unread }] = await db.select({ unread: sql<number>`count(*)::int` })
      .from(messagesTable)
      .where(and(eq(messagesTable.conversationId, convId), eq(messagesTable.lido, false)));

    return {
      id: convId,
      participantes: participants.map(({ u }) => ({
        id: u.id, username: u.username, nomeExibicao: u.nomeExibicao,
        avatarUrl: u.avatarUrl, verificado: u.verificado, tipoConta: u.tipoConta,
        estaASeguir: false, segueVoce: false, totalSeguidores: 0,
      })),
      tipo: conv?.tipo || "privada",
      ultimaMensagem: lastMsg ? {
        id: lastMsg.id,
        autorId: lastMsg.autorId,
        tipo: lastMsg.tipo,
        conteudo: lastMsg.conteudo,
        mediaUrl: lastMsg.mediaUrl,
        lido: lastMsg.lido,
        criadoEm: lastMsg.criadoEm.toISOString(),
      } : null,
      totalNaoLidas: unread || 0,
      criadoEm: conv?.criadoEm?.toISOString() || new Date().toISOString(),
    };
  }));

  res.json(result);
});

// Criar conversa
router.post("/conversations", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const { participanteId } = req.body;

  if (!participanteId) { res.status(400).json({ error: "participanteId é obrigatório" }); return; }

  // Verificar se já existe
  const myConvs = await db.select({ conversationId: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.utilizadorId, userId));

  for (const { conversationId } of myConvs) {
    const [existing] = await db.select()
      .from(conversationParticipantsTable)
      .where(and(eq(conversationParticipantsTable.conversationId, conversationId), eq(conversationParticipantsTable.utilizadorId, participanteId)));
    if (existing) {
      const [conv] = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId));
      const participants = await db.select({ u: usersTable })
        .from(conversationParticipantsTable)
        .innerJoin(usersTable, eq(conversationParticipantsTable.utilizadorId, usersTable.id))
        .where(eq(conversationParticipantsTable.conversationId, conversationId));
      res.json({
        id: conversationId,
        participantes: participants.map(({ u }) => ({ id: u.id, username: u.username, nomeExibicao: u.nomeExibicao, avatarUrl: u.avatarUrl, verificado: u.verificado, tipoConta: u.tipoConta, estaASeguir: false, segueVoce: false, totalSeguidores: 0 })),
        tipo: conv?.tipo || "privada",
        ultimaMensagem: null,
        totalNaoLidas: 0,
        criadoEm: conv?.criadoEm?.toISOString() || new Date().toISOString(),
      });
      return;
    }
  }

  const [conv] = await db.insert(conversationsTable).values({ tipo: "privada" }).returning();
  await db.insert(conversationParticipantsTable).values({ conversationId: conv.id, utilizadorId: userId });
  await db.insert(conversationParticipantsTable).values({ conversationId: conv.id, utilizadorId: participanteId });

  const participants = await db.select({ u: usersTable })
    .from(conversationParticipantsTable)
    .innerJoin(usersTable, eq(conversationParticipantsTable.utilizadorId, usersTable.id))
    .where(eq(conversationParticipantsTable.conversationId, conv.id));

  res.status(201).json({
    id: conv.id,
    participantes: participants.map(({ u }) => ({ id: u.id, username: u.username, nomeExibicao: u.nomeExibicao, avatarUrl: u.avatarUrl, verificado: u.verificado, tipoConta: u.tipoConta, estaASeguir: false, segueVoce: false, totalSeguidores: 0 })),
    tipo: conv.tipo,
    ultimaMensagem: null,
    totalNaoLidas: 0,
    criadoEm: conv.criadoEm.toISOString(),
  });
});

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

  const messages = await db.select({ m: messagesTable, u: usersTable })
    .from(messagesTable)
    .innerJoin(usersTable, eq(messagesTable.autorId, usersTable.id))
    .where(eq(messagesTable.conversationId, id))
    .orderBy(desc(messagesTable.criadoEm))
    .limit(50);

  res.json({
    messages: messages.reverse().map(({ m, u }) => ({
      id: m.id,
      autorId: m.autorId,
      autor: { id: u.id, username: u.username, nomeExibicao: u.nomeExibicao, avatarUrl: u.avatarUrl, verificado: u.verificado, tipoConta: u.tipoConta, estaASeguir: false, segueVoce: false, totalSeguidores: 0 },
      tipo: m.tipo,
      conteudo: m.conteudo,
      mediaUrl: m.mediaUrl,
      lido: m.lido,
      criadoEm: m.criadoEm.toISOString(),
    })),
    page: 1,
    hasMore: false,
  });
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

  const parsed = sendMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Input inválido", detalhes: parsed.error.flatten().fieldErrors });
    return;
  }
  const { tipo, conteudo } = parsed.data;

  const [msg] = await db.insert(messagesTable).values({
    conversationId: id,
    autorId: req.userId!,
    tipo,
    conteudo: conteudo ?? null,
  }).returning();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!));

  res.status(201).json({
    id: msg.id,
    autorId: msg.autorId,
    autor: { id: user.id, username: user.username, nomeExibicao: user.nomeExibicao, avatarUrl: user.avatarUrl, verificado: user.verificado, tipoConta: user.tipoConta, estaASeguir: false, segueVoce: false, totalSeguidores: 0 },
    tipo: msg.tipo,
    conteudo: msg.conteudo,
    mediaUrl: msg.mediaUrl,
    lido: msg.lido,
    criadoEm: msg.criadoEm.toISOString(),
  });
});

export default router;
