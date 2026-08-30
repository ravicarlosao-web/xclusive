import { Router } from "express";
import { db, purchasesTable, usersTable, postsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, type AuthRequest } from "../lib/auth";
import { validate } from "../lib/validate";
import { getCommissionRate, calcComissao } from "../lib/commission";

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

      // 2b. Ler taxa de comissão activa (FOR SHARE — impede alteração durante a transação).
      const commissionRate = await getCommissionRate(tx, post.autorId);
      const { valorCriador, comissao } = calcComissao(valor, commissionRate);

      // 3. Debitar saldo do remetente (valor total — o fã paga sempre o valor cheio).
      await tx
        .update(usersTable)
        .set({ saldo: sql`${usersTable.saldo} - ${valor}` })
        .where(eq(usersTable.id, senderId));

      // 4. Creditar ganhos do criador (apenas a sua parte líquida após comissão).
      await tx
        .update(usersTable)
        .set({ ganhos: sql`${usersTable.ganhos} + ${valorCriador}` })
        .where(eq(usersTable.id, post.autorId));

      // 5. Registar transação com comissão da plataforma gravada.
      const [p] = await tx
        .insert(purchasesTable)
        .values({
          compradorId: senderId,
          vendedorId: post.autorId,
          tipo: "gorjeta",
          valor: String(valor),
          comissao: String(comissao),
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

const GORJETAS_MAX_LIMIT = 50;

/**
 * GET /api/users/:username/gorjetas?page=1&limit=20
 * Criador autenticado: recebe histórico paginado + agregado (total Kz, count total).
 * Outros utilizadores autenticados: recebe apenas agregado.
 * Sem autenticação: 401.
 *
 * Usa o índice purchases_vendedor_tipo_criado_em_idx para evitar full-scans.
 */
router.get("/users/:username/gorjetas", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(GORJETAS_MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));
  const offset = (page - 1) * limit;

  try {
    const [creator] = await db
      .select({ id: usersTable.id, username: usersTable.username })
      .from(usersTable)
      .where(eq(usersTable.username, req.params['username'] as string))
      .limit(1);

    if (!creator) { res.status(404).json({ error: "Utilizador não encontrado." }); return; }

    const whereClause = and(eq(purchasesTable.vendedorId, creator.id), eq(purchasesTable.tipo, "gorjeta"));

    // Agregado (total Kz e contagem) — sempre necessário, independente do role
    const [agg] = await db
      .select({
        totalValor: sql<string>`coalesce(sum(${purchasesTable.valor}), 0)`,
        totalCount: sql<number>`count(*)::int`,
      })
      .from(purchasesTable)
      .where(whereClause);

    const total = Number(agg?.totalValor ?? 0);
    const count = agg?.totalCount ?? 0;

    // Apenas o próprio criador vê o histórico detalhado paginado
    if (req.userId === creator.id) {
      const gorjetas = await db
        .select({
          id: purchasesTable.id,
          valor: purchasesTable.valor,
          conteudoId: purchasesTable.conteudoId,
          descricao: purchasesTable.descricao,
          criadoEm: purchasesTable.criadoEm,
        })
        .from(purchasesTable)
        .where(whereClause)
        .orderBy(desc(purchasesTable.criadoEm))
        .limit(limit)
        .offset(offset);

      res.json({
        gorjetas,
        total,
        count,
        page,
        hasMore: offset + gorjetas.length < count,
      });
    } else {
      res.json({ total, count });
    }
  } catch (err) {
    req.log.error({ err }, "Get gorjetas error");
    res.status(500).json({ error: "Erro interno." });
  }
});

export default router;
