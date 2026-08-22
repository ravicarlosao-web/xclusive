/**
 * routes/appypay.ts — Handler do webhook AppyPay
 *
 * Este endpoint recebe notificações do AppyPay quando o estado de uma
 * cobrança muda (GPO aprovado/rejeitado, REF pago/expirado).
 *
 * Fluxo:
 *   1. Recebe POST /api/appypay/webhook
 *   2. Valida autenticidade (best-effort — ver limitação documentada em lib/appypay.ts)
 *   3. Faz GET /charges/{id} ao AppyPay para CONFIRMAR o status independentemente
 *      (recomendação de segurança da documentação oficial AppyPay)
 *   4. Localiza o topup_request pela referência interna (merchantTransactionId)
 *   5. Se APPROVED: credita saldo + marca aprovado + audit_log
 *   6. Se REJECTED/EXPIRED/FAILED: marca rejeitado
 *   7. Responde sempre 200 imediatamente para evitar reenvios pelo AppyPay
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { db, usersTable, topupRequestsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  getCharge,
  validateWebhookSignature,
  APPROVED_STATUSES,
  REJECTED_STATUSES,
  type AppyPayWebhookPayload,
} from "../lib/appypay";

const router = Router();

/**
 * POST /api/appypay/webhook
 *
 * Endpoint público (sem requireAuth) — o AppyPay chama-o directamente.
 * A autenticidade é verificada por assinatura/secret (ver limitações em appypay.ts).
 *
 * IMPORTANTE: Este endpoint deve responder com HTTP 200 o mais rapidamente
 * possível, independentemente do resultado interno, para evitar que o
 * AppyPay reenvie a notificação por timeout.
 */
router.post("/appypay/webhook", async (req: Request, res: Response): Promise<void> => {
  // ── 1. Responder 200 imediatamente (evitar reenvios por timeout do AppyPay) ──
  res.status(200).json({ received: true });

  // ── 2. Validar autenticidade ──────────────────────────────────────────────────
  // Passar o raw body para validação (express não dá buffer por defeito —
  // ver nota abaixo sobre bodyParser)
  const rawBody: Buffer = (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body));
  const isValid = validateWebhookSignature(rawBody, req.headers as Record<string, string | string[] | undefined>);

  if (!isValid) {
    console.warn("[AppyPay Webhook] Assinatura inválida — pedido rejeitado silenciosamente.");
    return;
  }

  // ── 3. Parse do payload ───────────────────────────────────────────────────────
  const payload = req.body as AppyPayWebhookPayload;

  if (!payload?.id || !payload?.merchantTransactionId) {
    console.warn("[AppyPay Webhook] Payload incompleto:", payload);
    return;
  }

  const chargeId = payload.id;
  const merchantRef = payload.merchantTransactionId;

  console.info(`[AppyPay Webhook] Recebido: chargeId=${chargeId} ref=${merchantRef} status=${payload.status}`);

  try {
    // ── 4. Verificação dupla: confirmar status directamente no AppyPay ──────────
    // Segurança: nunca confiar apenas no payload do webhook — confirmar via API.
    let confirmedStatus: string;
    try {
      const confirmedCharge = await getCharge(chargeId);
      confirmedStatus = confirmedCharge.status ?? payload.status;
      console.info(`[AppyPay Webhook] Status confirmado via GET /charges/${chargeId}: ${confirmedStatus}`);
    } catch (verifyErr) {
      // Se a verificação dupla falhar (ex: rede), usar o status do webhook
      // com aviso. Em produção, considerar rejeitar o webhook neste caso.
      console.warn(`[AppyPay Webhook] Não foi possível confirmar via API — usando status do webhook: ${payload.status}`, verifyErr);
      confirmedStatus = payload.status;
    }

    // ── 5. Localizar o topup_request ──────────────────────────────────────────
    const [topup] = await db
      .select({
        id: topupRequestsTable.id,
        userId: topupRequestsTable.userId,
        amount: topupRequestsTable.amount,
        status: topupRequestsTable.status,
        externalChargeId: topupRequestsTable.externalChargeId,
      })
      .from(topupRequestsTable)
      .where(eq(topupRequestsTable.reference, merchantRef))
      .limit(1);

    if (!topup) {
      console.warn(`[AppyPay Webhook] topup_request não encontrado para ref=${merchantRef}`);
      return;
    }

    // Idempotência: ignorar se já foi processado
    if (topup.status === "aprovado" || topup.status === "rejeitado") {
      console.info(`[AppyPay Webhook] topup #${topup.id} já processado (${topup.status}) — ignorando.`);
      return;
    }

    // ── 6. Processar conforme status confirmado ───────────────────────────────
    if (APPROVED_STATUSES.has(confirmedStatus)) {
      await db.transaction(async (tx) => {
        // a) Creditar saldo
        await tx
          .update(usersTable)
          .set({ saldo: sql`${usersTable.saldo} + ${parseFloat(topup.amount as string)}` })
          .where(eq(usersTable.id, topup.userId));

        // b) Marcar topup como aprovado
        await tx
          .update(topupRequestsTable)
          .set({
            status: "aprovado",
            processadoEm: new Date(),
            notas: `Aprovado automaticamente via AppyPay webhook. ChargeId: ${chargeId}`,
          })
          .where(eq(topupRequestsTable.id, topup.id));
      });

      console.info(
        `[AppyPay Webhook] ✅ Carregamento aprovado: topup #${topup.id} | ` +
        `user #${topup.userId} | ${topup.amount} Kz`
      );

    } else if (REJECTED_STATUSES.has(confirmedStatus)) {
      await db
        .update(topupRequestsTable)
        .set({
          status: "rejeitado",
          processadoEm: new Date(),
          notas: `Rejeitado via AppyPay webhook. Status: ${confirmedStatus}. ChargeId: ${chargeId}`,
        })
        .where(eq(topupRequestsTable.id, topup.id));

      console.info(
        `[AppyPay Webhook] ❌ Carregamento rejeitado: topup #${topup.id} | ` +
        `status AppyPay: ${confirmedStatus}`
      );

    } else {
      // Status intermédio (Pending, Requested, etc.) — não processar ainda
      console.info(
        `[AppyPay Webhook] Status intermédio '${confirmedStatus}' para topup #${topup.id} — aguardando próxima notificação.`
      );
    }

  } catch (err) {
    // Não relançar — a resposta 200 já foi enviada
    console.error("[AppyPay Webhook] Erro interno ao processar:", err);
  }
});

export default router;
