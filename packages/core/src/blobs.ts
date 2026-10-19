import { AwsClient } from 'aws4fetch';

/**
 * Where uploaded files (receipts, inbox papers) are kept. By default they sit in the database. When S3-compatible storage is
 * configured (BLOB_S3_ENDPOINT, BLOB_S3_BUCKET, BLOB_S3_ACCESS_KEY_ID, BLOB_S3_SECRET_ACCESS_KEY, optionally BLOB_S3_REGION), new files
 * go there and the database keeps only the object key. Keys always start with the business id, so one business's files can be found,
 * exported or erased on their own. Reads fall back to whichever the row holds, so turning storage on needs no data move.
 */
export interface BlobStore {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export interface S3Config { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region?: string; fetch?: typeof fetch }

export function createS3Store(cfg: S3Config): BlobStore {
  const client = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: cfg.region ?? 'auto', service: 's3' });
  const f = cfg.fetch ?? fetch;
  const base = cfg.endpoint.replace(/\/+$/, '');
  // Path-style addressing (endpoint/bucket/key) works with R2, B2, MinIO and AWS alike.
  const url = (key: string) => `${base}/${encodeURIComponent(cfg.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const send = async (key: string, init: RequestInit) => {
    const signed = await client.sign(url(key), init);
    return f(signed, { signal: AbortSignal.timeout(20_000) });
  };
  return {
    async put(key, data, contentType) {
      const r = await send(key, { method: 'PUT', body: new Uint8Array(data), headers: { 'content-type': contentType } });
      if (!r.ok) throw new Error(`Object storage refused the upload (${r.status}).`);
    },
    async get(key) {
      const r = await send(key, { method: 'GET' });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Object storage could not be read (${r.status}).`);
      return Buffer.from(await r.arrayBuffer());
    },
    async delete(key) {
      const r = await send(key, { method: 'DELETE' });
      if (!r.ok && r.status !== 404) throw new Error(`Object storage could not delete (${r.status}).`);
    },
  };
}

export function blobStoreFromEnv(env: Record<string, string | undefined> = process.env): BlobStore | null {
  const { BLOB_S3_ENDPOINT: endpoint, BLOB_S3_BUCKET: bucket, BLOB_S3_ACCESS_KEY_ID: accessKeyId, BLOB_S3_SECRET_ACCESS_KEY: secretAccessKey } = env;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return createS3Store({ endpoint, bucket, accessKeyId, secretAccessKey, region: env.BLOB_S3_REGION });
}

// One store per process, chosen from the environment the first time it is needed.
let current: BlobStore | null | undefined;
export const getBlobStore = (): BlobStore | null => (current === undefined ? (current = blobStoreFromEnv()) : current);
/** For tests and for hosts that build the store themselves. */
export const setBlobStore = (s: BlobStore | null) => { current = s; };

/** An in-memory store for tests. */
export function memoryBlobStore(): BlobStore & { objects: Map<string, { data: Buffer; contentType: string }> } {
  const objects = new Map<string, { data: Buffer; contentType: string }>();
  return {
    objects,
    async put(key, data, contentType) { objects.set(key, { data, contentType }); },
    async get(key) { return objects.get(key)?.data ?? null; },
    async delete(key) { objects.delete(key); },
  };
}
