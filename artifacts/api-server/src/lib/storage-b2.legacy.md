# Legacy Backblaze B2 storage adapter

This is the previous S3-compatible B2 implementation, preserved for a future
switch back when B2 billing is available. To reactivate it, restore the
`@aws-sdk/client-s3` and `@aws-sdk/lib-storage` imports and the implementation
from the last version of `storage.ts`.

```ts
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const REQUIRED_B2_ENV = [
  "B2_KEY_ID",
  "B2_APPLICATION_KEY",
  "B2_BUCKET_NAME",
  "B2_ENDPOINT",
] as const;

function getB2Config() {
  const missing = REQUIRED_B2_ENV.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Backblaze B2 is not configured. Missing: ${missing.join(", ")}`);
  }

  return {
    bucket: process.env.B2_BUCKET_NAME as string,
    endpoint: process.env.B2_ENDPOINT as string,
  };
}

let client: S3Client | undefined;

function getB2Client(): S3Client {
  if (client) return client;

  const { endpoint } = getB2Config();
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

export async function uploadFileB2(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<void> {
  const { bucket } = getB2Config();
  const upload = new Upload({
    client: getB2Client(),
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

export async function deleteFileB2(key: string): Promise<void> {
  const { bucket } = getB2Config();
  await getB2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
```