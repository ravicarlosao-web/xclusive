/**
 * lib/appypay.ts — Cliente HTTP para a API do AppyPay
 *
 * Documentação oficial: https://appypay.stoplight.io
 * Suporte técnico:      comercial@appy.co.ao / +244 947 868 039
 *
 * ─── Ambientes ───────────────────────────────────────────────────────────────
 *   Sandbox  API:   https://gwy-api-tst.appypay.co.ao/v2.0
 *   Sandbox  Token: https://login.microsoftonline.com/appypaydev.onmicrosoft.com/oauth2/token
 *   Produção API:   https://gwy-api.appypay.co.ao/v2.0
 *   Produção Token: https://login.microsoftonline.com/auth.appypay.co.ao/oauth2/token
 *
 * Para trocar de sandbox para produção: alterar as variáveis de ambiente
 *   APPYPAY_BASE_URL e APPYPAY_TOKEN_URL — sem alterações de código.
 *
 * ─── Autenticação ────────────────────────────────────────────────────────────
 *   OAuth2 client_credentials via Azure Active Directory.
 *   O access_token tem validade de ~3600 s (1 hora).
 *   Este módulo faz cache do token e renova-o automaticamente 60 s antes
 *   de expirar, para evitar chamadas desnecessárias ao token endpoint.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

/**
 * Payload para criar uma cobrança GPO (Multicaixa Express).
 * O utilizador aprova no telemóvel dele — resposta via webhook.
 */
export interface AppyPayGpoPayload {
  paymentMethod: "GPO";
  amount: number;           // Valor em Kz (sem decimais — ex: 2500)
  currency: "AOA";
  reference: string;        // Referência interna única do merchant (ex: XCL-123456)
  callbackUrl: string;      // URL do nosso webhook para receber confirmação
  paymentInfo: {
    phoneNumber: string;    // Número de telemóvel Multicaixa Express (9+ dígitos)
  };
}

/**
 * Payload para criar uma cobrança REF (Pagamento por Referência).
 * Devolve Entidade + Referência para o utilizador pagar em ATM/homebanking.
 */
export interface AppyPayRefPayload {
  paymentMethod: "REF";
  amount: number;
  currency: "AOA";
  reference: string;        // Referência interna única do merchant
  callbackUrl: string;      // URL do nosso webhook para confirmação quando pago
  // TODO_CONFIRM: Alguns endpoints aceitam expiryHours para TTL personalizado.
  // Valor omitido = default da plataforma (tipicamente 72 h).
}

/** Dados da referência bancária devolvidos pelo AppyPay para pagamentos REF */
export interface AppyPayRefData {
  entity: string;           // Código de entidade Multicaixa (ex: "00123")
  referenceNumber: string;  // Referência numérica para o utilizador (9-15 dígitos)
  dueDate: string;          // ISO 8601 — data/hora de expiração
}

/** Resposta de criação de charge (GPO ou REF) */
export interface AppyPayChargeResponse {
  id: string;               // ID único do charge no AppyPay (usar no webhook lookup)
  status: string;           // Ex: "Requested", "Pending", "Active", "Approved", "Failed"
  paymentMethod: string;
  amount: number;
  currency: string;
  merchantTransactionId: string; // = nossa reference
  reference?: AppyPayRefData;    // Presente apenas em REF
  createdDate?: string;
}

/**
 * Payload recebido no webhook do AppyPay quando o estado muda.
 *
 * NOTA DE SEGURANÇA: A documentação pública do AppyPay não especifica
 * um mecanismo de assinatura HMAC/JWT para webhooks. A recomendação
 * oficial é fazer uma chamada GET /charges/{id} para confirmar o estado
 * independentemente do conteúdo do webhook.
 *
 * TODO_CONFIRM: Verificar com o suporte AppyPay se existe header de
 * assinatura (ex: X-AppyPay-Signature) e qual o algoritmo — actualizar
 * validateWebhookSignature() em consequência.
 */
export interface AppyPayWebhookPayload {
  id: string;                    // ID do charge
  merchantTransactionId: string; // = nossa reference interna
  status: string;                // "APPROVED" | "REJECTED" | "EXPIRED" | "FAILED"
  amount: number;
  currency?: string;
  processedDate?: string;
  reference?: AppyPayRefData;
  // Campos adicionais podem estar presentes — usar unknown para flexibilidade
  [key: string]: unknown;
}

// ─── Cache de token OAuth2 ────────────────────────────────────────────────────

interface TokenCache {
  accessToken: string;
  expiresAt: number; // unix ms
}

let tokenCache: TokenCache | null = null;

/** Obtém (ou renova) o access token OAuth2. Cache interno de 60 s de margem. */
async function getAccessToken(): Promise<string> {
  const now = Date.now();

  // Reutilizar se ainda válido (com margem de 60 s)
  if (tokenCache && tokenCache.expiresAt - 60_000 > now) {
    return tokenCache.accessToken;
  }

  const tokenUrl = process.env["APPYPAY_TOKEN_URL"] ??
    "https://login.microsoftonline.com/appypaydev.onmicrosoft.com/oauth2/token";

  const clientId = process.env["APPYPAY_CLIENT_ID"];
  const clientSecret = process.env["APPYPAY_CLIENT_SECRET"];

  if (!clientId || !clientSecret) {
    throw new Error(
      "[AppyPay] APPYPAY_CLIENT_ID e APPYPAY_CLIENT_SECRET não estão definidos. " +
      "Adiciona-os ao ficheiro .env para ativar os pagamentos automáticos."
    );
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    // TODO_CONFIRM: Verificar com suporte AppyPay se é necessário scope específico.
    // Exemplo: scope: "api" — omitido por defeito até confirmação.
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[AppyPay] Falha ao obter token OAuth2: HTTP ${res.status} — ${text}`);
  }

  const data = await res.json() as {
    access_token: string;
    expires_in: number; // segundos
  };

  if (!data.access_token) {
    throw new Error("[AppyPay] Resposta do token endpoint sem access_token.");
  }

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };

  return tokenCache.accessToken;
}

// ─── Cliente HTTP base ────────────────────────────────────────────────────────

/** Headers base para todas as chamadas à API AppyPay */
async function buildHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    // Para resposta síncrona. Para assíncrona (resultado via webhook):
    // "Accept": "application/vnd.appypay.asyncapi+json"
    // TODO_CONFIRM: Verificar qual o modo preferido em produção.
    "Accept": "application/json",
  };
}

function getBaseUrl(): string {
  return (process.env["APPYPAY_BASE_URL"] ?? "https://gwy-api-tst.appypay.co.ao/v2.0")
    .replace(/\/$/, "");
}

// ─── Funções públicas ─────────────────────────────────────────────────────────

/**
 * Cria um charge GPO (Multicaixa Express).
 * Resposta pode ser síncrona (status imediato) ou assíncrona (via webhook).
 */
export async function createGpoCharge(
  payload: AppyPayGpoPayload
): Promise<AppyPayChargeResponse> {
  const url = `${getBaseUrl()}/charges`;
  const headers = await buildHeaders();

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({})) as AppyPayChargeResponse;

  if (!res.ok) {
    throw new Error(
      `[AppyPay] createGpoCharge falhou: HTTP ${res.status} — ${JSON.stringify(data)}`
    );
  }

  return data;
}

/**
 * Cria um charge REF (Pagamento por Referência).
 * A resposta devolve imediatamente a Entidade + Referência + Validade.
 * O crédito do saldo chega via webhook quando o utilizador pagar.
 */
export async function createRefCharge(
  payload: AppyPayRefPayload
): Promise<AppyPayChargeResponse> {
  const url = `${getBaseUrl()}/charges`;
  const headers = await buildHeaders();

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({})) as AppyPayChargeResponse;

  if (!res.ok) {
    throw new Error(
      `[AppyPay] createRefCharge falhou: HTTP ${res.status} — ${JSON.stringify(data)}`
    );
  }

  return data;
}

/**
 * Verifica o estado de um charge pelo ID.
 * Usar no handler do webhook para confirmar independentemente o status
 * (recomendação de segurança da documentação oficial AppyPay).
 */
export async function getCharge(chargeId: string): Promise<AppyPayChargeResponse> {
  const url = `${getBaseUrl()}/charges/${chargeId}`;
  const headers = await buildHeaders();

  const res = await fetch(url, { method: "GET", headers });
  const data = await res.json().catch(() => ({})) as AppyPayChargeResponse;

  if (!res.ok) {
    throw new Error(
      `[AppyPay] getCharge(${chargeId}) falhou: HTTP ${res.status} — ${JSON.stringify(data)}`
    );
  }

  return data;
}

/**
 * Valida (best-effort) a autenticidade de um webhook recebido.
 *
 * LIMITAÇÃO CONHECIDA: A documentação pública do AppyPay não especifica um
 * mecanismo de assinatura HMAC. Esta função verifica o header
 * X-AppyPay-Webhook-Secret contra APPYPAY_WEBHOOK_SECRET se estiver definido.
 *
 * TODO_CONFIRM: Quando tivermos acesso ao suporte AppyPay sandbox, confirmar:
 *   1. Nome exacto do header de assinatura
 *   2. Algoritmo (HMAC-SHA256? Bearer token? Basic Auth?)
 *   3. Como computar/verificar a assinatura
 * Actualizar esta função em conformidade.
 *
 * @returns true se válido (ou se verificação não configurada), false se inválido
 */
export function validateWebhookSignature(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>
): boolean {
  const secret = process.env["APPYPAY_WEBHOOK_SECRET"];

  if (!secret) {
    // Sem secret configurado — aceitar mas registar aviso
    // (em produção deve sempre estar configurado)
    console.warn(
      "[AppyPay] APPYPAY_WEBHOOK_SECRET não definido. " +
      "A aceitar webhook sem verificação de autenticidade. " +
      "TODO_CONFIRM: Configurar secret após confirmação com suporte AppyPay."
    );
    return true;
  }

  // Verificação simples por header secret (modelo mais comum em gateways angolanos)
  // TODO_CONFIRM: Substituir por HMAC-SHA256 quando algoritmo confirmado
  const receivedSecret = headers["x-appypay-webhook-secret"] ??
    headers["x-webhook-secret"] ??
    headers["authorization"];

  if (Array.isArray(receivedSecret)) {
    return receivedSecret.includes(secret) || receivedSecret.includes(`Bearer ${secret}`);
  }

  return receivedSecret === secret || receivedSecret === `Bearer ${secret}`;
}

/** Statuses de charge que indicam pagamento confirmado */
export const APPROVED_STATUSES = new Set(["APPROVED", "Approved", "approved", "Active"]);

/** Statuses de charge que indicam pagamento falhado/expirado */
export const REJECTED_STATUSES = new Set([
  "REJECTED", "Rejected", "rejected",
  "FAILED", "Failed", "failed",
  "EXPIRED", "Expired", "expired",
]);
