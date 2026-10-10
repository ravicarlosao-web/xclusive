import { Router } from "express";
import { db, subscriptionPlansTable, subscriptionsTable, purchasesTable, usersTable, postsTable, reelsTable, followsTable } from "@workspace/db";
import { eq, and, sql, desc, inArray, isNotNull, lte } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireCreator, type AuthRequest } from "../lib/auth";
import { validate } from "../lib/validate";
import { getCommissionRate, calcComissao } from "../lib/commission";
import { subscricaoComAcesso } from "../lib/exclusiveAccess";

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

  // Ganhos do mês (líquido após comissão da plataforma)
  const [{ ganhosMes }] = await db.select({
    ganhosMes: sql<number>`coalesce(sum((${purchasesTable.valor}::numeric - coalesce(${purchasesTable.comissao}::numeric, 0))), 0)::float`,
  })
    .from(purchasesTable)
    .where(and(eq(purchasesTable.vendedorId, userId), sql`${purchasesTable.criadoEm} >= ${startOfMonth}`));

  // Ganhos totais (líquido após comissão da plataforma)
  const [{ ganhosTotal }] = await db.select({
    ganhosTotal: sql<number>`coalesce(sum((${purchasesTable.valor}::numeric - coalesce(${purchasesTable.comissao}::numeric, 0))), 0)::float`,
  })
    .from(purchasesTable)
    .where(eq(purchasesTable.vendedorId, userId));

  // Total subscritores ativos
  const [{ totalSubscritores }] = await db.select({ totalSubscritores: sql<number>`count(*)::int` })
    .from(subscriptionsTable)
    .where(and(eq(subscriptionsTable.criadorId, userId), subscricaoComAcesso()));

  // Novos subscritores este mês
  const [{ novosSubscritores }] = await db.select({ novosSubscritores: sql<number>`count(*)::int` })
    .from(subscriptionsTable)
    .where(and(eq(subscriptionsTable.criadorId, userId), sql`${subscriptionsTable.criadoEm} >= ${startOfMonth}`));

  // Visualizações totais (posts + reels)
  const [{ posts }] = await db.select({ posts: sql<number>`count(*)::int` }).from(postsTable).where(eq(postsTable.autorId, userId));
  const [{ reels }] = await db.select({ reels: sql<number>`count(*)::int` }).from(reelsTable).where(eq(reelsTable.autorId, userId));

  // Taxa de retenção real: subscritores ativos / total histórico de subscritores
  const [{ totalHistorico }] = await db.select({ totalHistorico: sql<number>`count(*)::int` })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.criadorId, userId));
  const taxaRetencao = totalHistorico > 0 ? Math.min(100, Math.round((totalSubscritores / totalHistorico) * 100)) : 0;

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
      .where(and(eq(subscriptionsTable.planoId, p.id), subscricaoComAcesso()));
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

    const [{ valor }] = await db.select({
      valor: sql<number>`coalesce(sum((${purchasesTable.valor}::numeric - coalesce(${purchasesTable.comissao}::numeric, 0))), 0)::float`,
    })
      .from(purchasesTable)
      .where(and(
        eq(purchasesTable.vendedorId, userId),
        sql`${purchasesTable.criadoEm} >= ${start} AND ${purchasesTable.criadoEm} < ${end}`,
      ));

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

// Plano activo de um criador — endpoint público (sem requireAuth) para que
// o frontend do fã possa resolver o planoId antes de chamar POST /subscriptions.
router.get("/users/:username/subscription-plan", async (req, res): Promise<void> => {
  const { username } = req.params;

  const [user] = await db
    .select({ id: usersTable.id, tipoSubscricao: usersTable.tipoSubscricao })
    .from(usersTable)
    .where(eq(usersTable.username, username))
    .limit(1);

  if (!user) { res.status(404).json({ error: "Criador não encontrado." }); return; }

  // Conta gratuita: não há plano nem preço; o fã subscreve com { criadorId } (POST /subscriptions).
  if (user.tipoSubscricao === "gratuita") {
    res.json({ id: null, criadorId: user.id, tipoSubscricao: "gratuita", nome: null, preco: 0, beneficios: null });
    return;
  }

  const [plan] = await db
    .select()
    .from(subscriptionPlansTable)
    .where(and(eq(subscriptionPlansTable.criadorId, user.id), eq(subscriptionPlansTable.ativo, true)))
    .orderBy(subscriptionPlansTable.preco)
    .limit(1);

  if (!plan) { res.status(404).json({ error: "Este criador não tem um plano de subscrição activo." }); return; }

  res.json({
    id: plan.id,
    criadorId: user.id,
    tipoSubscricao: "paga",
    nome: plan.nome,
    preco: parseFloat(String(plan.preco)),
    beneficios: plan.beneficios,
  });
});

// Subscrever: paga ({ planoId, precoEsperado }) ou gratuita ({ criadorId })
const subscribeSchema = z.union([
  z.object({
    planoId: z.number().int().positive(),
    precoEsperado: z.number().positive("precoEsperado deve ser positivo").finite(),
  }),
  z.object({ criadorId: z.number().int().positive() }),
]);

/** Fim do período: daqui a 1 mês, sem transbordar para o mês seguinte (31 Jan + 1 mês = 28/29 Fev). */
function addOneMonth(from: Date): Date {
  const d = new Date(from);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d;
}

/** Transação (tx) do drizzle — para partilhar a lógica de pagamento entre subscrever e renovar. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Debita o subscritor, credita o criador (menos comissão) e regista a compra — tudo na transação do chamador. */
async function cobrarSubscricao(
  tx: Tx,
  subscritorId: number,
  plan: { id: number; nome: string; criadorId: number; preco: string },
  descricao: string,
): Promise<void> {
  const precoReal = Number(plan.preco);
  await tx.update(usersTable).set({ saldo: sql`${usersTable.saldo} - ${precoReal}` }).where(eq(usersTable.id, subscritorId));

  const commissionRate = await getCommissionRate(tx, plan.criadorId);
  const { valorCriador, comissao } = calcComissao(precoReal, commissionRate);
  await tx.update(usersTable).set({ ganhos: sql`${usersTable.ganhos} + ${valorCriador}` }).where(eq(usersTable.id, plan.criadorId));

  await tx.insert(purchasesTable).values({
    compradorId: subscritorId,
    vendedorId: plan.criadorId,
    tipo: "subscricao",
    valor: plan.preco,
    comissao: String(comissao),
    conteudoId: plan.id,
    descricao,
  });
}

// Subscrever
router.post("/subscriptions", requireAuth, validate(subscribeSchema), async (req: AuthRequest, res): Promise<void> => {
  const body = req.body as { planoId: number; precoEsperado: number } | { criadorId: number };

  try {
    const sub = await db.transaction(async (tx) => {
      // 1. Bloquear linha do subscritor (FOR UPDATE) para serializar pedidos concorrentes
      //    do mesmo utilizador — evita double-spend e subscrições duplicadas.
      const [subscriber] = await tx.select({ saldo: usersTable.saldo }).from(usersTable).where(eq(usersTable.id, req.userId!)).for("update");
      if (!subscriber) throw new PaymentError("Utilizador não encontrado.", 404);

      let plan: typeof subscriptionPlansTable.$inferSelect | null = null;
      let criadorId: number;
      let gratuita: boolean;

      if ("planoId" in body) {
        // Bloquear o plano (FOR SHARE): impede que o criador altere o preço durante a transação.
        const [p] = await tx.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, body.planoId)).for("share");
        if (!p) throw new PaymentError("Plano não encontrado.", 404);
        if (!p.ativo) throw new PaymentError("Este plano não está disponível.", 400);
        plan = p;
        criadorId = p.criadorId;
        gratuita = false;
      } else {
        criadorId = body.criadorId;
        gratuita = true;
      }
      if (criadorId === req.userId) throw new PaymentError("Não podes subscrever o teu próprio plano.", 400);

      // O tipo da conta é lido AGORA: só vale para novas subscrições.
      const [criador] = await tx.select({ tipoConta: usersTable.tipoConta, tipoSubscricao: usersTable.tipoSubscricao }).from(usersTable).where(eq(usersTable.id, criadorId));
      if (!criador || criador.tipoConta !== "criador") throw new PaymentError("Criador não encontrado.", 404);
      if (gratuita && criador.tipoSubscricao !== "gratuita") throw new PaymentError("Este criador tem subscrição paga: escolhe um plano.", 409);
      if (!gratuita && criador.tipoSubscricao === "gratuita") throw new PaymentError("Este criador passou a ter subscrição gratuita: subscreve sem plano.", 409);

      // 2. Preço (só paga): validar que não mudou desde que o utilizador o viu (tolerância de 0,01 Kz).
      if (plan && "precoEsperado" in body) {
        const precoReal = Number(plan.preco);
        if (Math.abs(precoReal - body.precoEsperado) > 0.01) {
          throw new PaymentError(
            `O preço deste plano foi alterado para ${precoReal.toLocaleString("pt-PT")} Kz. Confirma o novo valor antes de subscrever.`,
            409,
          );
        }
        if (Number(subscriber.saldo) < precoReal) {
          throw new PaymentError("Saldo insuficiente. Carrega a tua carteira primeiro.", 402);
        }
      }

      // 3. O que já passou da data deixa de contar (o job só o regista mais tarde).
      const now = new Date();
      await tx.update(subscriptionsTable).set({ estado: "expirada" }).where(and(
        eq(subscriptionsTable.subscriitorId, req.userId!),
        eq(subscriptionsTable.criadorId, criadorId),
        inArray(subscriptionsTable.estado, ["ativa", "cancelada"]),
        isNotNull(subscriptionsTable.renovacaoEm),
        lte(subscriptionsTable.renovacaoEm, now),
      ));

      // 4. Já tem acesso (ativa, ou cancelada dentro do período)? Não cobrar duas vezes.
      const [existing] = await tx.select({ id: subscriptionsTable.id }).from(subscriptionsTable).where(and(
        eq(subscriptionsTable.subscriitorId, req.userId!),
        eq(subscriptionsTable.criadorId, criadorId),
        subscricaoComAcesso(now),
      )).limit(1);
      if (existing) throw new PaymentError("Já tens uma subscrição activa para este criador. Para prolongar usa Renovar.", 409);

      // 5. Cobrança (só paga) e criação. Gratuita: sem débito e sem data de fim (renovacao_em NULL).
      if (plan) await cobrarSubscricao(tx, req.userId!, plan, `Subscrição: ${plan.nome}`);

      const [newSub] = await tx.insert(subscriptionsTable).values({
        subscriitorId: req.userId!,
        criadorId,
        planoId: plan?.id ?? null,
        estado: "ativa",
        renovacaoEm: plan ? addOneMonth(now) : null,
      }).returning();

      return { newSub, plan };
    });

    res.status(201).json({
      id: sub.newSub.id,
      plano: sub.plan ? {
        id: sub.plan.id, nome: sub.plan.nome, preco: parseFloat(String(sub.plan.preco)),
        beneficios: sub.plan.beneficios, ativo: sub.plan.ativo, totalSubscritores: 0, criadoEm: sub.plan.criadoEm.toISOString(),
      } : null,
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
    // Índice único (subscriptions_unica_ativa): pedido simultâneo que escapou à verificação.
    if ((err as { code?: string; cause?: { code?: string } })?.code === "23505" || (err as { cause?: { code?: string } })?.cause?.code === "23505") {
      res.status(409).json({ error: "Já tens uma subscrição activa para este criador." });
      return;
    }
    req.log.error({ err }, "Subscription error");
    res.status(500).json({ error: "Erro interno." });
  }
});

// Renovar (SEMPRE manual: só este clique debita o saldo; nunca há cobrança automática)
const renewSchema = z.object({
  /** Fim de período que o cliente viu (ISO). Protege contra clique duplo / renovação já feita. */
  periodoAtual: z.string().datetime(),
  precoEsperado: z.number().positive().finite(),
});

router.post("/subscriptions/:id/renovar", requireAuth, validate(renewSchema), async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const { periodoAtual, precoEsperado } = req.body as z.infer<typeof renewSchema>;

  try {
    const result = await db.transaction(async (tx) => {
      // Serializa por utilizador: dois cliques simultâneos correm um depois do outro.
      const [subscriber] = await tx.select({ saldo: usersTable.saldo }).from(usersTable).where(eq(usersTable.id, req.userId!)).for("update");
      if (!subscriber) throw new PaymentError("Utilizador não encontrado.", 404);

      const [sub] = await tx.select().from(subscriptionsTable)
        .where(and(eq(subscriptionsTable.id, id), eq(subscriptionsTable.subscriitorId, req.userId!)))
        .for("update");
      if (!sub) throw new PaymentError("Subscrição não encontrada.", 404);
      if (!sub.renovacaoEm) throw new PaymentError("Subscrição gratuita: não precisa de renovação.", 400);

      // Compare-and-swap: só renova se o período ainda for o que o utilizador viu.
      if (sub.renovacaoEm.getTime() !== new Date(periodoAtual).getTime()) {
        throw new PaymentError("Esta subscrição já foi renovada ou foi alterada. Atualiza a página.", 409);
      }

      const [criador] = await tx.select({ tipoSubscricao: usersTable.tipoSubscricao }).from(usersTable).where(eq(usersTable.id, sub.criadorId));
      if (!criador) throw new PaymentError("Criador não encontrado.", 404);
      if (criador.tipoSubscricao === "gratuita") throw new PaymentError("Este criador passou a ter subscrição gratuita: subscreve sem custo.", 409);
      if (!sub.planoId) throw new PaymentError("O plano desta subscrição já não existe.", 400);

      const [plan] = await tx.select().from(subscriptionPlansTable).where(eq(subscriptionPlansTable.id, sub.planoId)).for("share");
      if (!plan || !plan.ativo) throw new PaymentError("O plano desta subscrição já não está disponível.", 400);

      const precoReal = Number(plan.preco);
      if (Math.abs(precoReal - precoEsperado) > 0.01) {
        throw new PaymentError(`O preço deste plano é agora ${precoReal.toLocaleString("pt-PT")} Kz. Confirma o novo valor antes de renovar.`, 409);
      }
      if (Number(subscriber.saldo) < precoReal) throw new PaymentError("Saldo insuficiente. Carrega a tua carteira primeiro.", 402);

      const now = new Date();
      // Período novo: a partir do fim atual se ainda não passou (renovação antecipada), senão a partir de agora.
      const base = sub.renovacaoEm.getTime() > now.getTime() ? sub.renovacaoEm : now;
      const novaData = addOneMonth(base);

      if (sub.estado !== "ativa") {
        // Reativar: não pode haver outra 'ativa' do mesmo par (índice único).
        const [other] = await tx.select({ id: subscriptionsTable.id }).from(subscriptionsTable).where(and(
          eq(subscriptionsTable.subscriitorId, req.userId!),
          eq(subscriptionsTable.criadorId, sub.criadorId),
          eq(subscriptionsTable.estado, "ativa"),
        )).limit(1);
        if (other) throw new PaymentError("Já tens uma subscrição activa para este criador.", 409);
      }

      await cobrarSubscricao(tx, req.userId!, plan, `Renovação: ${plan.nome}`);
      const [updated] = await tx.update(subscriptionsTable)
        .set({ estado: "ativa", renovacaoEm: novaData })
        .where(eq(subscriptionsTable.id, sub.id))
        .returning();
      return updated;
    });

    res.json({ id: result.id, estado: result.estado, renovacaoEm: result.renovacaoEm?.toISOString() ?? null });
  } catch (err) {
    if (err instanceof PaymentError) {
      res.status(err.httpStatus).json({ error: err.message });
      return;
    }
    if ((err as { code?: string; cause?: { code?: string } })?.code === "23505" || (err as { cause?: { code?: string } })?.cause?.code === "23505") {
      res.status(409).json({ error: "Já tens uma subscrição activa para este criador." });
      return;
    }
    req.log.error({ err }, "Subscription renewal error");
    res.status(500).json({ error: "Erro interno." });
  }
});

// Cancelar subscrição: não renova e mantém o acesso até ao fim do período pago
router.delete("/subscriptions/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [sub] = await db.select().from(subscriptionsTable)
    .where(and(eq(subscriptionsTable.id, id), eq(subscriptionsTable.subscriitorId, req.userId!)));
  // Subscrição inexistente OU de outro utilizador: 404 (não revela a existência).
  if (!sub) { res.status(404).json({ error: "Subscrição não encontrada." }); return; }
  if (sub.estado === "expirada") { res.status(409).json({ error: "Esta subscrição já terminou." }); return; }

  if (sub.estado === "ativa") {
    await db.update(subscriptionsTable).set({ estado: "cancelada" })
      .where(and(eq(subscriptionsTable.id, id), eq(subscriptionsTable.subscriitorId, req.userId!), eq(subscriptionsTable.estado, "ativa")));
  }
  // Paga: acesso até renovacao_em. Gratuita (sem data): o acesso termina já.
  res.json({ ok: true, estado: "cancelada", acessoAte: sub.renovacaoEm?.toISOString() ?? null });
});

// ── Tipo de subscrição da criadora (gratuita | paga) ────────────────────────────
// Só vale para NOVAS subscrições; as em curso mantêm-se até ao fim do período.
const subscriptionTypeSchema = z.object({ tipo: z.enum(["gratuita", "paga"]) });

router.get("/creator/subscription-type", requireAuth, requireCreator, async (req: AuthRequest, res): Promise<void> => {
  const [u] = await db.select({ tipoSubscricao: usersTable.tipoSubscricao }).from(usersTable).where(eq(usersTable.id, req.userId!));
  res.json({ tipo: u?.tipoSubscricao ?? "paga" });
});

router.patch("/creator/subscription-type", requireAuth, requireCreator, validate(subscriptionTypeSchema), async (req: AuthRequest, res): Promise<void> => {
  const { tipo } = req.body as z.infer<typeof subscriptionTypeSchema>;
  await db.update(usersTable).set({ tipoSubscricao: tipo }).where(eq(usersTable.id, req.userId!));
  res.json({ tipo });
});

export default router;
