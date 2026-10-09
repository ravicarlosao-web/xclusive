/**
 * routes/appypay.ts — Handler do webhook AppyPay
 *
 * Este endpoint recebe notificações do AppyPay quando o estado de uma
 * cobrança muda (GPO aprovado/rejeitado, REF pago/expirado).
 *
 * Fluxo:
 *   1. Recebe POST /api/appypay/webhook
 *   2. Autentica (segredo partilhado, tempo constante). Sem APPYPAY_WEBHOOK_SECRET recusa tudo (503).
 *   3. Faz GET /charges/{id} à AppyPay para CONFIRMAR o estado. Se falhar responde erro (502) para
 *      a AppyPay repetir: nunca se confia no estado do corpo do webhook.
 *   4. Localiza o topup_request pela referência interna (merchantTransactionId) e confirma que o
 *      charge, a referência e o valor coincidem com o pedido original.
 *   5. Se APPROVED: numa só transação marca "aprovado" (UPDATE … WHERE status em curso … RETURNING)
 *      e só então credita o saldo, com o valor da base de dados. Webhooks repetidos não creditam.
 *   6. Se REJECTED/EXPIRED/FAILED: marca rejeitado (também atómico).
 *   7. Não regista o corpo, cabeçalhos nem segredos: só id do pedido, estado e resultado.
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { db, usersTable, topupRequestsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  getCharge,
  isWebhookSecretConfigured,
  validateWebhookSignature,
  APPROVED_STATUSES,
  REJECTED_STATUSES,
  type AppyPayWebhookPayload,
} from "../lib/appypay";

const router = Router();

/** Estados AppyPay em curso: só estes pedidos podem ser aprovados/rejeitados pelo webhook. */
const IN_FLIGHT = ["processando", "aguardando_pagamento"];

/**
 * POST /api/appypay/webhook
 *
 * Endpoint público (sem requireAuth) — o AppyPay chama-o directamente.
 * Respostas: 200 processado/ignorado de forma definitiva; 401 não autenticado; 503 sem segredo
 * configurado; 502/500 falha temporária (a AppyPay repete — o processamento é idempotente).
 */
router.post("/appypay/webhook", async (req: Request, res: Response): Promise<void> => {
  // ── 1. Autenticidade (falha fechada) ──────────────────────────────────────────
  if (!isWebhookSecretConfigured()) {
    req.log?.error("AppyPay webhook recusado: APPYPAY_WEBHOOK_SECRET não está definido.");
    res.status(503).json({ error: "Webhook não configurado." });
    return;
  }
  const rawBody: Buffer = (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body));
  if (!validateWebhookSignature(rawBody, req.headers as Record<string, string | string[] | undefined>)) {
    req.log?.warn("AppyPay webhook recusado: autenticação inválida.");
    res.status(401).json({ error: "Não autorizado." });
    return;
  }

  // ── 2. Payload mínimo (só ids; o estado do corpo nunca é usado) ───────────────
  const payload = req.body as AppyPayWebhookPayload;
  if (typeof payload?.id !== "string" || typeof payload?.merchantTransactionId !== "string") {
    req.log?.warn("AppyPay webhook com payload incompleto.");
    res.status(400).json({ error: "Payload inválido." });
    return;
  }
  const chargeId = payload.id;
  const merchantRef = payload.merchantTransactionId;

  try {
    // ── 3. Confirmar o estado directamente na AppyPay ───────────────────────────
    // Se falhar (rede, timeout, charge inexistente) responde erro e NÃO credita.
    let confirmed;
    try {
      confirmed = await getCharge(chargeId);
    } catch {
      req.log?.warn("AppyPay webhook: não foi possível confirmar o charge — nada processado.");
      res.status(502).json({ error: "Não foi possível confirmar o pagamento." });
      return;
    }
    const confirmedStatus = confirmed?.status;
    if (typeof confirmedStatus !== "string") {
      req.log?.warn("AppyPay webhook: confirmação sem estado — nada processado.");
      res.status(502).json({ error: "Confirmação inválida." });
      return;
    }

    // ── 4. Localizar o topup_request ────────────────────────────────────────────
    const [topup] = await db
      .select({
        id: topupRequestsTable.id,
        userId: topupRequestsTable.userId,
        amount: topupRequestsTable.amount,
        status: topupRequestsTable.status,
        paymentMethod: topupRequestsTable.paymentMethod,
        externalChargeId: topupRequestsTable.externalChargeId,
      })
      .from(topupRequestsTable)
      .where(eq(topupRequestsTable.reference, merchantRef))
      .limit(1);

    if (!topup) {
      req.log?.warn("AppyPay webhook: pedido não encontrado.");
      res.status(200).json({ received: true });
      return;
    }

    // Só pedidos AppyPay em curso, ligados a ESTE charge (um carregamento manual nunca é aprovado aqui).
    if (!IN_FLIGHT.includes(topup.status)) {
      req.log?.info({ topupId: topup.id, status: topup.status }, "AppyPay webhook: pedido já processado ou não é AppyPay.");
      res.status(200).json({ received: true });
      return;
    }
    if (
      (topup.paymentMethod !== "gpo" && topup.paymentMethod !== "ref") ||
      !topup.externalChargeId ||
      topup.externalChargeId !== chargeId ||
      (confirmed.merchantTransactionId !== undefined && confirmed.merchantTransactionId !== merchantRef)
    ) {
      req.log?.error({ topupId: topup.id }, "ALERTA AppyPay webhook: charge não corresponde ao pedido — ignorado.");
      res.status(200).json({ received: true });
      return;
    }

    // ── 5. Processar conforme o estado CONFIRMADO ───────────────────────────────
    if (APPROVED_STATUSES.has(confirmedStatus)) {
      // O valor confirmado pela AppyPay tem de coincidir com o do pedido original.
      if (!(Math.abs(Number(confirmed.amount) - Number(topup.amount)) < 0.005)) {
        req.log?.error({ topupId: topup.id }, "ALERTA AppyPay webhook: valor confirmado diverge do pedido — não creditado.");
        res.status(200).json({ received: true });
        return;
      }

      // Atómico e idempotente: só quem passa o pedido de "em curso" a "aprovado" credita.
      const credited = await db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(topupRequestsTable)
          .set({
            status: "aprovado",
            processadoEm: new Date(),
            notas: "Aprovado automaticamente via AppyPay webhook (estado confirmado na AppyPay).",
          })
          .where(and(eq(topupRequestsTable.id, topup.id), inArray(topupRequestsTable.status, IN_FLIGHT)))
          .returning({ userId: topupRequestsTable.userId, amount: topupRequestsTable.amount });
        if (!claimed) return false;

        // Valor da base de dados (pedido original), nunca o do corpo do webhook.
        await tx
          .update(usersTable)
          .set({ saldo: sql`${usersTable.saldo} + ${claimed.amount}` })
          .where(eq(usersTable.id, claimed.userId));
        return true;
      });

      req.log?.info({ topupId: topup.id, status: confirmedStatus, result: credited ? "creditado" : "ja_processado" }, "AppyPay webhook");
    } else if (REJECTED_STATUSES.has(confirmedStatus)) {
      const [rejected] = await db
        .update(topupRequestsTable)
        .set({
          status: "rejeitado",
          processadoEm: new Date(),
          notas: `Rejeitado via AppyPay webhook. Estado confirmado: ${confirmedStatus}.`,
        })
        .where(and(eq(topupRequestsTable.id, topup.id), inArray(topupRequestsTable.status, IN_FLIGHT)))
        .returning({ id: topupRequestsTable.id });

      req.log?.info({ topupId: topup.id, status: confirmedStatus, result: rejected ? "rejeitado" : "ja_processado" }, "AppyPay webhook");
    } else {
      // Estado intermédio (Pending, Requested, etc.) — aguardar a próxima notificação.
      req.log?.info({ topupId: topup.id, status: confirmedStatus, result: "intermedio" }, "AppyPay webhook");
    }

    res.status(200).json({ received: true });
  } catch (err) {
    // Falha temporária (ex.: base de dados): erro para a AppyPay repetir; o processamento é idempotente.
    req.log?.error({ err }, "AppyPay webhook: erro interno ao processar.");
    res.status(500).json({ error: "Erro interno." });
  }
});

export default router;
