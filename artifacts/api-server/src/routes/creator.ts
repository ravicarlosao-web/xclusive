import { Router } from "express";
import { db, subscriptionPlansTable, subscriptionsTable, purchasesTable, usersTable, postsTable, reelsTable, followsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireCreator, type AuthRequest } from "../lib/auth";
import { validate } from "../lib/validate";

const createPlanSchema = z.object({
  nome: z.string().min(1, "Nome é obrigatório").max(100),
  preco: z.number().min(0, "Preço não pode ser negativo").max(10_000_000),
  beneficios: z.string().max(1000).optional(),
  ativo: z.boolean().optional(),
});

// Todos os campos tornam-se opcionais no PATCH, mas as restrições mantêm-se
const updatePlanSchema = createPlanSchema.partial();

const gorjetaSchema = z.object({
  valor: z
    .number({ error: "Valor deve ser um número" })
    .positive("Valor deve ser positivo")
    .finite()
    .max(10_000_000),
});

const router = Router();

/** Erros de pagamento lançados dentro de transações — capturados no handler externo. */
class PaymentError extends Error {
  constructor(msg: string, public readonly httpStatus: number) {
    super(msg);
    this.name = "PaymentError";
  }
}

// Estatísticas do criador
router.get("/creator/stats", requireAuth, requireCreator, async (req: AuthRequest, res): Promise<void> => {
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
router.get("/creator/plans", requireAuth, requireCreator, async (req: AuthRequest, res): Promise<void> => {
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
router.post("/creator/plans", requireAuth, requireCreator, validate(createPlanSchema), async (req: AuthRequest, res): Promise<void> => {
  const { nome, preco, beneficios, ativo } = req.body;

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
router.patch("/creator/plans/:id", requireAuth, requireCreator, validate(updatePlanSchema), async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, id));
  if (!plan || plan.criadorId !== req.userId) { res.status(403).json({ error: "Sem permissão" }); return; }

  // req.body já foi validado pelo updatePlanSchema — tipos e limites garantidos
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
router.delete("/creator/plans/:id", requireAuth, requireCreator, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const [plan] = await db.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, id));
  if (!plan || plan.criadorId !== req.userId) { res.status(403).json({ error: "Sem permissão" }); return; }
  await db.delete(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, id));
  res.sendStatus(204);
});

// Ganhos ao longo do tempo
router.get("/creator/earnings", requireAuth, requireCreator, async (req: AuthRequest, res): Promise<void> => {
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
router.get("/creator/transactions", requireAuth, requireCreator, async (req: AuthRequest, res): Promise<void> => {
  const userId = req.userId!;
  const page = Math.min(1000, Math.max(1, parseInt(String(req.query.page || "1"))));
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

const subscribeSchema = z.object({
  planoId: z.number().int().positive(),
  precoEsperado: z.number().positive("precoEsperado deve ser positivo").finite(),
});

// Subscrever
router.post("/subscriptions", requireAuth, validate(subscribeSchema), async (req: AuthRequest, res): Promise<void> => {
  const { planoId, precoEsperado } = req.body as { planoId: number; precoEsperado: number };

  try {
    const sub = await db.transaction(async (tx) => {
      // 1. Bloquear linha do subscritor (FOR UPDATE) para serializar pedidos concorrentes
      //    do mesmo utilizador — evita double-spend e subscrições duplicadas.
      //    Bloquear o plano (FOR SHARE) em paralelo: impede que o criador altere o
      //    preço enquanto esta transação está em curso (race condition de preço).
      const [[subscriber], [plan]] = await Promise.all([
        tx.select({ saldo: usersTable.saldo })
          .from(usersTable)
          .where(eq(usersTable.id, req.userId!))
          .for("update"),
        tx.select()
          .from(subscriptionPlansTable)
          .where(eq(subscriptionPlansTable.id, planoId))
          .for("share"),
      ]);

      if (!subscriber) throw new PaymentError("Utilizador não encontrado.", 404);
      if (!plan) throw new PaymentError("Plano não encontrado.", 404);
      if (!plan.ativo) throw new PaymentError("Este plano não está disponível.", 400);
      if (plan.criadorId === req.userId) throw new PaymentError("Não podes subscrever o teu próprio plano.", 400);

      // 2. Validar que o preço não mudou desde que o utilizador o viu no UI.
      //    Comparação com tolerância de 0.01 Kz para arredondamentos de ponto flutuante.
      const precoReal = Number(plan.preco);
      if (Math.abs(precoReal - precoEsperado) > 0.01) {
        throw new PaymentError(
          `O preço deste plano foi alterado para ${precoReal.toLocaleString("pt-PT")} Kz. Confirma o novo valor antes de subscrever.`,
          409,
        );
      }

      if (Number(subscriber.saldo) < precoReal) {
        throw new PaymentError("Saldo insuficiente para activar esta subscrição.", 402);
      }

      // 2. Verificar subscrição activa existente dentro da transação (após o lock),
      //    para que pedidos simultâneos não criem duplicados.
      const [existing] = await tx
        .select({ id: subscriptionsTable.id })
        .from(subscriptionsTable)
        .where(and(
          eq(subscriptionsTable.subscriitorId, req.userId!),
          eq(subscriptionsTable.criadorId, plan.criadorId),
          eq(subscriptionsTable.estado, "ativa"),
        ))
        .limit(1);

      if (existing) throw new PaymentError("Já tens uma subscrição activa para este criador.", 409);

      // 3. Debitar saldo do subscritor.
      await tx
        .update(usersTable)
        .set({ saldo: sql`${usersTable.saldo} - ${precoReal}` })
        .where(eq(usersTable.id, req.userId!));

      // 4. Creditar ganhos do criador.
      await tx
        .update(usersTable)
        .set({ ganhos: sql`${usersTable.ganhos} + ${precoReal}` })
        .where(eq(usersTable.id, plan.criadorId));

      // 5. Criar subscrição.
      const renewAt = new Date();
      renewAt.setMonth(renewAt.getMonth() + 1);

      const [newSub] = await tx.insert(subscriptionsTable).values({
        subscriitorId: req.userId!,
        criadorId: plan.criadorId,
        planoId: plan.id,
        estado: "ativa",
        renovacaoEm: renewAt,
      }).returning();

      // 6. Registar transação de compra.
      await tx.insert(purchasesTable).values({
        compradorId: req.userId!,
        vendedorId: plan.criadorId,
        tipo: "subscricao",
        valor: plan.preco,
        conteudoId: plan.id,
        descricao: `Subscrição: ${plan.nome}`,
      });

      return { newSub, plan };
    });

    res.status(201).json({
      id: sub.newSub.id,
      plano: {
        id: sub.plan.id, nome: sub.plan.nome, preco: parseFloat(String(sub.plan.preco)),
        beneficios: sub.plan.beneficios, ativo: sub.plan.ativo, totalSubscritores: 0, criadoEm: sub.plan.criadoEm.toISOString(),
      },
      criador: null,
      estado: sub.newSub.estado,
      inicioEm: sub.newSub.inicioEm.toISOString(),
      renovacaoEm: sub.newSub.renovacaoEm?.toISOString() || null,
    });
  } catch (err) {
    if (err instanceof PaymentError) {
      res.status(err.httpStatus).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Subscription error");
    res.status(500).json({ error: "Erro interno." });
  }
});

// Cancelar subscrição
router.delete("/subscriptions/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  await db.update(subscriptionsTable).set({ estado: "cancelada" }).where(and(eq(subscriptionsTable.id, id), eq(subscriptionsTable.subscriitorId, req.userId!)));
  res.json({ ok: true });
});

export default router;
