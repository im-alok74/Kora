import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { addMember, applyCredit, createBusiness, createParty, getDocument, issueDocument, listPayments, listUnallocated, partyCredit, recordAdvance, refundCredit, resolveTenant, saveDraft, voidPayment, type TenantSession } from '../src/index.js';

let db: TestDb;
let owner: TenantSession, accountant: TenantSession, other: TenantSession, cust: string, cust2: string;
const inv = async (party: string, rate: string) => {
  const d = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: party, lines: [{ name: 'Work', hsnSac: '998313', quantity: '1', rate, taxRateBp: 0, kind: 'service' }] });
  await issueDocument(db.web, owner, d.id);
  return d.id;
};

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [o, a, x] = [await mk('o@c.test'), await mk('a@c.test'), await mk('x@c.test')];
  const bid = await createBusiness(db.web, o, { legalName: 'Credit Co', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  await addMember(db.web, o, bid, a, 'accountant');
  owner = await resolveTenant(db.web, o, bid); accountant = await resolveTenant(db.web, a, bid);
  other = await resolveTenant(db.web, x, await createBusiness(db.web, x, { legalName: 'Other', gstin: null, stateCode: '27', registrationType: 'unregistered' }));
  cust = await createParty(db.web, owner, { kind: 'customer', name: 'Holds Money', stateCode: '27' });
  cust2 = await createParty(db.web, owner, { kind: 'customer', name: 'Other Customer', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('advances and customer credit', () => {
  it('holds an advance on the customer and shows it as credit', async () => {
    await recordAdvance(db.web, owner, { partyId: cust, amount: '5000', method: 'upi', receivedOn: '2026-10-01' });
    await recordAdvance(db.web, owner, { partyId: cust, amount: '2000.50', method: 'cash', receivedOn: '2026-10-05' });
    const c = await partyCredit(db.web, owner, cust);
    expect(c.totalPaise).toBe('700050');
    expect(c.payments.map((p) => p.available_paise)).toEqual(['500000', '200050']);       // oldest first
    expect((await partyCredit(db.web, owner, cust2)).totalPaise).toBe('0');
    expect((await listUnallocated(db.web, owner)).length).toBe(2);
  });
  it('applies credit oldest first, up to what is due, and leaves the rest held', async () => {
    const id = await inv(cust, '6000');
    const r = await applyCredit(db.web, owner, { documentId: id });
    expect(r.appliedPaise).toBe('600000');
    expect(r.paymentStatus).toBe('paid');
    expect((await getDocument(db.web, owner, id))!.document).toMatchObject({ amount_settled_paise: '600000', payment_status: 'paid' });
    expect((await partyCredit(db.web, owner, cust)).totalPaise).toBe('100050');            // 7000.50 less 6000
    expect((await listPayments(db.web, owner, id)).map((p) => p.allocated_paise)).toEqual(['500000', '100000']);
  });
  it('applies only the amount asked for, and a part payment stays part paid', async () => {
    const id = await inv(cust, '1000');
    const r = await applyCredit(db.web, owner, { documentId: id, amount: '300' });
    expect(r.appliedPaise).toBe('30000');
    expect(r.paymentStatus).toBe('part_paid');
    expect((await partyCredit(db.web, owner, cust)).totalPaise).toBe('70050');
  });
  it('refuses to apply when nothing is held, to a paid or unissued invoice', async () => {
    const other2 = await inv(cust2, '100');
    await expect(applyCredit(db.web, owner, { documentId: other2 })).rejects.toThrow(/no money held/);
    const draft = (await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: cust, lines: [{ name: 'W', hsnSac: '998313', quantity: '1', rate: '10', taxRateBp: 0, kind: 'service' }] })).id;
    await expect(applyCredit(db.web, owner, { documentId: draft })).rejects.toThrow(/issued invoice/);
    const paid = await inv(cust, '100');
    await applyCredit(db.web, owner, { documentId: paid });
    await expect(applyCredit(db.web, owner, { documentId: paid })).rejects.toThrow(/already paid/);
  });
  it('lets an accountant read but not take money in, and refuses bad input', async () => {
    expect((await partyCredit(db.web, accountant, cust)).payments).toBeDefined();
    await expect(recordAdvance(db.web, accountant, { partyId: cust, amount: '1', method: 'cash' })).rejects.toThrow();
    await expect(recordAdvance(db.web, owner, { partyId: cust, amount: '0', method: 'cash' })).rejects.toThrow(/more than zero/);
    await expect(recordAdvance(db.web, owner, { partyId: cust, amount: '10', method: 'tds' })).rejects.toThrow(/how the money was received/);
    await expect(recordAdvance(db.web, other, { partyId: cust, amount: '10', method: 'cash' })).rejects.toThrow(/Customer not found/);
  });
});

describe('refunding money that is held', () => {
  it('returns part of an unapplied payment and reduces what is held', async () => {
    const c = await partyCredit(db.web, owner, cust2);
    const pay = (await recordAdvance(db.web, owner, { partyId: cust2, amount: '1000', method: 'bank_transfer' })).paymentId;
    await refundCredit(db.web, owner, pay, { amount: '400', method: 'bank_transfer', note: 'Order cancelled' });
    expect((await partyCredit(db.web, owner, cust2)).totalPaise).toBe((BigInt(c.totalPaise) + 60000n).toString());
    expect((await db.owner`select amount_paise from payment_refund where payment_id = ${pay}`)[0]!.amount_paise).toBe('40000');
  });
  it('cannot refund more than is held, or money already applied to an invoice', async () => {
    const pay = (await recordAdvance(db.web, owner, { partyId: cust2, amount: '500', method: 'cash' })).paymentId;
    await expect(refundCredit(db.web, owner, pay, { amount: '600', method: 'cash' })).rejects.toThrow(/Only 500.00 is held/);
    const id = await inv(cust2, '9999');
    await applyCredit(db.web, owner, { documentId: id });
    await expect(refundCredit(db.web, owner, pay, { amount: '1', method: 'cash' })).rejects.toThrow(/nothing to refund|Only/);
  });
  it('cannot be used twice: refunded money is not available to apply, and the database guard agrees', async () => {
    const p = (await recordAdvance(db.web, owner, { partyId: cust, amount: '200', method: 'cash' })).paymentId;
    const before = BigInt((await partyCredit(db.web, owner, cust)).totalPaise);
    await refundCredit(db.web, owner, p, { amount: '200', method: 'cash' });
    expect(BigInt((await partyCredit(db.web, owner, cust)).totalPaise)).toBe(before - 20000n);
    await expect(db.owner`insert into payment_refund (business_id, payment_id, amount_paise, method, refunded_on) select business_id, id, 1, 'cash', current_date from payment where id = ${p}`).rejects.toThrow(/refund cannot be more/);
  });
  it('blocks removing a payment that has been partly refunded, and the unapplied list agrees with the credit', async () => {
    const p = (await recordAdvance(db.web, owner, { partyId: cust2, amount: '50', method: 'cash' })).paymentId;
    await refundCredit(db.web, owner, p, { amount: '10', method: 'cash' });
    await expect(voidPayment(db.web, owner, p)).rejects.toThrow(/refunded/);
    const heldByCredit = BigInt((await partyCredit(db.web, owner, cust2)).totalPaise) + BigInt((await partyCredit(db.web, owner, cust)).totalPaise);
    const heldByList = (await listUnallocated(db.web, owner)).reduce((a, r) => a + BigInt(r.unallocated_paise as string), 0n);
    expect(heldByList).toBe(heldByCredit);
  });
});
