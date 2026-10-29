import crypto from "node:crypto";
import { Readable } from "node:stream";

const REQUIRED_STORAGE_ENV = [
  "BUNNY_STORAGE_ZONE",
  "BUNNY_STORAGE_PASSWORD",
  "BUNNY_CDN_HOSTNAME",
] as const;

function missingStorageEnv(): string[] {
  return REQUIRED_STORAGE_ENV.filter((name) => !process.env[name]);
}

export function isStorageConfigured(): boolean {
  return missingStorageEnv().length === 0;
}

function getStorageConfig() {
  const missing = missingStorageEnv();
  if (missing.length > 0) {
    throw new Error(`Object storage is not configured. Missing: ${missing.join(", ")}`);
  }

  return {
    storageZone: process.env.BUNNY_STORAGE_ZONE as string,
    storagePassword: process.env.BUNNY_STORAGE_PASSWORD as string,
    cdnHostname: process.env.BUNNY_CDN_HOSTNAME as string,
  };
}

function storageUrl(key: string): string {
  const { storageZone } = getStorageConfig();
  const safeKey = key
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");

  return `https://storage.bunnycdn.com/${encodeURIComponent(storageZone)}/${safeKey}`;
}

async function assertSuccessfulResponse(response: Response, operation: string): Promise<void> {
  if (response.ok) return;

  const responseText = await response.text().catch(() => "");
  const details = responseText.trim() ? `: ${responseText.trim().slice(0, 300)}` : "";
  throw new Error(
    `Bunny Storage ${operation} failed with ${response.status} ${response.statusText}${details}`,
  );
}

function publicKeyPath(key: string): string {
  return key
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

const DEFAULT_TIMEOUT_MS = 60 * 1000; // 1 minute for small operations
const STREAM_UPLOAD_TIMEOUT_MS = 40 * 60 * 1000; // 40 minutes for large video streaming

/**
 * Uploads an object directly to a Bunny Storage Zone.
 * Bunny Storage authenticates with the zone password in the AccessKey header.
 */
export async function uploadFile(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<void> {
  const { storagePassword } = getStorageConfig();
  const response = await fetch(storageUrl(key), {
    method: "PUT",
    headers: {
      AccessKey: storagePassword,
      "Content-Type": contentType || "application/octet-stream",
      "Content-Length": String(buffer.byteLength),
    },
    body: buffer,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  await assertSuccessfulResponse(response, "upload");
}

/**
 * Uploads a stream directly to Bunny Storage with a 40-minute AbortSignal timeout.
 *
 * This is intentionally separate from uploadFile(): small images can keep
 * using the existing Buffer-based path, while large videos are forwarded
 * without first being materialised in the Node.js heap.
 */
export async function uploadFileStream(
  stream: Readable,
  key: string,
  contentType: string,
  timeoutMs: number = STREAM_UPLOAD_TIMEOUT_MS,
): Promise<void> {
  const { storagePassword } = getStorageConfig();
  const response = await fetch(storageUrl(key), {
    method: "PUT",
    headers: {
      AccessKey: storagePassword,
      "Content-Type": contentType || "application/octet-stream",
    },
    // Node's fetch requires duplex for a request body whose size is not
    // known up front. Bunny accepts the resulting chunked PUT request.
    body: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
    duplex: "half",
    signal: AbortSignal.timeout(timeoutMs),
  });

  await assertSuccessfulResponse(response, "stream upload");
}

export async function deleteFile(key: string): Promise<void> {
  const { storagePassword } = getStorageConfig();
  const response = await fetch(storageUrl(key), {
    method: "DELETE",
    headers: {
      AccessKey: storagePassword,
    },
    signal: AbortSignal.timeout(30 * 1000),
  });

  await assertSuccessfulResponse(response, "delete");
}

/**
 * Returns the Bunny CDN URL, never the private Storage Zone origin URL.
 */
export function getPublicUrl(key: string): string {
  const { cdnHostname } = getStorageConfig();
  const hostname = cdnHostname.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${hostname}/${publicKeyPath(key)}`;
}

/**
 * Converts a public Bunny CDN URL back to its storage key.
 * Returns null for URLs that do not belong to the configured CDN.
 */
export function getStorageKeyFromPublicUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const configuredHostname = (process.env.BUNNY_CDN_HOSTNAME ?? "")
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "")
      .split("/")[0]
      ?.toLowerCase();

    if (!configuredHostname || parsed.hostname.toLowerCase() !== configuredHostname) {
      return null;
    }

    const key = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    return key || null;
  } catch {
    return null;
  }
}

export function createStorageKey(prefix: string, extension = "bin"): string {
  const safeExtension = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${prefix}/${crypto.randomUUID()}.${safeExtension}`;
}

// ─── Zona PRIVADA (documentos KYC) ────────────────────────────────────────────
// Storage Zone separada, com Pull Zone própria e Token Authentication. Lida a cada uso
// (o .env pode ser carregado depois dos imports). Nunca há recurso à zona pública.

const REQUIRED_PRIVATE_ENV = [
  "BUNNY_PRIVATE_STORAGE_ZONE",
  "BUNNY_PRIVATE_STORAGE_KEY",
  "BUNNY_PRIVATE_CDN_URL",
  "BUNNY_PRIVATE_TOKEN_KEY",
] as const;

/** Nomes (nunca valores) das variáveis da zona privada que faltam. */
export function getMissingPrivateStorageEnv(): string[] {
  return REQUIRED_PRIVATE_ENV.filter((name) => !process.env[name]);
}

export function isPrivateStorageConfigured(): boolean {
  return getMissingPrivateStorageEnv().length === 0;
}

function getPrivateConfig() {
  const missing = getMissingPrivateStorageEnv();
  if (missing.length > 0) {
    throw new Error(`Private object storage is not configured. Missing: ${missing.join(", ")}`);
  }
  const strip = (v: string) => v.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return {
    zone: process.env.BUNNY_PRIVATE_STORAGE_ZONE as string,
    accessKey: process.env.BUNNY_PRIVATE_STORAGE_KEY as string,
    host: strip(process.env.BUNNY_PRIVATE_STORAGE_HOST || "storage.bunnycdn.com"),
    cdnHost: strip(process.env.BUNNY_PRIVATE_CDN_URL as string),
    tokenKey: process.env.BUNNY_PRIVATE_TOKEN_KEY as string,
  };
}

/** Chaves da zona privada começam por "kyc/"; as antigas (zona pública) por "users/". */
export function isPrivateStorageKey(key: string): boolean {
  return key.startsWith("kyc/");
}

function privateStorageUrl(key: string): string {
  const { host, zone } = getPrivateConfig();
  return `https://${host}/${encodeURIComponent(zone)}/${publicKeyPath(key)}`;
}

export async function uploadPrivate(buffer: Buffer, key: string, contentType: string): Promise<void> {
  const { accessKey } = getPrivateConfig();
  const response = await fetch(privateStorageUrl(key), {
    method: "PUT",
    headers: {
      AccessKey: accessKey,
      "Content-Type": contentType || "application/octet-stream",
      "Content-Length": String(buffer.byteLength),
    },
    body: buffer,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  await assertSuccessfulResponse(response, "private upload");
}

export async function deletePrivate(key: string): Promise<void> {
  const { accessKey } = getPrivateConfig();
  const response = await fetch(privateStorageUrl(key), {
    method: "DELETE",
    headers: { AccessKey: accessKey },
    signal: AbortSignal.timeout(30 * 1000),
  });
  await assertSuccessfulResponse(response, "private delete");
}

/**
 * URL de curta duração para um ficheiro da zona privada (Bunny Token Authentication, modo Basic):
 *   token = base64url( SHA256( chave_de_segurança + caminho + expiração ) )   (sem IP, sem "="),
 *   URL   = https://<pull zone><caminho>?token=<token>&expires=<expiração unix>
 * O caminho é o do pedido (começa por "/"). Cada chamada gera um URL novo.
 */
export function getPrivateSignedUrl(
  key: string,
  ttlSeconds = 60,
  nowMs: number = Date.now(),
): { url: string; expiresAt: Date } {
  const { cdnHost, tokenKey } = getPrivateConfig();
  const path = `/${publicKeyPath(key)}`;
  const expires = Math.floor(nowMs / 1000) + ttlSeconds;
  const token = crypto
    .createHash("sha256")
    .update(tokenKey + path + expires)
    .digest("base64")
    .replace(/\n/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return { url: `https://${cdnHost}${path}?token=${token}&expires=${expires}`, expiresAt: new Date(expires * 1000) };
}

// ─── Conteúdo pago (posts exclusivos) na zona privada ────────────────────────
// Ficheiros novos ficam em "paid/<autorId>/<uuid>.<ext>". A BD guarda só a chave;
// os URLs assinados são gerados a cada resposta, apenas para quem tem acesso.

/** Validade dos URLs assinados de média paga (o <video> faz vários pedidos Range). */
export const PAID_MEDIA_TTL_SECONDS = 60 * 60;

export function isPaidKey(value: string): boolean {
  return value.startsWith("paid/");
}

/**
 * Devolve o URL a servir para um valor guardado em post_media.url:
 *  - "paid/..."  → URL assinado da zona privada ("" se a zona não estiver configurada);
 *  - outro valor → formato antigo (URL público), devolvido tal e qual.
 * Nunca recorre à zona pública para chaves "paid/".
 */
export function resolveMediaUrl(stored: string): string {
  if (!isPaidKey(stored)) return assinarPublico(stored);
  if (!isPrivateStorageConfigured()) return "";
  return getPrivateSignedUrl(stored, PAID_MEDIA_TTL_SECONDS).url;
}

// ─── Zona PÚBLICA com Token Authentication (URLs de visualização) ────────────
// A BD continua a guardar o URL canónico do CDN (sem token). Cada resposta da API devolve, para
// qualquer ficheiro nosso, um URL assinado de curta duração (mesmo esquema da zona privada).
// Sem BUNNY_CDN_TOKEN_KEY nada é assinado e os URLs saem como sempre (comportamento anterior).
// A chave e os tokens nunca vão para logs.

/** Validade mínima de um URL assinado de imagem; a expiração é quantizada (ver getPublicSignedUrl). */
export const PUBLIC_MEDIA_TTL_SECONDS = 60 * 60;
/** Vídeos (o <video> faz vários pedidos Range): 2 h. */
export const PUBLIC_VIDEO_TTL_SECONDS = 2 * 60 * 60;

export function isPublicSigningEnabled(): boolean {
  return Boolean(process.env.BUNNY_CDN_TOKEN_KEY && process.env.BUNNY_CDN_HOSTNAME);
}

function publicHost(): string {
  return (process.env.BUNNY_CDN_HOSTNAME ?? "").replace(/^https?:\/\//, "").replace(/\/+$/, "").split("/")[0] ?? "";
}

function ehVideoKey(key: string): boolean {
  return /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(key);
}

/**
 * URL assinado de um ficheiro da zona pública (Bunny Token Authentication, modo Basic):
 *   token = base64url( SHA256( chave + caminho + expiração ) ), URL = https://<host><caminho>?token=&expires=
 * A expiração é QUANTIZADA em janelas fixas de `ttlSeconds`: expira no fim da janela seguinte, logo o URL
 * vale entre `ttl` e `2*ttl` e é IDÊNTICO para o mesmo ficheiro durante a janela (a cache do browser e do
 * edge continua a funcionar).
 */
export function getPublicSignedUrl(
  key: string,
  ttlSeconds: number = PUBLIC_MEDIA_TTL_SECONDS,
  nowMs: number = Date.now(),
): { url: string; expiresAt: Date } {
  const tokenKey = process.env.BUNNY_CDN_TOKEN_KEY;
  const host = publicHost();
  if (!tokenKey || !host) throw new Error("Public CDN token authentication is not configured.");
  const path = `/${publicKeyPath(key)}`;
  const expires = (Math.floor(nowMs / 1000 / ttlSeconds) + 2) * ttlSeconds;
  const token = crypto
    .createHash("sha256")
    .update(tokenKey + path + expires)
    .digest("base64")
    .replace(/\n/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return { url: `https://${host}${path}?token=${token}&expires=${expires}`, expiresAt: new Date(expires * 1000) };
}

/** Chave de um valor guardado que seja nosso (URL do CDN público ou chave "users/…"); null se não for. */
function chavePublica(stored: string): string | null {
  if (/^https?:\/\//i.test(stored)) return getStorageKeyFromPublicUrl(stored);
  return stored.startsWith("users/") ? stored : null;
}

/**
 * Assina o que é nosso; URLs externos, relativos ou antigos passam intactos. Só se assina a pasta "users/"
 * (onde vivem os uploads públicos): um valor guardado a apontar para outra pasta (ex.: documentos KYC
 * legados) nunca é assinado para o cliente.
 */
function assinarPublico(stored: string): string {
  if (!isPublicSigningEnabled()) return stored;
  const key = chavePublica(stored);
  if (!key || key.includes("..") || !key.startsWith("users/")) return stored;
  return getPublicSignedUrl(key, ehVideoKey(key) ? PUBLIC_VIDEO_TTL_SECONDS : PUBLIC_MEDIA_TTL_SECONDS).url;
}

/**
 * Para pedidos feitos PELO SERVIDOR ao CDN público (proxy de media do admin): assina qualquer ficheiro do
 * nosso CDN, incluindo pastas legadas (ex.: kyc/). Nunca é devolvido ao cliente tal e qual.
 */
export function urlParaServidor(rawUrl: string): string {
  if (!isPublicSigningEnabled()) return rawUrl;
  const key = /^https?:\/\//i.test(rawUrl) ? getStorageKeyFromPublicUrl(rawUrl) : null;
  if (!key || key.includes("..")) return rawUrl;
  return getPublicSignedUrl(key, PUBLIC_MEDIA_TTL_SECONDS).url;
}

/**
 * Serializador de saída: URL a devolver ao cliente para um valor guardado (avatar, capa, media, vídeo…).
 * null/undefined/"" passam como estão. "paid/…" → URL assinado da zona privada; nosso → URL assinado.
 */
export function urlMedia(stored: string): string;
export function urlMedia(stored: string | null): string | null;
export function urlMedia(stored: string | null | undefined): string | null | undefined;
export function urlMedia(stored: string | null | undefined): string | null | undefined {
  if (!stored) return stored;
  return resolveMediaUrl(stored);
}

/**
 * Normalização na ESCRITA: um URL do nosso CDN (possivelmente assinado, com ?token=&expires=) é guardado
 * sempre na forma canónica https://<host>/<chave>, sem query nem fragmento. Outros valores ficam como estão.
 */
export function urlCanonico(url: string): string {
  const key = /^https?:\/\//i.test(url) ? getStorageKeyFromPublicUrl(url) : null;
  if (!key || key.includes("..")) return url;
  return `https://${publicHost()}/${publicKeyPath(key)}`;
}

const EXT_IMAGEM = ["jpg", "jpeg", "png", "webp"];

/**
 * Avatar/capa: só imagens do nosso CDN e DO PRÓPRIO utilizador ("users/<id>/…"), ou vazio (remove). Devolve o URL canónico, ou
 * null se o valor for recusado. Valida a chave (não o ficheiro no CDN): do próprio utilizador, sem segmentos perigosos
 * (.., //, barras invertidas, "%" depois de decodificar, caracteres de controlo), com extensão de imagem (jpg, jpeg, png, webp;
 * gif só se `gif`), e nunca vídeo. Sem BUNNY_CDN_HOSTNAME configurado não há como distinguir, e aceita-se como antes.
 */
export function urlAvatarOuCapa(url: string, userId: number, opcoes: { gif?: boolean } = {}): string | null {
  if (url === "") return "";
  if (!publicHost()) return url;
  if (/[\\\u0000-\u001f]/.test(url)) return null;
  const key = /^https?:\/\//i.test(url) ? getStorageKeyFromPublicUrl(url) : null;
  if (!key) return null;
  if (/[\\%\u0000-\u001f]/.test(key) || key.includes("..") || key.includes("//")) return null;
  const partes = key.split("/");
  if (partes.some((p) => p === "" || p === "." || p === "..")) return null;
  if (partes[0] !== "users" || partes[1] !== String(userId) || partes.length < 3) return null;
  const ext = /\.([a-z0-9]+)$/i.exec(key)?.[1]?.toLowerCase();
  if (!ext || ehVideoKey(key) || ![...EXT_IMAGEM, ...(opcoes.gif ? ["gif"] : [])].includes(ext)) return null;
  return urlCanonico(url);
}

export async function uploadPrivateStream(
  stream: Readable,
  key: string,
  contentType: string,
  timeoutMs: number = STREAM_UPLOAD_TIMEOUT_MS,
): Promise<void> {
  const { accessKey } = getPrivateConfig();
  const response = await fetch(privateStorageUrl(key), {
    method: "PUT",
    headers: {
      AccessKey: accessKey,
      "Content-Type": contentType || "application/octet-stream",
    },
    body: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
    duplex: "half",
    signal: AbortSignal.timeout(timeoutMs),
  });
  await assertSuccessfulResponse(response, "private stream upload");
}
