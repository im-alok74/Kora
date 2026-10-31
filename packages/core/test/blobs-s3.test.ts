import { describe, expect, it } from 'vitest';
import { createS3Store } from '../src/index.js';

// Against a real S3-compatible server (docker-compose --profile s3, which checks signatures). Skipped unless S3_TEST_ENDPOINT is set, so `pnpm test` needs nothing extra.
const endpoint = process.env.S3_TEST_ENDPOINT;
describe.skipIf(!endpoint)('object storage against a real S3 server', () => {
  const cfg = { endpoint: endpoint!, bucket: 'kora-test', accessKeyId: process.env.S3_TEST_KEY ?? 'kora_s3', secretAccessKey: process.env.S3_TEST_SECRET ?? 'kora_s3_dev_secret', region: 'us-east-1' };
  const store = () => createS3Store(cfg);
  it('creates the bucket, stores, reads back byte for byte, and deletes', async () => {
    // The bucket is made with a signed PUT, as an operator would.
    const { AwsClient } = await import('aws4fetch');
    const c = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: cfg.region, service: 's3' });
    const made = await fetch(await c.sign(`${cfg.endpoint}/${cfg.bucket}`, { method: 'PUT' }));
    expect([200, 409]).toContain(made.status);
    const s = store();
    const bytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7) % 256));
    await s.put('biz-1/inbox/a b+c.pdf', bytes, 'application/pdf');   // a key with a space and a plus sign
    expect((await s.get('biz-1/inbox/a b+c.pdf'))!.equals(bytes)).toBe(true);
    expect(await s.get('biz-1/inbox/missing')).toBeNull();
    await s.delete('biz-1/inbox/a b+c.pdf');
    expect(await s.get('biz-1/inbox/a b+c.pdf')).toBeNull();
    await s.delete('biz-1/inbox/a b+c.pdf');   // deleting twice is fine
  });
  it('refuses wrong credentials with a clear error', async () => {
    const bad = createS3Store({ ...cfg, secretAccessKey: 'wrong' });
    await expect(bad.put('x', Buffer.from('x'), 'text/plain')).rejects.toThrow(/refused the upload \(403\)/);
  });
});
