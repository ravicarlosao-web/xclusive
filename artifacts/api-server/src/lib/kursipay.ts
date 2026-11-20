/**
 * kursiPay (gateway de pagamentos de Angola): configuração, cliente HTTP e verificação do webhook. SÓ ENTRADAS: este módulo nunca chama os endpoints de reembolso.
 * Variáveis (só no .env da API, nunca no repositório nem em registos, erros ou auditoria): KURSIPAY_SECRET_KEY (kp_test_… sandbox | kp_live_… produção; o ambiente deriva do prefixo)
 * e KURSIPAY_WEBHOOK_SECRET (whsec_…). Sem elas (ou inválidas) o servidor arranca com um aviso e as rotas da kursiPay respondem 503.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export type AmbienteKursipay = "sandbox" | "production";
export interface ConfigKursipay { chave: string; segredoWebhook: string; ambiente: AmbienteKursipay; apiBase: string }

const API_BASE_PADRAO = "https://api.kursipay.com/v1";
/** O checkout é SEMPRE neste domínio (o caminho vem da API; o domínio nunca). */
export const CHECKOUT_BASE = "https://kursipay.com";
export const TEMPO_LIMITE_MS = 15_000;
export const IDADE_MAX_ASSINATURA_S = 300;
/** Tolerância a relógios desalinhados para um timestamp «no futuro». */
export const FUTURO_TOLERADO_S = 5;

const RE_CHAVE = /^kp_(test|live)_(?!pk_)[A-Za-z0-9_-]{16,}$/;     // chave SECRETA (as públicas kp_…_pk_… não servem)
const RE_SEGREDO_WEBHOOK = /^whsec_[A-Za-z0-9_-]{16,}$/;
type Ambiente = Record<string, string | undefined>;

/** A base da API só pode ser a oficial ou, para testes, um servidor LOCAL (nunca um host arbitrário a quem se enviava a chave). */
function apiBaseDe(env: Ambiente): string {
  const bruto = (env.KURSIPAY_API_BASE ?? "").trim().replace(/\/+$/, "");
  if (!bruto) return API_BASE_PADRAO;
  if (/^https:\/\/api\.kursipay\.com(\/v1)?$/.test(bruto) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?(\/v1)?$/.test(bruto)) return bruto.endsWith("/v1") ? bruto : `${bruto}/v1`;
  return API_BASE_PADRAO;
}

/** A configuração válida, ou null (então as rotas respondem 503). */
export function lerConfigKursipay(env: Ambiente = process.env): ConfigKursipay | null {
  const chave = env.KURSIPAY_SECRET_KEY?.trim() ?? "", segredoWebhook = env.KURSIPAY_WEBHOOK_SECRET?.trim() ?? "";
  const m = RE_CHAVE.exec(chave);
  if (!m || !RE_SEGREDO_WEBHOOK.test(segredoWebhook)) return null;
  return { chave, segredoWebhook, ambiente: m[1] === "test" ? "sandbox" : "production", apiBase: apiBaseDe(env) };
}
export const kursipayDisponivel = (env: Ambiente = process.env): boolean => lerConfigKursipay(env) !== null;

/** Aviso de arranque (sem valores): quais das variáveis faltam ou são inválidas. null = tudo bem. */
export function avisoConfigKursipay(env: Ambiente = process.env): string | null {
  if (lerConfigKursipay(env)) return null;
  const faltam: string[] = [];
  if (!RE_CHAVE.test(env.KURSIPAY_SECRET_KEY?.trim() ?? "")) faltam.push("KURSIPAY_SECRET_KEY");
  if (!RE_SEGREDO_WEBHOOK.test(env.KURSIPAY_WEBHOOK_SECRET?.trim() ?? "")) faltam.push("KURSIPAY_WEBHOOK_SECRET");
  return `kursiPay indisponível: ${faltam.join(" e ")} em falta ou inválida(s) (chave secreta kp_test_… ou kp_live_…; segredo do webhook whsec_…): as rotas da kursiPay respondem 503 e o resto da API funciona.`;
}

// ── Assinatura do webhook ──────────────────────────────────────────────────────────────────────────────
/**
 * KursiPay-Signature: «t=<segundos Unix>,v1=<HMAC-SHA256 em hexadecimal de "t.corpo_cru">». Verificação RÍGIDA: t inteiro só com dígitos, v1 hexadecimal de 64 caracteres,
 * exatamente estas duas partes, comparação em tempo constante com verificação de comprimento, idade máxima de 300 s e nada no futuro (além da tolerância de relógio).
 */
export function verificarAssinatura(corpoCru: Buffer, cabecalho: unknown, segredo: string, agoraMs: number = Date.now()): boolean {
  if (typeof cabecalho !== "string" || cabecalho.length > 200 || !Buffer.isBuffer(corpoCru)) return false;
  const partes = cabecalho.split(",");
  if (partes.length !== 2) return false;
  let t: string | null = null, v1: string | null = null;
  for (const p of partes) {
    const m = /^(t|v1)=(.*)$/.exec(p);
    if (!m) return false;
    if (m[1] === "t") { if (t !== null) return false; t = m[2]; } else { if (v1 !== null) return false; v1 = m[2]; }
  }
  if (t === null || v1 === null || !/^\d{1,12}$/.test(t) || !/^[0-9a-fA-F]{64}$/.test(v1)) return false;
  const agoraS = Math.floor(agoraMs / 1000), ts = Number(t);
  if (agoraS - ts > IDADE_MAX_ASSINATURA_S || ts - agoraS > FUTURO_TOLERADO_S) return false;
  const esperado = createHmac("sha256", segredo).update(`${t}.`).update(corpoCru).digest();
  const recebido = Buffer.from(v1, "hex");
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

// ── Esquemas (formatos da documentação) ───────────────────────────────────────────────────────────────────
const Dinheiro = z.object({ amount: z.number().int().safe(), currency: z.string().min(3).max(3) });
export const PagamentoSchema = z.object({
  id: z.string().regex(/^pay_[A-Za-z0-9]{4,40}$/),
  environment: z.enum(["sandbox", "production"]),
  status: z.string().min(1).max(30),
  amount: Dinheiro,
  externalReference: z.string().max(100).nullable().optional(),
  checkoutUrl: z.string().max(300).optional(),
  paidAt: z.string().nullable().optional(),
}).passthrough();
export type PagamentoKursipay = z.infer<typeof PagamentoSchema>;

/** Envelope dos webhooks. Em data.object só se exige o que cada tipo precisa (os campos de payout não estão documentados). */
export const EnvelopeSchema = z.object({
  id: z.string().regex(/^evt_[A-Za-z0-9]{4,40}$/),
  type: z.string().min(1).max(40),
  created_at: z.string().optional(),
  data: z.object({ object: z.object({ id: z.string().min(1).max(60), environment: z.enum(["sandbox", "production"]).optional() }).passthrough() }),
}).passthrough();
export type EnvelopeKursipay = z.infer<typeof EnvelopeSchema>;

// ── Cliente HTTP (15 s; no máximo UMA repetição, com a mesma Idempotency-Key) ───────────────────────────────────
export class KursipayErro extends Error {
  constructor(public readonly codigo: string, public readonly http: number, public readonly retryAfterS?: number) { super(`kursiPay: ${codigo}`); this.name = "KursipayErro"; }
}

async function pedir(cfg: ConfigKursipay, metodo: "GET" | "POST", caminho: string, opc: { corpo?: unknown; idempotencyKey?: string } = {}): Promise<unknown> {
  let ultimo: unknown;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const res = await fetch(`${cfg.apiBase}${caminho}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${cfg.chave}`, ...(opc.corpo !== undefined ? { "Content-Type": "application/json" } : {}), ...(opc.idempotencyKey ? { "Idempotency-Key": opc.idempotencyKey } : {}) },
        ...(opc.corpo !== undefined ? { body: JSON.stringify(opc.corpo) } : {}),
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      });
      const texto = await res.text();
      let json: unknown = null; try { json = JSON.parse(texto); } catch { /* corpo não-JSON */ }
      if (res.ok) { if (json === null) throw new KursipayErro("resposta_invalida", res.status); return json; }
      const codigo = String(((json as { error?: { code?: unknown } } | null)?.error?.code) ?? `http_${res.status}`).slice(0, 40);
      const ra = Number(res.headers.get("retry-after")); const e = new KursipayErro(codigo, res.status, Number.isFinite(ra) && ra > 0 ? Math.ceil(ra) : undefined);
      if (res.status >= 500 && tentativa === 0) { ultimo = e; continue; }   // 5xx: uma repetição
      throw e;
    } catch (err) {
      if (err instanceof KursipayErro) throw err;
      ultimo = new KursipayErro("rede", 0);   // timeout ou falha de rede: sem detalhes (nunca o URL nem cabeçalhos)
      if (tentativa === 0) continue;
    }
  }
  throw ultimo instanceof KursipayErro ? ultimo : new KursipayErro("rede", 0);
}

export interface PedidoCriarPagamento { valorCentimos: number; referencia: string }
/** POST /v1/payments: SÓ o que é preciso (valor em cêntimos inteiros, AOA, descrição neutra, métodos sem cartão nem Pix, sem nenhum dado pessoal). */
export async function criarPagamento(cfg: ConfigKursipay, p: PedidoCriarPagamento): Promise<PagamentoKursipay> {
  if (!Number.isSafeInteger(p.valorCentimos) || p.valorCentimos <= 0) throw new KursipayErro("valor_invalido", 0);
  const json = await pedir(cfg, "POST", "/payments", {
    idempotencyKey: `xclusive-${p.referencia}`,
    corpo: {
      amount: { amount: p.valorCentimos, currency: "AOA" },
      description: "Carregamento de saldo",
      allowedMethods: ["multicaixa_express", "reference", "paypay"],
      externalReference: p.referencia,
      expiresInMin: 1440,
    },
  });
  const r = PagamentoSchema.safeParse(json); if (!r.success) throw new KursipayErro("resposta_invalida", 0);
  return r.data;
}

/** GET /v1/payments/:id com a chave secreta (a confirmação autoritativa; o payload do webhook nunca é fonte de verdade). */
export async function obterPagamento(cfg: ConfigKursipay, id: string): Promise<PagamentoKursipay> {
  if (!/^pay_[A-Za-z0-9]{4,40}$/.test(id)) throw new KursipayErro("id_invalido", 0);
  const r = PagamentoSchema.safeParse(await pedir(cfg, "GET", `/payments/${id}`)); if (!r.success) throw new KursipayErro("resposta_invalida", 0);
  return r.data;
}

/** URL absoluto do checkout: domínio fixo + caminho validado. */
export function urlCheckout(caminho: string | undefined, id: string): string | null {
  if (typeof caminho !== "string" || !/^\/checkout\/pay_[A-Za-z0-9]{4,40}$/.test(caminho) || !caminho.endsWith(id)) return null;
  return `${CHECKOUT_BASE}${caminho}`;
}

export interface ErroUtilizador { http: number; mensagem: string; codigo: string; retryAfterS?: number }
/** Erros da kursiPay → mensagens claras em português, sem detalhes técnicos. */
export function mensagemDeErro(e: unknown): ErroUtilizador {
  const k = e instanceof KursipayErro ? e : new KursipayErro("desconhecido", 0);
  switch (k.codigo) {
    case "limit_exceeded": return { http: 422, codigo: "limite_excedido", mensagem: "Este valor excede o limite permitido para o pagamento online. Escolhe um valor mais baixo ou usa a transferência bancária." };
    case "production_disabled": return { http: 503, codigo: "pagamento_online_indisponivel", mensagem: "O pagamento online ainda não está disponível. Usa a transferência bancária." };
    case "rate_limited": return { http: 429, codigo: "muitos_pedidos", retryAfterS: k.retryAfterS, mensagem: `Há muitos pedidos ao serviço de pagamento neste momento. Tenta novamente${k.retryAfterS ? ` dentro de ${k.retryAfterS} segundos` : " dentro de instantes"}.` };
    case "validation_error": return { http: 422, codigo: "dados_invalidos", mensagem: "Não foi possível criar o pagamento com estes dados. Tenta outro valor ou usa a transferência bancária." };
    default: return { http: 502, codigo: "servico_indisponivel", mensagem: "O serviço de pagamento online não respondeu. Tenta mais tarde ou usa a transferência bancária." };
  }
}
