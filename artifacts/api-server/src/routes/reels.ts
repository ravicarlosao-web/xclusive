import { Router } from "express";
import { db, reelsTable, likesTable, commentsTable, usersTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, type AuthRequest } from "../lib/auth";
import { validate } from "../lib/validate";
import { comInfracaoAtiva } from "../lib/infracoesMais18";
import { temSubscricaoAtiva } from "../lib/exclusiveAccess";
import { reelVisivel } from "../lib/takedown";
import {
  lerVisualizador, reelPermitido, reelBloqueado, bloqueadoMais18, CODIGO_CONTEUDO_MAIS18, MSG_CONTEUDO_MAIS18,
  lerMarcacaoMais18, MSG_MAIS18_INVALIDO,
} from "../lib/conteudoMais18";
import { urlMedia, urlCanonico } from "../lib/storage";

const router = Router();

// Feed de reels
router.get("/reels", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const page = Math.max(1, parseInt(String(req.query.page || "1")));
  const limit = Math.min(20, parseInt(String(req.query.limit || "10")));
  const offset = (page - 1) * limit;

  const visualizador = await lerVisualizador(req.userId);
  const reels = await db.select().from(reelsTable).where(and(reelVisivel(), reelPermitido(visualizador))).orderBy(desc(reelsTable.criadoEm)).limit(limit).offset(offset);

  const result = await Promise.all(reels.map(r => formatReel(r, req.userId)));
  res.json({ reels: result, page, hasMore: result.length === limit });
});

// Criar reel
router.post("/reels", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { videoUrl, capaUrl, legenda, exclusivo } = req.body;
  if (!videoUrl) { res.status(400).json({ error: "videoUrl é obrigatório" }); return; }
  const marcacao = lerMarcacaoMais18(req.body.mais18);
  if (!marcacao.ok) { res.status(400).json({ error: MSG_MAIS18_INVALIDO }); return; }

  const [reel] = await db.insert(reelsTable).values({
    autorId: req.userId!,
    videoUrl: urlCanonico(String(videoUrl)),
    capaUrl: capaUrl ? urlCanonico(String(capaUrl)) : null,
    legenda: legenda || null,
    exclusivo: exclusivo || false,
    mais18: marcacao.mais18,
  }).returning();

  res.status(201).json(await formatReel(reel, req.userId));
});

// Obter reel
router.get("/reels/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [reel] = await db.select().from(reelsTable).where(and(eq(reelsTable.id, id), reelVisivel()));
  if (!reel) { res.status(404).json({ error: "Não encontrado" }); return; }
  if (bloqueadoMais18(await lerVisualizador(req.userId), reel)) { res.status(403).json({ error: MSG_CONTEUDO_MAIS18, codigo: CODIGO_CONTEUDO_MAIS18 }); return; }
  res.json(await formatReel(reel, req.userId));
});

// Editar a marcação +18 de um reel PRÓPRIO (só muda mais18; igual a PATCH /posts/:id/mais18).
const editarMais18Schema = z.object({ mais18: z.boolean({ error: "O campo mais18 é obrigatório e tem de ser verdadeiro ou falso." }) }).strict();
router.patch("/reels/:id/mais18", requireAuth, validate(editarMais18Schema), async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "ID inválido." }); return; }
  const [reel] = await db.select({ autorId: reelsTable.autorId }).from(reelsTable).where(eq(reelsTable.id, id)).limit(1);
  if (!reel) { res.status(404).json({ error: "Reel não encontrado." }); return; }
  if (reel.autorId !== req.userId) { res.status(403).json({ error: "Só a autora pode alterar a marcação +18 do seu reel." }); return; }
  const novo: boolean = req.body.mais18;
  // Desmarcar: não é permitido se o admin registou uma infração ativa neste reel. O lock da linha da criadora serializa
  // com o admin (que a bloqueia primeiro): ou a infração já está visível aqui, ou o admin espera por esta transação.
  const r = await db.transaction(async (tx) => {
    if (!novo) {
      await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, req.userId!)).for("update");
      if ((await comInfracaoAtiva(tx, "reel", [id])).has(id)) return null;
    }
    const [atualizado] = await tx.update(reelsTable).set({ mais18: novo }).where(and(eq(reelsTable.id, id), eq(reelsTable.autorId, req.userId!))).returning({ id: reelsTable.id, mais18: reelsTable.mais18 });
    return atualizado;
  });
  if (!r) { res.status(403).json({ error: "Este reel foi marcado como +18 pela equipa e não pode ser desmarcado por ti.", codigo: "mais18_bloqueado" }); return; }
  res.json(r);
});

// Curtir reel
router.post("/reels/:id/like", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (await reelBloqueado(id, await lerVisualizador(req.userId))) { res.status(404).json({ error: "Não encontrado" }); return; }
  const [existing] = await db.select().from(likesTable).where(and(eq(likesTable.utilizadorId, req.userId!), eq(likesTable.alvoTipo, "reel"), eq(likesTable.alvoId, id)));
  if (!existing) {
    await db.insert(likesTable).values({ utilizadorId: req.userId!, alvoTipo: "reel", alvoId: id });
  }
  res.json({ ok: true });
});

// Remover curtida reel
router.delete("/reels/:id/like", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  await db.delete(likesTable).where(and(eq(likesTable.utilizadorId, req.userId!), eq(likesTable.alvoTipo, "reel"), eq(likesTable.alvoId, id)));
  res.json({ ok: true });
});

async function formatReel(reel: any, userId?: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, reel.autorId));
  const [{ likes }] = await db.select({ likes: sql<number>`count(*)::int` }).from(likesTable).where(and(eq(likesTable.alvoTipo, "reel"), eq(likesTable.alvoId, reel.id)));
  const [{ comments }] = await db.select({ comments: sql<number>`count(*)::int` }).from(commentsTable).where(eq(commentsTable.postId, reel.id));
  let curtido = false;
  if (userId) {
    const [like] = await db.select().from(likesTable).where(and(eq(likesTable.utilizadorId, userId), eq(likesTable.alvoTipo, "reel"), eq(likesTable.alvoId, reel.id)));
    curtido = !!like;
  }

  // Conteúdo exclusivo: ocultar URLs se utilizador não tem subscrição
  const acesso = reel.exclusivo ? await temSubscricaoAtiva(userId, reel.autorId) : true;

  return {
    id: reel.id,
    autor: user ? {
      id: user.id, username: user.username, nomeExibicao: user.nomeExibicao,
      avatarUrl: urlMedia(user.avatarUrl), verificado: user.verificado, tipoConta: user.tipoConta,
      estaASeguir: false, segueVoce: false, totalSeguidores: 0,
    } : null,
    videoUrl: acesso ? urlMedia(reel.videoUrl) : null,
    capaUrl: acesso ? urlMedia(reel.capaUrl) : null,
    legenda: reel.legenda,
    somTitulo: reel.somTitulo,
    somArtista: reel.somArtista,
    exclusivo: reel.exclusivo,
    mais18: reel.mais18,
    // A criadora não pode desmarcar este reel (infração +18 ativa)
    mais18Bloqueado: reel.autorId === userId ? (await comInfracaoAtiva(db, "reel", [reel.id])).has(reel.id) : false,
    bloqueado: reel.exclusivo && !acesso,
    totalCurtidas: likes || 0,
    totalComentarios: comments || 0,
    curtido,
    guardado: false,
    criadoEm: reel.criadoEm.toISOString(),
  };
}

export default router;
