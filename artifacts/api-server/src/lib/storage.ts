import crypto from "node:crypto";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const REQUIRED_STORAGE_ENV = [
  "B2_KEY_ID",
  "B2_APPLICATION_KEY",
  "B2_BUCKET_NAME",
  "B2_ENDPOINT",
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
    bucket: process.env.B2_BUCKET_NAME as string,
    endpoint: process.env.B2_ENDPOINT as string,
    cdnHostname: process.env.BUNNY_CDN_HOSTNAME as string,
  };
}

let client: S3Client | undefined;

function getClient(): S3Client {
  if (client) return client;

  const { endpoint } = getStorageConfig();
  const endpointHost = new URL(endpoint).hostname;
  const region = endpointHost.match(/^s3[.-]([^.]+)\./)?.[1] ?? "us-east-1";

  client = new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.B2_KEY_ID as string,
      secretAccessKey: process.env.B2_APPLICATION_KEY as string,
    },
  });
  return client;
}

function publicKeyPath(key: string): string {
  return key
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

/**
 * Uploads an object to the private Backblaze B2 bucket.
 * lib-storage uses multipart uploads automatically for large files.
 */
export async function uploadFile(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<void> {
  const { bucket } = getStorageConfig();
  const upload = new Upload({
    client: getClient(),
    params: {
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    },
    partSize: 10 * 1024 * 1024,
    queueSize: 2,
  });

  await upload.done();
}

export async function deleteFile(key: string): Promise<void> {
  const { bucket } = getStorageConfig();
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * Returns the Bunny Pull Zone URL, never the private B2 origin URL.
 */
export function getPublicUrl(key: string): string {
  const { cdnHostname } = getStorageConfig();
  const hostname = cdnHostname.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${hostname}/${publicKeyPath(key)}`;
}

export function createStorageKey(prefix: string, extension = "bin"): string {
  const safeExtension = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${prefix}/${crypto.randomUUID()}.${safeExtension}`;
}
