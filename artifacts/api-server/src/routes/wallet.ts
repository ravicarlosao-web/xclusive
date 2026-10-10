import { Router } from "express";
import {
  db, usersTable, purchasesTable, topupRequestsTable,
  withdrawalRequestsTable, creatorPayoutAccountsTable, platformSettingsTable, auditLogTable,
} from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireCreator, type AuthRequest } from "../lib/auth";
import { validate } from "../lib/validate";
import { createGpoCharge, createRefCharge } from "../lib/appypay";

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

// ─── AppyPay: Multicaixa Express (GPO) ───────────────────────────────────────

const gpoSchema = z.object({
  amount: z.number({ error: "Valor deve ser um número" }).min(500, "Valor mínimo: 500 Kz"),
  phoneNumber: z
    .string()
    .min(9, "Número de telemóvel inválido")
    .max(15, "Número de telemóvel inválido")
    .regex(/^\d+$/, "Número de telemóvel deve conter apenas dígitos"),
});

/**
 * POST /api/wallet/topup/appypay/gpo
 * Inicia uma cobrança Multicaixa Express via AppyPay.
 * O utilizador aprova no telemóvel — confirmação chega via webhook.
 */
router.post("/wallet/topup/appypay/gpo", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = gpoSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Dados inválidos.";
    res.status(400).json({ error: msg });
    return;
  }

  const { amount, phoneNumber } = parsed.data;
  const userId = req.userId!;

  // Gerar referência interna única
  const internalRef = `GPO-${Date.now()}-${userId}`;

  // URL do webhook — configurável via env para funcionar em dev (ngrok) e produção
  const webhookUrl = process.env["APPYPAY_WEBHOOK_URL"] ?? "";
  if (!webhookUrl) {
    res.status(503).json({
      error: "Pagamento automático não configurado. Usa o método de comprovativo manual.",
    });
    return;
  }

  try {
    // 1. Chamar AppyPay
    const charge = await createGpoCharge({
      paymentMethod: "GPO",
      amount,
      currency: "AOA",
      reference: internalRef,
      callbackUrl: webhookUrl,
      paymentInfo: { phoneNumber },
    });

    // 2. Guardar registo no DB com status 'processando'
    const [topup] = await db
      .insert(topupRequestsTable)
      .values({
        userId,
        amount: amount.toString(),
        reference: internalRef,
        status: "processando",
        paymentMethod: "gpo",
        externalChargeId: charge.id,
        externalRef: null,
      })
      .returning({
        id: topupRequestsTable.id,
        reference: topupRequestsTable.reference,
        status: topupRequestsTable.status,
        criadoEm: topupRequestsTable.criadoEm,
      });

    res.status(201).json({
      ok: true,
      method: "gpo",
      chargeId: charge.id,
      status: charge.status,
      topupId: topup.id,
      reference: internalRef,
      message: "Pedido enviado ao telemóvel. Aprova a cobrança na app Multicaixa Express.",
    });
  } catch (err: any) {
    req.log?.error({ err }, "[AppyPay GPO] Erro ao criar cobrança");

    // Verificar se é erro de configuração (credenciais em falta)
    if (err?.message?.includes("APPYPAY_CLIENT_ID")) {
      res.status(503).json({
        error: "Pagamento automático temporariamente indisponível. Tenta o comprovativo manual.",
      });
      return;
    }

    res.status(502).json({ error: "Erro ao processar pagamento. Tenta novamente ou usa o comprovativo manual." });
  }
});

// ─── AppyPay: Pagamento por Referência (REF) ──────────────────────────────────

const refSchema = z.object({
  amount: z.number({ error: "Valor deve ser um número" }).min(500, "Valor mínimo: 500 Kz"),
});

/**
 * POST /api/wallet/topup/appypay/ref
 * Gera uma referência de pagamento Multicaixa via AppyPay.
 * Devolve Entidade + Referência + Validade.
 * O saldo é creditado automaticamente via webhook quando o utilizador pagar.
 */
router.post("/wallet/topup/appypay/ref", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = refSchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Dados inválidos.";
    res.status(400).json({ error: msg });
    return;
  }

  const { amount } = parsed.data;
  const userId = req.userId!;
  const internalRef = `REF-${Date.now()}-${userId}`;

  const webhookUrl = process.env["APPYPAY_WEBHOOK_URL"] ?? "";
  if (!webhookUrl) {
    res.status(503).json({
      error: "Pagamento automático não configurado. Usa o método de comprovativo manual.",
    });
    return;
  }

  try {
    // 1. Chamar AppyPay para gerar referência
    const charge = await createRefCharge({
      paymentMethod: "REF",
      amount,
      currency: "AOA",
      reference: internalRef,
      callbackUrl: webhookUrl,
    });

    const refData = charge.reference ?? null;

    // 2. Guardar registo no DB com status 'aguardando_pagamento'
    const [topup] = await db
      .insert(topupRequestsTable)
      .values({
        userId,
        amount: amount.toString(),
        reference: internalRef,
        status: "aguardando_pagamento",
        paymentMethod: "ref",
        externalChargeId: charge.id,
        externalRef: refData as any,
      })
      .returning({
        id: topupRequestsTable.id,
        reference: topupRequestsTable.reference,
        status: topupRequestsTable.status,
        criadoEm: topupRequestsTable.criadoEm,
      });

    res.status(201).json({
      ok: true,
      method: "ref",
      chargeId: charge.id,
      topupId: topup.id,
      amount,
      reference: internalRef,
      // Dados para mostrar ao utilizador na UI
      entity: refData?.entity ?? null,
      referenceNumber: refData?.referenceNumber ?? null,
      dueDate: refData?.dueDate ?? null,
      message: "Referência gerada. Paga em ATM, homebanking ou app bancária. O saldo é creditado automaticamente após confirmação.",
    });
  } catch (err: any) {
    req.log?.error({ err }, "[AppyPay REF] Erro ao gerar referência");

    if (err?.message?.includes("APPYPAY_CLIENT_ID")) {
      res.status(503).json({
        error: "Pagamento automático temporariamente indisponível. Tenta o comprovativo manual.",
      });
      return;
    }

    res.status(502).json({ error: "Erro ao gerar referência. Tenta novamente ou usa o comprovativo manual." });
  }
});

// ─── Levantamentos das criadoras ──────────────────────────────────────────────
// Fluxo: a criadora guarda o IBAN → pede levantamento (ganhos reservados na hora) → o admin aprova,
// marca como pago ou rejeita (a rejeição devolve os ganhos uma só vez; ver routes/admin.ts).
// O IBAN nunca aparece em listagens nem em logs; os audit_log gravam só ids e valores.

class WithdrawalError extends Error {
  constructor(msg: string, public readonly httpStatus: number) {
    super(msg);
    this.name = "WithdrawalError";
  }
}

const DEFAULT_MIN_WITHDRAWAL = 5000;

/** Mínimo de levantamento = definição `min_withdrawal_amount` (lida sempre da BD; default 5000). */
async function getMinWithdrawal(q: Pick<typeof db, "select">): Promise<number> {
  const [setting] = await q.select({ value: platformSettingsTable.value }).from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, "min_withdrawal_amount")).limit(1);
  const rawMin = (setting?.value as { value?: number } | null)?.value;
  return typeof rawMin === "number" && Number.isFinite(rawMin) && rawMin >= 0 ? rawMin : DEFAULT_MIN_WITHDRAWAL;
}

/** IBAN angolano: "AO" + 23 dígitos (25 caracteres), com dígitos de controlo válidos (ISO 13616, mod 97). */
export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}
export function isValidAngolanIban(iban: string): boolean {
  if (!/^AO\d{23}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const ch of digits) rest = (rest * 10 + Number(ch)) % 97;
  return rest === 1;
}

const payoutAccountSchema = z.object({
  iban: z.string().max(40).transform(normalizeIban).refine(isValidAngolanIban, "IBAN angolano inválido (AO + 23 dígitos)."),
  nomeTitular: z.string().trim().min(2).max(150),
  banco: z.string().trim().min(2).max(100),
});

const withdrawalSchema = z.object({
  valor: z.number().positive().finite().max(1_000_000_000)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "Máximo de 2 casas decimais."),
});

/** GET /api/wallet/withdrawals/info — mínimo (definições da plataforma) e ganhos disponíveis, ambos lidos do servidor. */
router.get("/wallet/withdrawals/info", requireAuth, requireCreator, async (req: AuthRequest, res): Promise<void> => {
  const [user] = await db.select({ ganhos: usersTable.ganhos }).from(usersTable).where(eq(usersTable.id, req.userId!));
  res.json({ minimo: await getMinWithdrawal(db), ganhos: Number(user?.ganhos ?? 0) });
});

/** GET /api/wallet/payout-account — dados de pagamento da própria criadora. */
router.get("/wallet/payout-account", requireAuth, requireCreator, async (req: AuthRequest, res): Promise<void> => {
  const [acc] = await db.select().from(creatorPayoutAccountsTable).where(eq(creatorPayoutAccountsTable.userId, req.userId!));
  res.json(acc ? { iban: acc.iban, nomeTitular: acc.nomeTitular, banco: acc.banco } : null);
});

/** PUT /api/wallet/payout-account — guarda/atualiza o IBAN (valida o formato angolano). */
router.put("/wallet/payout-account", requireAuth, requireCreator, validate(payoutAccountSchema), async (req: AuthRequest, res): Promise<void> => {
  const { iban, nomeTitular, banco } = req.body as z.infer<typeof payoutAccountSchema>;
  try {
    await db.transaction(async (tx) => {
      await tx.insert(creatorPayoutAccountsTable)
        .values({ userId: req.userId!, iban, nomeTitular, banco })
        .onConflictDoUpdate({ target: creatorPayoutAccountsTable.userId, set: { iban, nomeTitular, banco, atualizadoEm: new Date() } });
      // Auditoria na mesma transação (sem o IBAN): se falhar, nada é guardado.
      await tx.insert(auditLogTable).values({
        adminId: req.userId!, action: "payout_account_update", targetType: "user", targetId: req.userId!,
        details: { campos: ["iban", "nomeTitular", "banco"] }, ipAddress: req.ip ?? null,
      });
    });
    res.json({ iban, nomeTitular, banco });
  } catch (err) {
    req.log?.error({ err }, "Erro ao guardar dados de pagamento");
    res.status(500).json({ error: "Erro interno." });
  }
});

/**
 * POST /api/wallet/withdrawals { valor }
 * Reserva os ganhos (debita) e cria o pedido, numa só transação:
 *   lock da linha da criadora (FOR UPDATE) → valida conta, pendente, mínimo e ganhos → debita →
 *   insere o pedido com cópia do IBAN → grava audit_log. Se qualquer passo falhar, reverte tudo.
 * Clique duplo: o 2.º pedido vê o pendente (409); o índice único parcial é a rede de segurança.
 */
router.post("/wallet/withdrawals", requireAuth, requireCreator, validate(withdrawalSchema), async (req: AuthRequest, res): Promise<void> => {
  const { valor } = req.body as z.infer<typeof withdrawalSchema>;
  const userId = req.userId!;
  try {
    const created = await db.transaction(async (tx) => {
      const [user] = await tx.select({ ganhos: usersTable.ganhos }).from(usersTable).where(eq(usersTable.id, userId)).for("update");
      if (!user) throw new WithdrawalError("Utilizador não encontrado.", 404);

      const [acc] = await tx.select().from(creatorPayoutAccountsTable).where(eq(creatorPayoutAccountsTable.userId, userId));
      if (!acc) throw new WithdrawalError("Adiciona os teus dados de pagamento (IBAN) antes de pedir um levantamento.", 400);

      const [pendente] = await tx.select({ id: withdrawalRequestsTable.id }).from(withdrawalRequestsTable)
        .where(and(eq(withdrawalRequestsTable.creatorId, userId), eq(withdrawalRequestsTable.status, "pendente"))).limit(1);
      if (pendente) throw new WithdrawalError("Já tens um levantamento pendente.", 409);

      // Mínimo lido a cada pedido (definições da plataforma).
      const minimo = await getMinWithdrawal(tx);
      if (valor < minimo) throw new WithdrawalError(`O valor mínimo de levantamento é ${minimo.toLocaleString("pt-PT")} Kz.`, 400);

      if (Number(user.ganhos) < valor) throw new WithdrawalError("Ganhos insuficientes para este levantamento.", 402);

      await tx.update(usersTable).set({ ganhos: sql`${usersTable.ganhos} - ${valor}` }).where(eq(usersTable.id, userId));

      const [pedido] = await tx.insert(withdrawalRequestsTable).values({
        creatorId: userId,
        amount: String(valor),
        method: "transferencia_bancaria",
        destinationDetails: { iban: acc.iban, nomeTitular: acc.nomeTitular, banco: acc.banco },
        status: "pendente",
      }).returning();

      await tx.insert(auditLogTable).values({
        adminId: userId, action: "withdrawal_requested", targetType: "withdrawal", targetId: pedido.id,
        details: { amount: valor, status: "pendente" }, ipAddress: req.ip ?? null,
      });
      return pedido;
    });

    res.status(201).json({ id: created.id, valor: Number(created.amount), status: created.status, criadoEm: created.criadoEm.toISOString() });
  } catch (err) {
    if (err instanceof WithdrawalError) {
      res.status(err.httpStatus).json({ error: err.message });
      return;
    }
    const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") {
      res.status(409).json({ error: "Já tens um levantamento pendente." });
      return;
    }
    req.log?.error({ err }, "Erro ao criar levantamento");
    res.status(500).json({ error: "Erro interno." });
  }
});

/** GET /api/wallet/withdrawals — histórico dos pedidos da própria utilizadora (sem IBAN). */
router.get("/wallet/withdrawals", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const rows = await db.select({
    id: withdrawalRequestsTable.id,
    amount: withdrawalRequestsTable.amount,
    status: withdrawalRequestsTable.status,
    notes: withdrawalRequestsTable.notes,
    criadoEm: withdrawalRequestsTable.criadoEm,
    processedAt: withdrawalRequestsTable.processedAt,
  }).from(withdrawalRequestsTable)
    .where(eq(withdrawalRequestsTable.creatorId, req.userId!))
    .orderBy(desc(withdrawalRequestsTable.criadoEm))
    .limit(100);
  res.json(rows.map((r) => ({
    id: r.id, valor: Number(r.amount), status: r.status, motivo: r.status === "rejeitado" ? r.notes : null,
    criadoEm: r.criadoEm.toISOString(), processadoEm: r.processedAt?.toISOString() ?? null,
  })));
});

export default router;
