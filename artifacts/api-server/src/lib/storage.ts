import crypto from "node:crypto";

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
  });

  await assertSuccessfulResponse(response, "upload");
}

export async function deleteFile(key: string): Promise<void> {
  const { storagePassword } = getStorageConfig();
  const response = await fetch(storageUrl(key), {
    method: "DELETE",
    headers: {
      AccessKey: storagePassword,
    },
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
