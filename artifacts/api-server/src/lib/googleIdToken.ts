/**
 * Login com o Google: verificação do ID token no servidor (sem dependências novas: jsonwebtoken + node:crypto).
 *
 * O que se valida (tudo o que falhar = token recusado):
 *  - assinatura RS256 com a chave pública da Google escolhida pelo `kid` (algoritmo FIXADO: `none` e `HS*` nunca são aceites);
 *  - `iss` = https://accounts.google.com | accounts.google.com; `aud` = o nosso GOOGLE_CLIENT_ID; `exp` no futuro; `iat` com no máximo 10 minutos;
 *  - `sub` (texto não vazio, até 255) e `email` presentes e `email_verified === true` (booleano estrito);
 *  - o `nonce` é validado por quem chama (ligado ao cookie do browser, ver routes/authGoogle.ts).
 * A identidade de uma pessoa é SEMPRE o `sub`; o email nunca identifica ninguém.
 *
 * Chaves: JWKS da Google, em cache pelo Cache-Control (1 h por omissão, 60 s a 24 h), com NO MÁXIMO um refetch por minuto quando aparece um `kid`
 * desconhecido (um token forjado não consegue obrigar-nos a ir à Google mais vezes), timeout de 3 s. Falha a obter as chaves = indisponível (nunca aceita).
 *
 * GOOGLE_JWKS_URL (só para testes locais): aceite APENAS fora de produção e APENAS em loopback; em produção a API recusa arrancar se estiver definido
 * (ver lib/ambienteArranque.ts). Aqui, por defesa em profundidade, em produção é ignorado.
 */
import { createPublicKey, type KeyObject } from "node:crypto";
import jwt from "jsonwebtoken";

export const GOOGLE_ISSUERS: [string, ...string[]] = ["https://accounts.google.com", "accounts.google.com"];
export const GOOGLE_JWKS_URL_PADRAO = "https://www.googleapis.com/oauth2/v3/certs";
const IAT_MAX_IDADE_S = 10 * 60;
const REFETCH_MIN_MS = 60_000;
const CACHE_MIN_MS = 60_000, CACHE_MAX_MS = 24 * 60 * 60_000, CACHE_PADRAO_MS = 60 * 60_000;
const TIMEOUT_MS = 3_000;
/** `<número>-<texto>.apps.googleusercontent.com` */
export const CLIENT_ID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

/** O ID token é inválido (assinatura, claims, formato…). Nunca leva o token na mensagem. */
export class GoogleTokenInvalido extends Error {
  constructor(public readonly motivo: string, public readonly emailNaoVerificado = false) { super(motivo); this.name = "GoogleTokenInvalido"; }
}
/** Não foi possível obter as chaves da Google (rede, resposta inválida): o login fica indisponível (fail-closed). */
export class GoogleIndisponivel extends Error {
  constructor(motivo: string) { super(motivo); this.name = "GoogleIndisponivel"; }
}

/** GOOGLE_CLIENT_ID configurado (texto sem espaços) ou null. Sem ele, todo o login com o Google está desligado. */
export function googleClientId(env: Record<string, string | undefined> = process.env): string | null {
  const v = env.GOOGLE_CLIENT_ID?.trim();
  return v ? v : null;
}

/** URL das chaves: o padrão da Google; GOOGLE_JWKS_URL só fora de produção e só em loopback (senão, o padrão). */
export function jwksUrl(env: Record<string, string | undefined> = process.env): string {
  const u = env.GOOGLE_JWKS_URL?.trim();
  if (!u || env.NODE_ENV === "production" || !urlLoopback(u)) return GOOGLE_JWKS_URL_PADRAO;
  return u;
}

/** http(s) para localhost, 127.0.0.1 ou [::1]. */
export function urlLoopback(u: string): boolean {
  try {
    const x = new URL(u);
    return (x.protocol === "http:" || x.protocol === "https:") && ["localhost", "127.0.0.1", "[::1]"].includes(x.hostname);
  } catch { return false; }
}

interface Cache { chaves: Map<string, KeyObject>; expiraEm: number }
let cache: Cache | null = null;
let ultimoFetch = 0;
let emVoo: Promise<void> | null = null;

function maxAge(cc: string | null): number {
  const m = /max-age=(\d+)/i.exec(cc ?? "");
  const ms = m ? Number(m[1]) * 1000 : CACHE_PADRAO_MS;
  return Math.min(CACHE_MAX_MS, Math.max(CACHE_MIN_MS, ms));
}

async function carregarChaves(): Promise<void> {
  ultimoFetch = Date.now();
  let res: Response;
  try {
    res = await fetch(jwksUrl(), { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
  } catch { throw new GoogleIndisponivel("falha de rede ao obter as chaves"); }
  if (!res.ok) throw new GoogleIndisponivel(`resposta ${res.status} ao obter as chaves`);
  let corpo: { keys?: unknown };
  try { corpo = (await res.json()) as { keys?: unknown }; } catch { throw new GoogleIndisponivel("chaves ilegíveis"); }
  if (!Array.isArray(corpo.keys)) throw new GoogleIndisponivel("chaves em falta");
  const chaves = new Map<string, KeyObject>();
  for (const k of corpo.keys as Array<Record<string, unknown>>) {
    if (k?.kty !== "RSA" || typeof k.kid !== "string" || (k.alg !== undefined && k.alg !== "RS256")) continue;
    try { chaves.set(k.kid, createPublicKey({ key: k as never, format: "jwk" })); } catch { /* chave inválida: ignora-se */ }
  }
  if (chaves.size === 0) throw new GoogleIndisponivel("nenhuma chave RSA válida");
  cache = { chaves, expiraEm: Date.now() + maxAge(res.headers.get("cache-control")) };
}

async function chavePara(kid: string): Promise<KeyObject | null> {
  const agora = Date.now();
  if (cache && cache.expiraEm > agora && cache.chaves.has(kid)) return cache.chaves.get(kid)!;
  // Cache vencida, vazia ou `kid` desconhecido: refetch, mas no máximo uma vez por minuto (um pedido em voo é partilhado).
  const podeIr = !cache || cache.expiraEm <= agora || agora - ultimoFetch >= REFETCH_MIN_MS;
  if (podeIr) {
    emVoo ??= carregarChaves().finally(() => { emVoo = null; });
    await emVoo;
  } else if (emVoo) {
    await emVoo;
  }
  return cache?.chaves.get(kid) ?? null;
}

export interface IdentidadeGoogle {
  /** Identificador estável da conta Google (a identidade). */
  sub: string;
  /** Email em minúsculas, já verificado pela Google. */
  email: string;
  /** Nome completo (pode faltar). */
  nome: string | null;
  nonce: string | null;
}

/** Valida um ID token. Lança GoogleTokenInvalido (token mau) ou GoogleIndisponivel (não deu para obter as chaves). */
export async function verificarIdToken(credential: unknown, clientId: string): Promise<IdentidadeGoogle> {
  if (typeof credential !== "string" || credential.length < 20 || credential.length > 4096 || credential.split(".").length !== 3) throw new GoogleTokenInvalido("formato");
  const dec = jwt.decode(credential, { complete: true });
  const h = dec && typeof dec === "object" ? dec.header : null;
  if (!h || h.alg !== "RS256" || typeof h.kid !== "string" || !h.kid || h.kid.length > 128) throw new GoogleTokenInvalido("cabeçalho");
  const chave = await chavePara(h.kid);
  if (!chave) throw new GoogleTokenInvalido("kid desconhecido");
  let p: jwt.JwtPayload;
  try {
    p = jwt.verify(credential, chave, { algorithms: ["RS256"], audience: clientId, issuer: GOOGLE_ISSUERS, clockTolerance: 30, maxAge: IAT_MAX_IDADE_S }) as jwt.JwtPayload;
  } catch (err) {
    throw new GoogleTokenInvalido(err instanceof Error ? err.name : "verificação");
  }
  if (typeof p.iat !== "number" || typeof p.exp !== "number") throw new GoogleTokenInvalido("iat/exp");
  const sub = p.sub;
  if (typeof sub !== "string" || !sub || sub.length > 255) throw new GoogleTokenInvalido("sub");
  const email = typeof p.email === "string" ? p.email.trim().toLowerCase() : "";
  if (!email || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new GoogleTokenInvalido("email");
  if (p.email_verified !== true) throw new GoogleTokenInvalido("email_verified", true);
  const nome = typeof p.name === "string" ? p.name : null;
  return { sub, email, nome, nonce: typeof p.nonce === "string" ? p.nonce : null };
}

/** Só para testes unitários: esquece as chaves e o instante do último fetch. */
export function reporCacheChaves(): void { cache = null; ultimoFetch = 0; emVoo = null; }
