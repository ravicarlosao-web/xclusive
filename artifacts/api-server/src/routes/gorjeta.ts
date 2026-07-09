import { Router } from "express";
import { db, purchasesTable, usersTable, postsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../lib/auth";

const router = Router();

/**
 * POST /api/posts/:postId/gorjeta
 * Body: { valor: number }
 * Sends a tip from the authenticated user to the post's author.
 */
router.post("/posts/:postId/gorjeta", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const postId = parseInt(req.params['postId'] as string, 10);
  const { valor } = req.body as { valor?: number };
  const senderId = req.userId!;

  if (!valor || valor <= 0 || !Number.isFinite(valor)) {
    res.status(400).json({ error: "Valor de gorjeta inválido." });
    return;
  }

  try {
    const [post] = await db
      .select({ autorId: postsTable.autorId })
      .from(postsTable)
      .where(eq(postsTable.id, postId))
      .limit(1);

    if (!post) { res.status(404).json({ error: "Post não encontrado." }); return; }
    if (post.autorId === senderId) { res.status(400).json({ error: "Não podes dar gorjeta ao teu próprio post." }); return; }

    const [purchase] = await db
      .insert(purchasesTable)
      .values({
        compradorId: senderId,
        vendedorId: post.autorId,
        tipo: "gorjeta",
        valor: String(valor),
        conteudoId: postId,
        descricao: `Gorjeta ao post #${postId}`,
      })
      .returning();

    res.status(201).json({ purchase });
  } catch (err) {
    req.log.error({ err }, "Gorjeta error");
    res.status(500).json({ error: "Erro interno." });
  }
});

/**
 * GET /api/users/:username/gorjetas
 * Returns the total tips received by a creator.
 */
router.get("/users/:username/gorjetas", async (req, res): Promise<void> => {
  try {
    const [creator] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.username, req.params.username))
      .limit(1);

    if (!creator) { res.status(404).json({ error: "Utilizador não encontrado." }); return; }

    const gorjetas = await db
      .select()
      .from(purchasesTable)
      .where(and(eq(purchasesTable.vendedorId, creator.id), eq(purchasesTable.tipo, "gorjeta")))
      .orderBy(purchasesTable.criadoEm);

    const total = gorjetas.reduce((sum: number, g) => sum + Number(g.valor), 0);
    res.json({ gorjetas, total, count: gorjetas.length });
  } catch (err) {
    req.log.error({ err }, "Get gorjetas error");
    res.status(500).json({ error: "Erro interno." });
  }
});

export default router;
