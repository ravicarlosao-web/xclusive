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
/** Id de pagamento (pay_…): letras, dígitos, «_» e «-», no máximo 40 caracteres no total (o tamanho da coluna). */
export const RE_ID_PAGAMENTO = /^pay_[A-Za-z0-9_-]{4,36}$/;
const Dinheiro = z.object({ amount: z.number().int().safe(), currency: z.string().min(3).max(3) });
export const PagamentoSchema = z.object({
  id: z.string().regex(RE_ID_PAGAMENTO),
  environment: z.enum(["sandbox", "production"]),
  status: z.string().min(1).max(30),
  amount: Dinheiro,
  externalReference: z.string().max(100).nullable().optional(),
  checkoutUrl: z.string().max(300).optional(),
  method: z.string().max(40).nullable().optional(),
  methodDetails: z.record(z.string(), z.unknown()).nullable().optional(),
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
  /** `http` = estado HTTP devolvido pela kursiPay (0 = sem resposta); `campos` = NOMES dos campos em falta ou inválidos (nunca valores). */
  constructor(public readonly codigo: string, public readonly http: number, public readonly retryAfterS?: number, public readonly campos?: string[]) { super(`kursiPay: ${codigo}`); this.name = "KursipayErro"; }
}

/** Nomes dos campos que o esquema recusou (ex.: «amount.currency»), sem valores. */
const camposInvalidos = (e: z.ZodError): string[] => [...new Set(e.issues.map((i) => i.path.join(".") || "(raiz)"))].slice(0, 10);

async function pedir(cfg: ConfigKursipay, metodo: "GET" | "POST", caminho: string, opc: { corpo?: unknown; idempotencyKey?: string } = {}): Promise<{ json: unknown; http: number }> {
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
      if (res.ok) { if (json === null) throw new KursipayErro("resposta_invalida", res.status, undefined, ["(corpo não é JSON)"]); return { json, http: res.status }; }
      const codigo = String(((json as { error?: { code?: unknown } } | null)?.error?.code) ?? `http_${res.status}`).slice(0, 40);
      const ra = Number(res.headers.get("retry-after")); const e = new KursipayErro(codigo, res.status, Number.isFinite(ra) && ra > 0 ? Math.ceil(ra) : undefined);
      if (res.status >= 500 && tentativa === 0) { ultimo = e; continue; }   // 5xx: uma repetição
      throw e;
    } catch (err) {
      if (err instanceof KursipayErro) throw err;
      ultimo = new KursipayErro("rede", 0, undefined, [err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError") ? "tempo_limite" : "falha_de_rede"]);   // sem detalhes (nunca o URL nem cabeçalhos)
      if (tentativa === 0) continue;
    }
  }
  throw ultimo instanceof KursipayErro ? ultimo : new KursipayErro("rede", 0);
}

/** Cobrança DIRETA (sem checkout): o utilizador nunca sai do nosso site. Só Multicaixa Express e Referência, em AOA. */
export type MetodoDireto = "multicaixa_express" | "reference";
export const METODOS_DIRETOS: readonly MetodoDireto[] = ["multicaixa_express", "reference"];

/** Telefone angolano → «+244 9XX XXX XXX» (9 dígitos a começar por 9; aceita espaços, «+244», «00244» e «244»). null = inválido. Nunca é registado nem guardado. */
export function normalizarTelefoneAO(bruto: unknown): string | null {
  if (typeof bruto !== "string" || bruto.length > 30) return null;
  let d = bruto.replace(/[\s().-]/g, "");
  if (d.startsWith("+244")) d = d.slice(4); else if (d.startsWith("00244")) d = d.slice(5); else if (d.startsWith("244") && d.length === 12) d = d.slice(3);
  if (!/^9\d{8}$/.test(d)) return null;
  return `+244 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}

export interface DetalhesReferencia { entity: string; reference: string; dueAt: string }
/** Entidade, referência (só dígitos) e prazo de uma cobrança direta por Referência; null se faltar ou vier inválido. */
export function detalhesReferencia(p: { methodDetails?: Record<string, unknown> | null }): DetalhesReferencia | null {
  const d = p.methodDetails; if (!d || typeof d !== "object") return null;
  const entity = typeof d.entity === "string" ? d.entity.trim() : "", ref = typeof d.reference === "string" ? d.reference.replace(/\s/g, "") : "";
  const due = typeof d.dueAt === "string" ? Date.parse(d.dueAt) : NaN;
  if (!/^\d{3,10}$/.test(entity) || !/^\d{6,20}$/.test(ref) || !Number.isFinite(due)) return null;
  return { entity, reference: ref, dueAt: new Date(due).toISOString() };
}

export interface PedidoCriarPagamento { valorCentimos: number; referencia: string; metodo?: MetodoDireto; telefone?: string }
/** POST /v1/payments: SÓ o que é preciso (valor em cêntimos inteiros, AOA, descrição neutra, métodos sem cartão nem Pix, sem nenhum dado pessoal). */
export async function criarPagamento(cfg: ConfigKursipay, p: PedidoCriarPagamento): Promise<PagamentoKursipay> {
  if (!Number.isSafeInteger(p.valorCentimos) || p.valorCentimos <= 0) throw new KursipayErro("valor_invalido", 0);
  if (p.metodo && (!METODOS_DIRETOS.includes(p.metodo) || (p.metodo === "multicaixa_express" && !p.telefone))) throw new KursipayErro("metodo_invalido", 0);
  const { json, http } = await pedir(cfg, "POST", "/payments", {
    idempotencyKey: `xclusive-${p.referencia}`,
    corpo: p.metodo ? {
      // Cobrança direta: sem allowedMethods (a documentação proíbe-os juntos). Express: SÓ o telefone do comprador (mascarado nas respostas) e `wait: false` (resposta imediata; o resultado vem pelo webhook).
      amount: { amount: p.valorCentimos, currency: "AOA" },
      description: "Carregamento de saldo",
      externalReference: p.referencia,
      method: p.metodo,
      ...(p.metodo === "multicaixa_express" ? { payer: { phone: p.telefone }, wait: false } : { expiresInMin: 1440 }),
    } : {
      amount: { amount: p.valorCentimos, currency: "AOA" },
      description: "Carregamento de saldo",
      allowedMethods: ["multicaixa_express", "reference", "paypay"],
      externalReference: p.referencia,
      expiresInMin: 1440,
    },
  });
  const r = PagamentoSchema.safeParse(json); if (!r.success) throw new KursipayErro("resposta_invalida", http, undefined, camposInvalidos(r.error));
  return r.data;
}

/** GET /v1/payments/:id com a chave secreta (a confirmação autoritativa; o payload do webhook nunca é fonte de verdade). */
export async function obterPagamento(cfg: ConfigKursipay, id: string): Promise<PagamentoKursipay> {
  if (!RE_ID_PAGAMENTO.test(id)) throw new KursipayErro("id_invalido", 0);
  const { json, http } = await pedir(cfg, "GET", `/payments/${id}`);
  const r = PagamentoSchema.safeParse(json); if (!r.success) throw new KursipayErro("resposta_invalida", http, undefined, camposInvalidos(r.error));
  return r.data;
}

/** A FORMA do checkoutUrl recebido (nunca o conteúdo), para os registos: ausente | vazio | relativo | relativo_com_query | absoluto | outro. */
export function formaCheckoutUrl(c: unknown): string {
  if (c === undefined || c === null) return "ausente";
  if (typeof c !== "string") return "tipo_invalido";
  if (c === "") return "vazio";
  if (c.startsWith("/")) return /[?#]/.test(c) ? "relativo_com_query" : "relativo";
  return /^https?:\/\//i.test(c) ? "absoluto" : "outro";
}

/**
 * URL absoluto do checkout. A documentação indica um caminho relativo («/checkout/pay_…», relativo a https://kursipay.com), e o SDK oficial resolve-o com `new URL(checkoutUrl, base)`,
 * o que também aceita um URL absoluto: fazemos o mesmo, mas SÓ devolvemos um URL no nosso domínio fixo (https://kursipay.com, ou o seu «www»), caminho /checkout/<id deste pagamento>,
 * sem credenciais nem porta; uma query só passa se for simples. Qualquer outra coisa → null (e o utilizador nunca é mandado para lá).
 */
export function urlCheckout(caminho: string | undefined, id: string): string | null {
  if (typeof caminho !== "string" || caminho.length === 0 || caminho.length > 300) return null;
  let u: URL;
  try { u = new URL(caminho, CHECKOUT_BASE); } catch { return null; }
  if (u.protocol !== "https:" || (u.origin !== CHECKOUT_BASE && u.origin !== "https://www.kursipay.com") || u.username || u.password) return null;
  const m = /^\/checkout\/(pay_[A-Za-z0-9_-]{4,36})\/?$/.exec(u.pathname);
  if (!m || m[1] !== id) return null;
  if (u.search && !/^\?[A-Za-z0-9_=&.%~+-]{1,200}$/.test(u.search)) return null;
  return `${CHECKOUT_BASE}/checkout/${id}${u.search}`;
}

export interface ErroUtilizador { http: number; mensagem: string; codigo: string; retryAfterS?: number }
/** Erros da kursiPay → mensagens claras em português, sem detalhes técnicos. */
export function mensagemDeErro(e: unknown): ErroUtilizador {
  const k = e instanceof KursipayErro ? e : new KursipayErro("desconhecido", 0);
  switch (k.codigo) {
    case "limit_exceeded": return { http: 422, codigo: "limite_excedido", mensagem: "Este valor excede o limite permitido para o pagamento online. Escolhe um valor mais baixo ou usa a transferência bancária." };
    case "production_disabled": return { http: 503, codigo: "pagamento_online_indisponivel", mensagem: "O pagamento online ainda não está disponível. Usa a transferência bancária." };
    case "rate_limited": return { http: 429, codigo: "muitos_pedidos", retryAfterS: k.retryAfterS, mensagem: `Há muitos pedidos ao serviço de pagamento neste momento. Tenta novamente${k.retryAfterS ? ` dentro de ${k.retryAfterS} segundos` : " dentro de instantes"}.` };
    case "conflict": return { http: 409, codigo: "pedido_em_curso", mensagem: "Já existe um pedido de pagamento à espera de aprovação neste telemóvel. Aprova-o na app Multicaixa Express ou aguarda um minuto e tenta de novo." };
    case "forbidden": return { http: 503, codigo: "pagamento_online_indisponivel", mensagem: "Este método de pagamento ainda não está disponível. Usa a transferência bancária." };
    case "validation_error": return { http: 422, codigo: "dados_invalidos", mensagem: "Não foi possível criar o pagamento com estes dados. Tenta outro valor ou usa a transferência bancária." };
    default: return { http: 502, codigo: "servico_indisponivel", mensagem: "O serviço de pagamento online não respondeu. Tenta mais tarde ou usa a transferência bancária." };
  }
}
