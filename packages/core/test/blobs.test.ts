import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addToInbox, blobStoreFromEnv, createBusiness, createS3Store, getInboxFile, getReceipt, memoryBlobStore, removeFromInbox, removeReceipt, resolveTenant, saveExpense, setBlobStore, setReceipt,
  type TenantSession,
} from '../src/index.js';

let db: TestDb;
let t: TenantSession;
const PDF = Buffer.from('%PDF-1.4 stored elsewhere');
const b64 = PDF.toString('base64');

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('b@e.test') returning id`;
  t = await resolveTenant(db.web, u!.id as string, await createBusiness(db.web, u!.id as string, { legalName: 'Acme', gstin: null, stateCode: '27', registrationType: 'unregistered' }));
}, 60_000);
afterAll(async () => { setBlobStore(null); await db?.drop(); });

describe('files in the database (the default)', () => {
  it('stores and returns a receipt with no object storage configured', async () => {
    setBlobStore(null);
    const { id } = await saveExpense(db.web, t, { category: 'Travel', amount: '100' });
    await setReceipt(db.web, t, id, { name: 'a.pdf', type: 'application/pdf', dataBase64: b64 });
    const [row] = await db.owner`select data is not null as in_db, storage_key from expense_receipt where expense_id = ${id}`;
    expect(row).toMatchObject({ in_db: true, storage_key: null });
    expect((await getReceipt(db.web, t, id))!.data).toEqual(PDF);
  });
});

describe('files in object storage', () => {
  it('writes receipts to the store under the business id, keeps only the key in the database, and reads them back', async () => {
    const store = memoryBlobStore();
    setBlobStore(store);
    const { id } = await saveExpense(db.web, t, { category: 'Rent', amount: '5000' });
    await setReceipt(db.web, t, id, { name: 'r.pdf', type: 'application/pdf', dataBase64: b64 });
    const [row] = await db.owner`select data, storage_key from expense_receipt where expense_id = ${id}`;
    expect(row!.data).toBeNull();
    expect(String(row!.storage_key)).toMatch(new RegExp(`^${t.businessId}/receipts/${id}-`));
    expect(store.objects.size).toBe(1);
    expect((await getReceipt(db.web, t, id))!.data).toEqual(PDF);

    // replacing the file removes the old object, and deleting the receipt removes the last one
    await setReceipt(db.web, t, id, { name: 'r2.pdf', type: 'application/pdf', dataBase64: Buffer.from('%PDF-1.4 newer').toString('base64') });
    expect(store.objects.size).toBe(1);
    expect((await getReceipt(db.web, t, id))!.data.toString()).toBe('%PDF-1.4 newer');
    await removeReceipt(db.web, t, id);
    expect(store.objects.size).toBe(0);
    expect(await getReceipt(db.web, t, id)).toBeNull();
  });

  it('keeps an inbox file there too, and removes it with the item', async () => {
    const store = memoryBlobStore();
    setBlobStore(store);
    const { id } = await addToInbox(db.web, t, { title: 'Bill', name: 'bill.pdf', type: 'application/pdf', dataBase64: b64 });
    expect([...store.objects.keys()]).toEqual([`${t.businessId}/inbox/${id}`]);
    expect((await getInboxFile(db.web, t, id))!.data).toEqual(PDF);
    await removeFromInbox(db.web, t, id);
    expect(store.objects.size).toBe(0);
  });

  it('still reads files saved in the database after storage is switched on, and says so plainly when storage is gone', async () => {
    setBlobStore(null);
    const { id } = await addToInbox(db.web, t, { title: 'Old', name: 'old.pdf', type: 'application/pdf', dataBase64: b64 });
    setBlobStore(memoryBlobStore());
    expect((await getInboxFile(db.web, t, id))!.data).toEqual(PDF);
    const s = memoryBlobStore();
    setBlobStore(s);
    const { id: id2 } = await addToInbox(db.web, t, { title: 'New', name: 'new.pdf', type: 'application/pdf', dataBase64: b64 });
    setBlobStore(null);
    await expect(getInboxFile(db.web, t, id2)).rejects.toThrow(/object storage, which is not configured/);
  });

  it('does not leave a row behind when the upload to storage fails', async () => {
    setBlobStore({ put: async () => { throw new Error('storage down'); }, get: async () => null, delete: async () => {} });
    await expect(addToInbox(db.web, t, { title: 'Fails', name: 'f.pdf', type: 'application/pdf', dataBase64: b64 })).rejects.toThrow(/storage down/);
    const { id } = await saveExpense(db.web, t, { category: 'Other', amount: '1' });
    await expect(setReceipt(db.web, t, id, { name: 'f.pdf', type: 'application/pdf', dataBase64: b64 })).rejects.toThrow(/storage down/);
    expect(await getReceipt(db.web, t, id)).toBeNull();
    const rows = await db.owner`select count(*)::int as n from inbox_item where title = 'Fails'`;
    expect(rows[0]!.n).toBe(0);
  });
});

describe('the S3 client', () => {
  it('signs requests with SigV4, uses path-style addresses, and maps 404 to null', async () => {
    const calls: { url: string; method: string; auth: string | null; type: string | null }[] = [];
    const f = (async (req: Request) => {
      calls.push({ url: req.url, method: req.method, auth: req.headers.get('authorization'), type: req.headers.get('content-type') });
      if (req.method === 'GET') return new Response('not here', { status: 404 });
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;
    const s = createS3Store({ endpoint: 'https://acct.r2.cloudflarestorage.com/', bucket: 'kora-files', accessKeyId: 'AKIA', secretAccessKey: 'secret', fetch: f });
    await s.put('biz 1/receipts/a b.pdf', Buffer.from('x'), 'application/pdf');
    expect(await s.get('biz 1/receipts/a b.pdf')).toBeNull();
    await s.delete('biz 1/receipts/a b.pdf');
    expect(calls.map((c) => c.method)).toEqual(['PUT', 'GET', 'DELETE']);
    expect(calls[0]!.url).toBe('https://acct.r2.cloudflarestorage.com/kora-files/biz%201/receipts/a%20b.pdf');
    expect(calls[0]!.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIA\/\d{8}\/auto\/s3\/aws4_request/);
    expect(calls[0]!.type).toBe('application/pdf');
  });
  it('turns errors into messages and is chosen only when every setting is present', async () => {
    const f = (async () => new Response('denied', { status: 403 })) as unknown as typeof fetch;
    const s = createS3Store({ endpoint: 'https://x', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's', fetch: f });
    await expect(s.put('k', Buffer.from('x'), 'text/plain')).rejects.toThrow(/refused the upload \(403\)/);
    await expect(s.get('k')).rejects.toThrow(/could not be read \(403\)/);
    expect(blobStoreFromEnv({})).toBeNull();
    expect(blobStoreFromEnv({ BLOB_S3_ENDPOINT: 'https://x', BLOB_S3_BUCKET: 'b', BLOB_S3_ACCESS_KEY_ID: 'a' })).toBeNull();
    expect(blobStoreFromEnv({ BLOB_S3_ENDPOINT: 'https://x', BLOB_S3_BUCKET: 'b', BLOB_S3_ACCESS_KEY_ID: 'a', BLOB_S3_SECRET_ACCESS_KEY: 's' })).not.toBeNull();
  });
});
