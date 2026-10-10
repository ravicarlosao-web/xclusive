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
  if (!isPaidKey(stored)) return stored;
  if (!isPrivateStorageConfigured()) return "";
  return getPrivateSignedUrl(stored, PAID_MEDIA_TTL_SECONDS).url;
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
