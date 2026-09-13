import "server-only";
import { Client as MinioClient } from "minio";

/**
 * MinIO storage — S3-compatible object storage running inside the Docker
 * stack, so uploaded files never leave the customer's infrastructure
 * (blueprint §9.2, the data-sovereignty pitch). The S3 API keeps the code
 * portable to AWS S3 / Cloudflare R2 later without rewrites.
 */

const BUCKET = process.env.MINIO_BUCKET || "cobrain-uploads";

let clientSingleton: MinioClient | null = null;
let bucketReady: Promise<void> | null = null;

function getClient(): MinioClient {
  if (!clientSingleton) {
    clientSingleton = new MinioClient({
      endPoint: process.env.MINIO_ENDPOINT || "localhost",
      port: Number(process.env.MINIO_PORT || 9000),
      useSSL: (process.env.MINIO_USE_SSL || "false") === "true",
      accessKey: process.env.MINIO_ACCESS_KEY || "cobrain",
      secretKey: process.env.MINIO_SECRET_KEY || "cobrain-dev-secret",
    });
  }
  return clientSingleton;
}

/** Create the bucket on first use — cached so it only runs once per process. */
async function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const client = getClient();
      const exists = await client.bucketExists(BUCKET).catch(() => false);
      if (!exists) await client.makeBucket(BUCKET);
    })().catch((err) => {
      bucketReady = null; // allow a retry on the next call
      throw err;
    });
  }
  return bucketReady;
}

/** Deterministic, collision-free object key scoped to the owning user. */
export function buildStorageKey(userId: string, fileName: string): string {
  const safe = fileName.replace(/[^\w.\-]+/g, "_").slice(-80);
  return `${userId}/${crypto.randomUUID()}-${safe}`;
}

export async function putObject(
  key: string,
  body: Buffer,
  mimeType: string
): Promise<void> {
  await ensureBucket();
  await getClient().putObject(BUCKET, key, body, body.length, {
    "Content-Type": mimeType,
  });
}

export async function getObject(key: string): Promise<Buffer> {
  await ensureBucket();
  const stream = await getClient().getObject(BUCKET, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export async function removeObject(key: string): Promise<void> {
  await ensureBucket();
  await getClient().removeObject(BUCKET, key).catch(() => {
    /* already gone — deleting the DB row is what matters */
  });
}

/** Cheap health probe used by the Sources page to show storage status. */
export async function storageReachable(): Promise<boolean> {
  try {
    await getClient().bucketExists(BUCKET);
    return true;
  } catch {
    return false;
  }
}
