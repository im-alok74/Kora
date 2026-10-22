import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, createBusiness, createParty, getDocument, issueDocument, paymentTimeline, recordPayment, refundInvoicePayment, resolveTenant, saveDraft, listPayments,
  type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, staff: TenantSession;
let cust: string;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const issue = async (rate = '1000.00') => {
  const { id } = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: cust, docDate: '2026-10-01', lines: [{ name: 'Work', hsnSac: '998313', quantity: '1', rate, taxRateBp: 0, kind: 'service' }] });
  await issueDocument(db.web, owner, id);
  return id;
};
const allocOf = async (docId: string) => (await listPayments(db.web, owner, docId)).map((a) => a.allocation_id as string);

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('o@example.test') returning id`;
  const [s] = await db.owner`insert into app_user (email) values ('s@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  await addMember(db.web, u!.id as string, bid, s!.id as string, 'staff');
  owner = await resolveTenant(db.web, u!.id as string, bid);
  staff = await resolveTenant(db.web, s!.id as string, bid);
  cust = await createParty(db.web, owner, { kind: 'customer', name: 'Asha Stores', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('the money story of an invoice', () => {
  it('lists the invoice, each part payment with what was left, and ends at what the invoice shows as due', async () => {
    const d = await issue();
    await recordPayment(db.web, owner, { documentId: d, amount: '300', method: 'cash', receivedOn: '2026-10-05' });
    await recordPayment(db.web, owner, { documentId: d, amount: '200', method: 'upi', receivedOn: '2026-10-09' });
    const t = await paymentTimeline(db.web, owner, d);
    expect(t.state).toBe('part_paid');
    expect(t.events.map((e) => [e.kind, e.balancePaise])).toEqual([['issued', '100000'], ['payment', '70000'], ['payment', '50000']]);
    expect(t.duePaise).toBe('50000');
    expect((await getDocument(db.web, owner, d))!.document).toMatchObject({ amount_settled_paise: '50000' });
  });
  it('shows a settled invoice as paid', async () => {
    const d = await issue('100.00');
    await recordPayment(db.web, owner, { documentId: d, amount: '100', method: 'cash' });
    expect(await paymentTimeline(db.web, owner, d)).toMatchObject({ state: 'paid', duePaise: '0' });
  });
});

describe('refunding a payment made against an invoice', () => {
  it('a part refund reopens part of the invoice and shows on the timeline', async () => {
    const d = await issue();
    await recordPayment(db.web, owner, { documentId: d, amount: '1000', method: 'bank_transfer', receivedOn: '2026-10-05' });
    const [a] = await allocOf(d);
    const r = await refundInvoicePayment(db.web, owner, { allocationId: a!, amount: '250', method: 'bank_transfer', refundedOn: '2026-10-20', note: 'Returned goods' });
    expect(r).toMatchObject({ paymentStatus: 'part_paid', settledPaise: '75000' });
    const t = await paymentTimeline(db.web, owner, d);
    expect(t.duePaise).toBe('25000');
    const last = t.events[t.events.length - 1]!;
    expect(last).toMatchObject({ kind: 'refund', amountPaise: '-25000' });
    expect(last.title).toContain('Returned goods');
  });
  it('a full refund puts the invoice back to unpaid', async () => {
    const d = await issue('400.00');
    await recordPayment(db.web, owner, { documentId: d, amount: '400', method: 'cash' });
    await refundInvoicePayment(db.web, owner, { allocationId: (await allocOf(d))[0]!, amount: '400', method: 'cash' });
    expect((await getDocument(db.web, owner, d))!.document).toMatchObject({ payment_status: 'unpaid', amount_settled_paise: '0' });
  });
  it('refuses more than was applied, a repeat, a bad method, and a staff member', async () => {
    const d = await issue('500.00');
    await recordPayment(db.web, owner, { documentId: d, amount: '500', method: 'cash' });
    const a = (await allocOf(d))[0]!;
    expect((await fails(refundInvoicePayment(db.web, owner, { allocationId: a, amount: '600', method: 'cash' }))).message).toMatch(/Only Rs 500.00/);
    expect((await fails(refundInvoicePayment(db.web, owner, { allocationId: a, amount: '100', method: 'barter' }))).message).toMatch(/how the money was returned/);
    await refundInvoicePayment(db.web, owner, { allocationId: a, amount: '500', method: 'cash' });
    expect((await fails(refundInvoicePayment(db.web, owner, { allocationId: a, amount: '1', method: 'cash' }))).message).toMatch(/Payment not found/);
    const e = await issue('50.00');
    await recordPayment(db.web, owner, { documentId: e, amount: '50', method: 'cash' });
    await expect(refundInvoicePayment(db.web, staff, { allocationId: (await allocOf(e))[0]!, amount: '10', method: 'cash' })).resolves.toBeTruthy();   // staff may record payments, so may refund them
  });
  it('does not refund a gateway payment or a payment tax deducted at source', async () => {
    const d = await issue('300.00');
    await recordPayment(db.web, owner, { documentId: d, amount: '30', method: 'tds' });
    expect((await fails(refundInvoicePayment(db.web, owner, { allocationId: (await allocOf(d))[0]!, amount: '10', method: 'cash' }))).message).toMatch(/cannot be refunded from here/);
    const [p] = await db.owner`select id from payment where method = 'tds' order by created_at desc limit 1`;
    await db.owner`update payment set method = 'upi', gateway = 'mock', gateway_event_id = 'e1', gateway_payment_id = 'p1' where id = ${p!.id as string}`;
    expect((await fails(refundInvoicePayment(db.web, owner, { allocationId: (await allocOf(d))[0]!, amount: '10', method: 'cash' }))).message).toMatch(/refunded at the gateway/);
  });
});
