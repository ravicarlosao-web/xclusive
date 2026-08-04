import { Router } from "express";
import { db, purchasesTable, usersTable, postsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, type AuthRequest } from "../lib/auth";
import { validate } from "../lib/validate";

const router = Router();

/** Erros de pagamento lançados dentro de transações — capturados no handler externo. */
class PaymentError extends Error {
  constructor(msg: string, public readonly httpStatus: number) {
    super(msg);
    this.name = "PaymentError";
  }
}

const gorjetaSchema = z.object({
  valor: z
    .number({ error: "Valor deve ser um número" })
    .positive("Valor deve ser positivo")
    .finite()
    .max(10_000_000, "Valor demasiado elevado"),
});

/**
 * POST /api/posts/:postId/gorjeta
 * Body: { valor: number }
 *
 * Debita o saldo do remetente e credita os ganhos do criador dentro da mesma
 * transação atómica. Um SELECT … FOR UPDATE no remetente garante que pedidos
 * simultâneos do mesmo utilizador são serializados — evita double-spend.
 */
router.post("/posts/:postId/gorjeta", requireAuth, validate(gorjetaSchema), async (req: AuthRequest, res): Promise<void> => {
  const postId = parseInt(req.params['postId'] as string, 10);
  const { valor } = req.body as { valor: number };
  const senderId = req.userId!;

  try {
    // Leitura do post fora da transação — não precisa de lock (só leitura).
    const [post] = await db
      .select({ autorId: postsTable.autorId })
      .from(postsTable)
      .where(eq(postsTable.id, postId))
      .limit(1);

    if (!post) { res.status(404).json({ error: "Post não encontrado." }); return; }
    if (post.autorId === senderId) { res.status(400).json({ error: "Não podes dar gorjeta ao teu próprio post." }); return; }

    const purchase = await db.transaction(async (tx) => {
      // 1. Bloquear linha do remetente (FOR UPDATE) para serializar pedidos concorrentes.
      const [sender] = await tx
        .select({ saldo: usersTable.saldo })
        .from(usersTable)
        .where(eq(usersTable.id, senderId))
        .for("update");

      if (!sender) throw new PaymentError("Utilizador não encontrado.", 404);

      // 2. Verificar saldo suficiente.
      if (Number(sender.saldo) < valor) {
        throw new PaymentError("Saldo insuficiente para enviar esta gorjeta.", 402);
      }

      // 3. Debitar saldo do remetente.
      await tx
        .update(usersTable)
        .set({ saldo: sql`${usersTable.saldo} - ${valor}` })
        .where(eq(usersTable.id, senderId));

      // 4. Creditar ganhos do criador.
      await tx
        .update(usersTable)
        .set({ ganhos: sql`${usersTable.ganhos} + ${valor}` })
        .where(eq(usersTable.id, post.autorId));

      // 5. Registar transação de compra.
      const [p] = await tx
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

      return p;
    });

    res.status(201).json({ purchase });
  } catch (err) {
    if (err instanceof PaymentError) {
      res.status(err.httpStatus).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Gorjeta error");
    res.status(500).json({ error: "Erro interno." });
  }
});

/**
 * GET /api/users/:username/gorjetas
 * Criador autenticado: recebe histórico completo (sem dados do comprador).
 * Outros utilizadores autenticados: recebe apenas total agregado.
 * Sem autenticação: 401.
 */
router.get("/users/:username/gorjetas", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const [creator] = await db
      .select({ id: usersTable.id, username: usersTable.username })
      .from(usersTable)
      .where(eq(usersTable.username, req.params.username))
      .limit(1);

    if (!creator) { res.status(404).json({ error: "Utilizador não encontrado." }); return; }

    const gorjetas = await db
      .select({
        id: purchasesTable.id,
        valor: purchasesTable.valor,
        conteudoId: purchasesTable.conteudoId,
        descricao: purchasesTable.descricao,
        criadoEm: purchasesTable.criadoEm,
      })
      .from(purchasesTable)
      .where(and(eq(purchasesTable.vendedorId, creator.id), eq(purchasesTable.tipo, "gorjeta")))
      .orderBy(purchasesTable.criadoEm);

    const total = gorjetas.reduce((sum: number, g) => sum + Number(g.valor), 0);

    // Apenas o próprio criador vê o histórico detalhado; outros só veem o agregado
    if (req.userId === creator.id) {
      res.json({ gorjetas, total, count: gorjetas.length });
    } else {
      res.json({ total, count: gorjetas.length });
    }
  } catch (err) {
    req.log.error({ err }, "Get gorjetas error");
    res.status(500).json({ error: "Erro interno." });
  }
});

export default router;
