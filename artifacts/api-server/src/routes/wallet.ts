import { Router } from "express";
import { db, usersTable, purchasesTable, topupRequestsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, type AuthRequest } from "../lib/auth";

const router = Router();

/**
 * GET /api/wallet/balance
 * Devolve o saldo e ganhos do utilizador autenticado.
 */
router.get("/wallet/balance", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;

  try {
    const [user] = await db
      .select({ saldo: usersTable.saldo, ganhos: usersTable.ganhos })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "Utilizador não encontrado." });
      return;
    }

    res.json({
      saldo: parseFloat(user.saldo as string),
      ganhos: parseFloat(user.ganhos as string),
    });
  } catch (err) {
    req.log?.error({ err }, "Erro ao obter saldo");
    res.status(500).json({ error: "Erro ao obter saldo." });
  }
});

/**
 * GET /api/wallet/transactions?page=1&limit=20
 * Histórico de transações do utilizador: compras (gorjetas, subscrições, PPV) + pedidos de carregamento.
 */
router.get("/wallet/transactions", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const page = Math.max(1, parseInt(req.query["page"] as string || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.query["limit"] as string || "20", 10)));
  const offset = (page - 1) * limit;

  try {
    // Compras onde o utilizador é comprador
    const purchases = await db
      .select({
        id: purchasesTable.id,
        tipo: purchasesTable.tipo,
        valor: purchasesTable.valor,
        descricao: purchasesTable.descricao,
        criadoEm: purchasesTable.criadoEm,
      })
      .from(purchasesTable)
      .where(eq(purchasesTable.compradorId, userId))
      .orderBy(desc(purchasesTable.criadoEm))
      .limit(limit + offset);

    // Pedidos de carregamento (todos, não apenas aprovados — para mostrar estado)
    const topups = await db
      .select({
        id: topupRequestsTable.id,
        amount: topupRequestsTable.amount,
        reference: topupRequestsTable.reference,
        status: topupRequestsTable.status,
        criadoEm: topupRequestsTable.criadoEm,
      })
      .from(topupRequestsTable)
      .where(eq(topupRequestsTable.userId, userId))
      .orderBy(desc(topupRequestsTable.criadoEm))
      .limit(limit + offset);

    // Mapear e combinar
    const purchaseTxs = purchases.map((p) => ({
      id: `p-${p.id}`,
      tipo: p.tipo as string,
      amount: parseFloat(p.valor as string),
      descricao: p.descricao ?? undefined,
      criadoEm: p.criadoEm.toISOString(),
      credit: false,
    }));

    const topupTxs = topups.map((t) => ({
      id: `t-${t.id}`,
      tipo: "carregamento" as const,
      amount: parseFloat(t.amount as string),
      reference: t.reference,
      status: t.status,
      descricao: `Ref: ${t.reference}`,
      criadoEm: t.criadoEm.toISOString(),
      credit: t.status === "aprovado",
      pendente: t.status === "pendente",
    }));

    // Combinar, ordenar por data e paginar
    const all = [...purchaseTxs, ...topupTxs]
      .sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime())
      .slice(offset, offset + limit);

    res.json({ transactions: all, page, limit });
  } catch (err) {
    req.log?.error({ err }, "Erro ao obter transações");
    res.status(500).json({ error: "Erro ao obter histórico de transações." });
  }
});

const topupSchema = z.object({
  amount: z.number({ error: "Valor deve ser um número" }).min(500, "Valor mínimo: 500 Kz"),
  reference: z.string().min(5).max(20),
  comprovantivoBase64: z.string().optional(),
  comprovantivoNome: z.string().max(255).optional(),
});

/**
 * POST /api/wallet/topup
 * Submete um pedido de carregamento (fica pendente até aprovação do admin).
 */
router.post("/wallet/topup", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = topupSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Dados inválidos.";
    res.status(400).json({ error: msg });
    return;
  }

  const { amount, reference, comprovantivoBase64, comprovantivoNome } = parsed.data;
  const userId = req.userId!;

  try {
    // Verificar referência duplicada
    const [existing] = await db
      .select({ id: topupRequestsTable.id })
      .from(topupRequestsTable)
      .where(eq(topupRequestsTable.reference, reference))
      .limit(1);

    if (existing) {
      res.status(409).json({ error: "Pedido com esta referência já foi submetido." });
      return;
    }

    const [request] = await db
      .insert(topupRequestsTable)
      .values({
        userId,
        amount: amount.toString(),
        reference,
        comprovantivoBase64: comprovantivoBase64 ?? null,
        comprovantivoNome: comprovantivoNome ?? null,
        status: "pendente",
      })
      .returning({
        id: topupRequestsTable.id,
        reference: topupRequestsTable.reference,
        status: topupRequestsTable.status,
        criadoEm: topupRequestsTable.criadoEm,
      });

    res.status(201).json({ request });
  } catch (err) {
    req.log?.error({ err }, "Erro ao submeter carregamento");
    res.status(500).json({ error: "Erro ao submeter pedido de carregamento." });
  }
});

export default router;
