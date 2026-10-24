import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { createBusiness, createParty, getDocument, issueDocument, recordPayment, resolveTenant, saveDraft, type DocIn, type TenantSession } from '../src/index.js';

// Finding P-6 of the launch audit: a retried "record this payment" request must not record the money twice.

let db: TestDb;
let owner: TenantSession;
let cust: string;
const inv = (): DocIn => ({ docType: 'tax_invoice', partyId: cust, docDate: '2026-10-18', dueDate: '2026-11-17', lines: [{ name: 'Widget', hsnSac: '8471', quantity: '1', rate: '1000.00', taxRateBp: 1800 }] });
const issueNew = async () => (await issueDocument(db.web, owner, (await saveDraft(db.web, owner, inv())).id)).document;
const doc = async (id: string) => (await getDocument(db.web, owner, id))!.document;

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('own@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  cust = await createParty(db.web, owner, { kind: 'customer', name: 'Verma Stores', stateCode: '27', phone: '9876543210' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('P-6: a retried API request does not record the money twice', () => {
  const key = 'order-10452-pay-1';
  it('the same Idempotency-Key returns the same payment and changes nothing', async () => {
    const d = await issueNew();
    const a = await recordPayment(db.web, owner, { documentId: d.id as string, amount: '400', method: 'upi', idempotencyKey: key });
    const b = await recordPayment(db.web, owner, { documentId: d.id as string, amount: '400', method: 'upi', idempotencyKey: key });
    expect(b.paymentId).toBe(a.paymentId);
    expect(b.replayed).toBe(true);
    expect(a.replayed).toBeFalsy();
    expect((await doc(d.id as string)).amount_settled_paise).toBe('40000');
  });
  it('a retry that arrives after the invoice is fully paid still answers with the first result', async () => {
    const d = await issueNew();
    const a = await recordPayment(db.web, owner, { documentId: d.id as string, amount: '1180', method: 'bank_transfer', idempotencyKey: 'full-payment-77' });
    const b = await recordPayment(db.web, owner, { documentId: d.id as string, amount: '1180', method: 'bank_transfer', idempotencyKey: 'full-payment-77' });
    expect(b).toMatchObject({ paymentId: a.paymentId, replayed: true, paymentStatus: 'paid' });
  });
  it('five simultaneous retries record exactly one payment', async () => {
    const d = await issueNew();
    const rs = await Promise.all(Array.from({ length: 5 }, () => recordPayment(db.web, owner, { documentId: d.id as string, amount: '300', method: 'cash', idempotencyKey: 'burst-retry-001' })));
    expect(new Set(rs.map((r) => r.paymentId)).size).toBe(1);
    expect((await doc(d.id as string)).amount_settled_paise).toBe('30000');
  });
  it('the same key with a different amount or invoice is refused, not silently merged', async () => {
    const d = await issueNew(), e = await issueNew();
    await recordPayment(db.web, owner, { documentId: d.id as string, amount: '100', method: 'cash', idempotencyKey: 'reuse-key-0001' });
    await expect(recordPayment(db.web, owner, { documentId: d.id as string, amount: '200', method: 'cash', idempotencyKey: 'reuse-key-0001' })).rejects.toThrow(/Idempotency-Key/);
    await expect(recordPayment(db.web, owner, { documentId: e.id as string, amount: '100', method: 'cash', idempotencyKey: 'reuse-key-0001' })).rejects.toThrow(/Idempotency-Key/);
  });
  it('a malformed key is refused, and no key behaves as before', async () => {
    const d = await issueNew();
    await expect(recordPayment(db.web, owner, { documentId: d.id as string, amount: '100', method: 'cash', idempotencyKey: 'short' })).rejects.toThrow(/Idempotency-Key/);
    await recordPayment(db.web, owner, { documentId: d.id as string, amount: '100', method: 'cash' });
    await recordPayment(db.web, owner, { documentId: d.id as string, amount: '100', method: 'cash' });
    expect((await doc(d.id as string)).amount_settled_paise).toBe('20000');
  });
});
