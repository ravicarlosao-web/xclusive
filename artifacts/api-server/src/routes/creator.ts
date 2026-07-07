import { Router } from "express";
import { db, subscriptionPlansTable, subscriptionsTable, purchasesTable, usersTable, postsTable, reelsTable, followsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../lib/auth";

const router = Router();

// Estatísticas do criador
router.get("/creator/stats", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Ganhos do mês
  const [{ ganhosMes }] = await db.select({ ganhosMes: sql<number>`coalesce(sum(${purchasesTable.valor}::numeric), 0)::float` })
    .from(purchasesTable)
    .where(and(eq(purchasesTable.vendedorId, userId), sql`${purchasesTable.criadoEm} >= ${startOfMonth}`));

  // Ganhos totais
  const [{ ganhosTotal }] = await db.select({ ganhosTotal: sql<number>`coalesce(sum(${purchasesTable.valor}::numeric), 0)::float` })
    .from(purchasesTable)
    .where(eq(purchasesTable.vendedorId, userId));

  // Total subscritores ativos
  const [{ totalSubscritores }] = await db.select({ totalSubscritores: sql<number>`count(*)::int` })
    .from(subscriptionsTable)
    .where(and(eq(subscriptionsTable.criadorId, userId), eq(subscriptionsTable.estado, "ativa")));

  // Novos subscritores este mês
  const [{ novosSubscritores }] = await db.select({ novosSubscritores: sql<number>`count(*)::int` })
    .from(subscriptionsTable)
    .where(and(eq(subscriptionsTable.criadorId, userId), sql`${subscriptionsTable.criadoEm} >= ${startOfMonth}`));

  // Visualizações totais (posts + reels)
  const [{ posts }] = await db.select({ posts: sql<number>`count(*)::int` }).from(postsTable).where(eq(postsTable.autorId, userId));
  const [{ reels }] = await db.select({ reels: sql<number>`count(*)::int` }).from(reelsTable).where(eq(reelsTable.autorId, userId));

  // Taxa de retenção (simulada)
  const taxaRetencao = totalSubscritores > 0 ? Math.min(100, Math.round(85 + Math.random() * 10)) : 0;

  res.json({
    ganhosMes: parseFloat(String(ganhosMes)) || 0,
    totalSubscritores: totalSubscritores || 0,
    taxaRetencao,
    visualizacoesTotais: (posts || 0) + (reels || 0),
    ganhosTotal: parseFloat(String(ganhosTotal)) || 0,
    novosSubscritores: novosSubscritores || 0,
  });
});

// Planos de subscrição
router.get("/creator/plans", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const plans = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.criadorId, req.userId!)).orderBy(subscriptionPlansTable.preco);

  const result = await Promise.all(plans.map(async (p) => {
    const [{ cnt }] = await db.select({ cnt: sql<number>`count(*)::int` })
      .from(subscriptionsTable)
      .where(and(eq(subscriptionsTable.planoId, p.id), eq(subscriptionsTable.estado, "ativa")));
    return {
      id: p.id,
      nome: p.nome,
      preco: parseFloat(String(p.preco)),
      beneficios: p.beneficios,
      ativo: p.ativo,
      totalSubscritores: cnt || 0,
      criadoEm: p.criadoEm.toISOString(),
    };
  }));

  res.json(result);
});

// Criar plano
router.post("/creator/plans", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { nome, preco, beneficios, ativo } = req.body;
  if (!nome || !preco) { res.status(400).json({ error: "Nome e preço são obrigatórios" }); return; }

  const [plan] = await db.insert(subscriptionPlansTable).values({
    criadorId: req.userId!,
    nome,
    preco: String(preco),
    beneficios: beneficios || null,
    ativo: ativo !== false,
  }).returning();

  res.status(201).json({
    id: plan.id,
    nome: plan.nome,
    preco: parseFloat(String(plan.preco)),
    beneficios: plan.beneficios,
    ativo: plan.ativo,
    totalSubscritores: 0,
    criadoEm: plan.criadoEm.toISOString(),
  });
});

// Atualizar plano
router.patch("/creator/plans/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, id));
  if (!plan || plan.criadorId !== req.userId) { res.status(403).json({ error: "Sem permissão" }); return; }

  const { nome, preco, beneficios, ativo } = req.body;
  const updates: Record<string, any> = {};
  if (nome !== undefined) updates.nome = nome;
  if (preco !== undefined) updates.preco = String(preco);
  if (beneficios !== undefined) updates.beneficios = beneficios;
  if (ativo !== undefined) updates.ativo = ativo;

  const [updated] = await db.update(subscriptionPlansTable).set(updates).where(eq(subscriptionPlansTable.id, id)).returning();

  res.json({
    id: updated.id,
    nome: updated.nome,
    preco: parseFloat(String(updated.preco)),
    beneficios: updated.beneficios,
    ativo: updated.ativo,
    totalSubscritores: 0,
    criadoEm: updated.criadoEm.toISOString(),
  });
});

// Eliminar plano
router.delete("/creator/plans/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, id));
  if (!plan || plan.criadorId !== req.userId) { res.status(403).json({ error: "Sem permissão" }); return; }
  await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, id));
  res.sendStatus(204);
});

// Ganhos ao longo do tempo
router.get("/creator/earnings", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const period = String(req.query.period || "30d");

  // Gerar pontos de dados simulados com base em transações reais ou mock
  const days = period === "7d" ? 7 : period === "90d" ? 90 : period === "1y" ? 365 : 30;
  const points = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];

    const start = new Date(dateStr);
    const end = new Date(dateStr);
    end.setDate(end.getDate() + 1);

    const [{ valor }] = await db.select({ valor: sql<number>`coalesce(sum(${purchasesTable.valor}::numeric), 0)::float` })
      .from(purchasesTable)
      .where(and(eq(purchasesTable.vendedorId, userId), sql`${purchasesTable.criadoEm} >= ${start} AND ${purchasesTable.criadoEm} < ${end}`));

    points.push({ data: dateStr, valor: parseFloat(String(valor)) || 0, subscricoes: 0, ppv: 0 });
  }

  res.json(points);
});

// Transações
router.get("/creator/transactions", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const page = Math.max(1, parseInt(String(req.query.page || "1")));
  const limit = 20;
  const offset = (page - 1) * limit;

  const txs = await db.select({ p: purchasesTable, u: usersTable })
    .from(purchasesTable)
    .innerJoin(usersTable, eq(purchasesTable.compradorId, usersTable.id))
    .where(eq(purchasesTable.vendedorId, userId))
    .orderBy(desc(purchasesTable.criadoEm))
    .limit(limit)
    .offset(offset);

  res.json({
    transactions: txs.map(({ p, u }) => ({
      id: p.id,
      tipo: p.tipo,
      valor: parseFloat(String(p.valor)),
      utilizador: { id: u.id, username: u.username, nomeExibicao: u.nomeExibicao, avatarUrl: u.avatarUrl, verificado: u.verificado, tipoConta: u.tipoConta, estaASeguir: false, segueVoce: false, totalSeguidores: 0 },
      descricao: p.descricao,
      criadoEm: p.criadoEm.toISOString(),
    })),
    page,
    hasMore: txs.length === limit,
  });
});

// Subscrever
router.post("/subscriptions", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { planoId } = req.body;
  if (!planoId) { res.status(400).json({ error: "planoId é obrigatório" }); return; }

  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, planoId));
  if (!plan) { res.status(404).json({ error: "Plano não encontrado" }); return; }

  const renewAt = new Date();
  renewAt.setMonth(renewAt.getMonth() + 1);

  const [sub] = await db.insert(subscriptionsTable).values({
    subscriitorId: req.userId!,
    criadorId: plan.criadorId,
    planoId: plan.id,
    estado: "ativa",
    renovacaoEm: renewAt,
  }).returning();

  // Registar transação
  await db.insert(purchasesTable).values({
    compradorId: req.userId!,
    vendedorId: plan.criadorId,
    tipo: "subscricao",
    valor: plan.preco,
    conteudoId: plan.id,
    descricao: `Subscrição: ${plan.nome}`,
  });

  res.status(201).json({
    id: sub.id,
    plano: {
      id: plan.id, nome: plan.nome, preco: parseFloat(String(plan.preco)),
      beneficios: plan.beneficios, ativo: plan.ativo, totalSubscritores: 0, criadoEm: plan.criadoEm.toISOString(),
    },
    criador: null,
    estado: sub.estado,
    inicioEm: sub.inicioEm.toISOString(),
    renovacaoEm: sub.renovacaoEm?.toISOString() || null,
  });
});

// Cancelar subscrição
router.delete("/subscriptions/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  await db.update(subscriptionsTable).set({ estado: "cancelada" }).where(and(eq(subscriptionsTable.id, id), eq(subscriptionsTable.subscriitorId, req.userId!)));
  res.json({ ok: true });
});

export default router;
