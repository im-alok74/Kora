import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  applyCredit, cancelWriteOff, createBusiness, createParty, customerStatement, getDocument, issueDocument, partyCredit, recordAdvance, recordPayment,
  refundCredit, resolveTenant, saveDraft, writeOffInvoice, ValidationError, type DocIn, type TenantSession,
} from '../src/index.js';

/** Money flows from the overnight audit: part payments, races, TDS, write-offs and advances. */
let db: TestDb;
let owner: TenantSession;
let cust: string;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const mkInvoice = async (partyId: string, rate: string, date = '2026-10-01', over: Partial<DocIn> = {}) => (await issueDocument(db.web, owner, (await saveDraft(db.web, owner, {
  docType: 'tax_invoice', partyId, docDate: date, roundTotal: false,
  lines: [{ name: 'Work', hsnSac: '998313', quantity: '1', rate, taxRateBp: 1800, kind: 'service' }], ...over,
})).id)).document;
const invoice = (rate: string, over: Partial<DocIn> = {}) => mkInvoice(cust, rate, '2026-10-01', over);
const settled = async (id: unknown) => {
  const d = (await getDocument(db.web, owner, id as string))!.document;
  return { settled: BigInt(d.amount_settled_paise as string), status: d.payment_status as string, total: BigInt(d.grand_total_paise as string) };
};
const outcome = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof ValidationError ? 'refused' : `error: ${(e as Error).message}`));

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('money@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  cust = await createParty(db.web, owner, { kind: 'customer', name: 'Local Buyer', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('part payments and the status they leave', () => {
  it('three part payments settle an invoice to the paisa, and a fourth is refused', async () => {
    const inv = await invoice('1000.00');                                     // 1,180.00 with GST
    expect(inv.grand_total_paise).toBe('118000');
    await recordPayment(db.web, owner, { documentId: inv.id as string, amount: '500.00', method: 'upi' });
    expect(await settled(inv.id)).toMatchObject({ settled: 50000n, status: 'part_paid' });
    await recordPayment(db.web, owner, { documentId: inv.id as string, amount: '400.01', method: 'cash' });
    await recordPayment(db.web, owner, { documentId: inv.id as string, amount: '279.99', method: 'bank_transfer' });
    expect(await settled(inv.id)).toMatchObject({ settled: 118000n, status: 'paid' });
    expect((await fails(recordPayment(db.web, owner, { documentId: inv.id as string, amount: '0.01', method: 'cash' }))).message).toMatch(/already paid/);
  });
  it('refuses to take more than is outstanding, to the paisa', async () => {
    const inv = await invoice('100.00');
    await recordPayment(db.web, owner, { documentId: inv.id as string, amount: '100.00', method: 'cash' });
    expect(await fails(recordPayment(db.web, owner, { documentId: inv.id as string, amount: '18.01', method: 'cash' }))).toBeInstanceOf(ValidationError);
    await recordPayment(db.web, owner, { documentId: inv.id as string, amount: '18.00', method: 'cash' });
    expect((await settled(inv.id)).status).toBe('paid');
  });
  it('TDS the customer deducts is a payment of its own, and the invoice is paid when both arrive', async () => {
    const inv = await invoice('10000.00', { tdsBp: 1000 });                   // 11,800.00 billed, 1,000.00 TDS on the taxable value
    expect(inv).toMatchObject({ grand_total_paise: '1180000', tds_paise: '100000' });
    await recordPayment(db.web, owner, { documentId: inv.id as string, amount: '10800.00', method: 'bank_transfer' });
    expect((await settled(inv.id)).status).toBe('part_paid');
    await recordPayment(db.web, owner, { documentId: inv.id as string, amount: '1000.00', method: 'tds' });
    expect(await settled(inv.id)).toMatchObject({ settled: 1180000n, status: 'paid' });
  });
});

describe('two payments at the same moment cannot both take the last of an invoice', () => {
  it('exactly one of two simultaneous full payments succeeds', async () => {
    const inv = await invoice('1000.00');
    const pay = () => outcome(recordPayment(db.web, owner, { documentId: inv.id as string, amount: '1180.00', method: 'upi' }));
    const out = await Promise.all([pay(), pay()]);
    expect([...out].sort()).toEqual(['ok', 'refused']);
    expect(await settled(inv.id)).toMatchObject({ settled: 118000n, status: 'paid' });
  });
  it('two invoices applying the same advance at once never use more than the advance holds', async () => {
    const buyer = await createParty(db.web, owner, { kind: 'customer', name: 'Advance Buyer', stateCode: '27' });
    const [a, b] = [await mkInvoice(buyer, '847.46'), await mkInvoice(buyer, '847.46')];   // 1,000.00 each with GST
    expect(a.grand_total_paise).toBe('100000');
    await recordAdvance(db.web, owner, { partyId: buyer, amount: '1000.00', method: 'upi' });
    const go = (id: unknown) => applyCredit(db.web, owner, { documentId: id as string }).then((r) => r.appliedPaise, (e) => (e instanceof ValidationError ? 'refused' : `error: ${(e as Error).message}`));
    const out = await Promise.all([go(a.id), go(b.id)]);
    const applied = out.filter((x) => /^\d+$/.test(x)).reduce((n, x) => n + BigInt(x), 0n);
    expect(applied).toBe(100000n);                                             // the whole advance, once
    expect(out.filter((x) => x.startsWith('error'))).toEqual([]);              // and no raw database error reaches the caller
  });
});

describe('a written-off invoice and money that turns up afterwards', () => {
  it('is refused until the write-off is cancelled, so the bad debt and the receipt are never both on the books', async () => {
    const inv = await invoice('1000.00');
    await writeOffInvoice(db.web, owner, inv.id as string, 'customer closed down');
    const e = await fails(recordPayment(db.web, owner, { documentId: inv.id as string, amount: '1180.00', method: 'bank_transfer' }));
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.message).toMatch(/written off/);
    await cancelWriteOff(db.web, owner, inv.id as string, 'the money turned up');
    await recordPayment(db.web, owner, { documentId: inv.id as string, amount: '1180.00', method: 'bank_transfer' });
    expect((await settled(inv.id)).status).toBe('paid');
  });
});

describe('the statement always adds up', () => {
  it('opening + billed - received equals closing, with payments, TDS, an advance, a refund of it and a write-off', async () => {
    const buyer = await createParty(db.web, owner, { kind: 'customer', name: 'Statement Buyer', stateCode: '27' });
    const a = await mkInvoice(buyer, '1000.00', '2026-09-01'), b = await mkInvoice(buyer, '333.33', '2026-09-15');
    await recordPayment(db.web, owner, { documentId: a.id as string, amount: '600.00', method: 'upi', receivedOn: '2026-09-05' });
    await recordPayment(db.web, owner, { documentId: a.id as string, amount: '100.00', method: 'tds', receivedOn: '2026-09-20' });
    await recordAdvance(db.web, owner, { partyId: buyer, amount: '250.50', method: 'cash', receivedOn: '2026-09-25' });
    const { payments } = await partyCredit(db.web, owner, buyer);
    await refundCredit(db.web, owner, payments[0]!.id as string, { amount: '50.50', method: 'upi', refundedOn: '2026-09-26' });
    await writeOffInvoice(db.web, owner, b.id as string, 'small balance');
    const s = await customerStatement(db.web, owner, buyer, { from: '2026-09-10', to: '2026-10-31' });
    const billed = s.rows.reduce((n, r) => n + BigInt(r.debit), 0n), credited = s.rows.reduce((n, r) => n + BigInt(r.credit), 0n);
    expect(BigInt(s.opening) + billed - credited).toBe(BigInt(s.closing));
    expect(s.rows.at(-1)!.balance).toBe(s.closing);
    // 1,180.00 + 393.33 billed; 600 + 100 + 250.50 received; 50.50 refunded; 393.33 written off.
    expect(BigInt(s.closing)).toBe(118000n + 39333n - 60000n - 10000n - 25050n + 5050n - 39333n);
  });
});
