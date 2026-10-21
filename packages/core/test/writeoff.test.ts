import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  ageingReport, cancelDocument, cancelWriteOff, createBusiness, createParty, customerStatement, gstr1, gstr3b, gstSummary,
  issueDocument, recordPayment, reopenDocument, resolveTenant, saveDraft, salesByCustomer, writeOffInvoice,
  type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, other: TenantSession;
let cust: string, otherCust: string;

const AS_OF = '2026-06-30';
const PERIOD = '2026-05';

const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };

const draft = (t: TenantSession, party: string, rate: string, date = '2026-05-10') => saveDraft(db.web, t, {
  docType: 'tax_invoice', partyId: party, docDate: date, dueDate: '2026-05-20',
  lines: [{ name: 'Consulting', hsnSac: '9983', quantity: '1', rate, taxRateBp: 1800 }],
});
const invoice = async (t: TenantSession, party: string, rate: string, date = '2026-05-10') =>
  (await issueDocument(db.web, t, (await draft(t, party, rate, date)).id)).document.id as string;

/** What the ageing report says is owed, in total. */
const owed = async (t: TenantSession) => (await ageingReport(db.web, t, { asOf: AS_OF })).totals.total;
/** Every number the GST returns would carry for the month, as one string. */
const returns = async (t: TenantSession) => JSON.stringify([
  await gstr1(db.web, t, PERIOD), await gstSummary(db.web, t, PERIOD), await gstr3b(db.web, t, PERIOD),
]);
const closing = async (party: string) => (await customerStatement(db.web, owner, party, { from: '2026-01-01', to: '2026-12-31' })).closing;

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('wo-owner@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Sahyadri Works', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  cust = await createParty(db.web, owner, { kind: 'customer', name: 'Verma Stores', stateCode: '27' });

  const [u2] = await db.owner`insert into app_user (email) values ('wo-other@example.test') returning id`;
  const bid2 = await createBusiness(db.web, u2!.id as string, { legalName: 'Konkan Supply', gstin: '29BBBCC1234D1Z4', stateCode: '29', registrationType: 'regular' });
  other = await resolveTenant(db.web, u2!.id as string, bid2);
  otherCust = await createParty(db.web, other, { kind: 'customer', name: 'Kadam Traders', stateCode: '29' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('writing an invoice off as a bad debt', () => {
  it('takes the whole balance out of the receivable, and puts it back when the write-off is cancelled', async () => {
    const id = await invoice(owner, cust, '10000');          // 11,800 due
    const before = BigInt(await owed(owner));
    const w = await writeOffInvoice(db.web, owner, id, 'the customer has shut down');
    expect(w.writeOff!.amount_paise).toBe('1180000');
    expect(w.writeOff!.reason).toBe('the customer has shut down');
    expect(BigInt(await owed(owner))).toBe(before - 1_180_000n);

    await cancelWriteOff(db.web, owner, id, 'the customer has paid after all');
    expect(BigInt(await owed(owner))).toBe(before);
    const [row] = await db.owner`select cancelled_at, cancel_reason from document_write_off where document_id = ${id}`;
    expect(row!.cancelled_at).not.toBeNull();                 // reversed, never deleted
    expect(row!.cancel_reason).toBe('the customer has paid after all');
    await writeOffInvoice(db.web, owner, id, 'written off again after the cheque bounced');
  });

  it('does not move a single figure in GSTR-1, the GST summary or GSTR-3B', async () => {
    const id = await invoice(owner, cust, '7000');
    const before = await returns(owner);
    await writeOffInvoice(db.web, owner, id, 'gone into liquidation');
    expect(await returns(owner)).toBe(before);

    // and the document itself is untouched, which is why the returns cannot move
    const [d] = await db.owner`select taxable_paise::text t, cgst_paise::text c, sgst_paise::text s, igst_paise::text i,
                                      cess_paise::text ce, grand_total_paise::text g, status from document where id = ${id}`;
    expect(d).toEqual({ t: '700000', c: '63000', s: '63000', i: '0', ce: '0', g: '826000', status: 'issued' });

    await cancelWriteOff(db.web, owner, id, 'back to receivable');
    expect(await returns(owner)).toBe(before);
  });

  it('drops out of the ageing report entirely, invoice row and bucket alike', async () => {
    const id = await invoice(owner, cust, '3000');
    const listed = async () => (await ageingReport(db.web, owner, { asOf: AS_OF })).rows.flatMap((r) => r.invoices.map((x) => x.id));
    expect(await listed()).toContain(id);
    await writeOffInvoice(db.web, owner, id, 'untraceable');
    expect(await listed()).not.toContain(id);
    // sales by customer reports the same outstanding figure as the ageing
    const [row] = (await salesByCustomer(db.web, owner, { from: '2026-01-01', to: '2026-12-31' })).rows;
    expect(row!.outstanding).toBe((await ageingReport(db.web, owner, { asOf: AS_OF })).totals.total);
  });

  it('stops counting in the customer statement, as a credit on the day it was written off', async () => {
    const id = await invoice(owner, cust, '1000');            // 1,180 due
    const before = BigInt(await closing(cust));
    await writeOffInvoice(db.web, owner, id, 'shop closed');
    expect(BigInt(await closing(cust))).toBe(before - 118_000n);
    const s = await customerStatement(db.web, owner, cust, { from: '2026-01-01', to: '2026-12-31' });
    const off = s.rows.filter((r) => r.description.startsWith('Bad debt written off'));
    expect(off.some((r) => r.credit === '118000')).toBe(true);
    // the running balance still ties, line by line
    let bal = BigInt(s.opening);
    for (const r of s.rows) { bal += BigInt(r.debit) - BigInt(r.credit); expect(r.balance).toBe(bal.toString()); }
    expect(s.closing).toBe(bal.toString());

    await cancelWriteOff(db.web, owner, id, 'paid');
    expect(BigInt(await closing(cust))).toBe(before);
  });

  it('writes off only the unpaid remainder after a part payment', async () => {
    const id = await invoice(owner, cust, '5000');            // 5,900 due
    await recordPayment(db.web, owner, { documentId: id, amount: '2000', method: 'cash', receivedOn: '2026-05-25' });
    const owedBefore = BigInt(await owed(owner)), closeBefore = BigInt(await closing(cust));
    const w = await writeOffInvoice(db.web, owner, id, 'the balance will not come');
    expect(w.writeOff!.amount_paise).toBe('390000');          // 5,900 less the 2,000 received
    expect(w.document.amount_settled_paise).toBe('200000');   // the payment is still a payment
    expect(w.document.grand_total_paise).toBe('590000');      // the bill is still the bill
    expect(BigInt(await owed(owner))).toBe(owedBefore - 390_000n);
    expect(BigInt(await closing(cust))).toBe(closeBefore - 390_000n);
  });

  it('refuses an invoice that is already paid in full', async () => {
    const id = await invoice(owner, cust, '1000');
    await recordPayment(db.web, owner, { documentId: id, amount: '1180', method: 'upi', receivedOn: '2026-05-26' });
    expect((await fails(writeOffInvoice(db.web, owner, id, 'try it'))).message)
      .toBe('This invoice is paid in full, so there is nothing to write off.');
  });

  it('refuses a draft, and refuses a cancelled document', async () => {
    const d = await draft(owner, cust, '900');
    expect((await fails(writeOffInvoice(db.web, owner, d.id, 'try it'))).message)
      .toBe('Issue this document before you write it off. A draft owes nothing.');
    const id = await invoice(owner, cust, '900');
    await cancelDocument(db.web, owner, id, 'raised in error');
    expect((await fails(writeOffInvoice(db.web, owner, id, 'try it'))).message)
      .toBe('Only an issued document can be written off. This one is cancelled.');
  });

  it('refuses a second live write-off, and refuses to cancel one that is not there', async () => {
    const id = await invoice(owner, cust, '800');
    await writeOffInvoice(db.web, owner, id, 'first');
    expect((await fails(writeOffInvoice(db.web, owner, id, 'second'))).message)
      .toBe('This invoice is already written off. Cancel that write-off first.');
    const clean = await invoice(owner, cust, '800');
    expect((await fails(cancelWriteOff(db.web, owner, clean, 'nothing to undo'))).message)
      .toBe('This invoice is not written off, so there is nothing to cancel.');
  });

  it('needs a reason', async () => {
    const id = await invoice(owner, cust, '700');
    expect((await fails(writeOffInvoice(db.web, owner, id, '  '))).message).toMatch(/Reason/);
  });

  it('cannot reach across businesses', async () => {
    const mine = await invoice(owner, cust, '2500');
    const theirs = await invoice(other, otherCust, '2500');
    expect((await fails(writeOffInvoice(db.web, other, mine, 'not yours'))).message).toBe('Document not found.');
    expect((await fails(writeOffInvoice(db.web, owner, theirs, 'not yours'))).message).toBe('Document not found.');

    const myOwed = await owed(owner);
    await writeOffInvoice(db.web, other, theirs, 'their own bad debt');
    expect(await owed(owner)).toBe(myOwed);                   // their write-off changes nothing here
    expect((await fails(cancelWriteOff(db.web, owner, theirs, 'not yours'))).message)
      .toBe('This invoice is not written off, so there is nothing to cancel.');
  });
});

describe('re-opening a cancelled document', () => {
  it('brings it back under the same number, keeping both reasons', async () => {
    const id = await invoice(owner, cust, '4000');
    const [before] = await db.owner`select number from document where id = ${id}`;
    await cancelDocument(db.web, owner, id, 'cancelled by mistake');
    const owedWhileCancelled = BigInt(await owed(owner));

    const back = await reopenDocument(db.web, owner, id, 'it was cancelled by mistake');
    expect(back.document.status).toBe('issued');
    expect(back.document.number).toBe(before!.number);
    expect(back.document.cancelled_at).toBeNull();
    expect(back.document.cancel_reason).toBe('cancelled by mistake');
    expect(back.document.reopen_reason).toBe('it was cancelled by mistake');
    expect(back.document.reopened_at).not.toBeNull();
    expect(BigInt(await owed(owner))).toBe(owedWhileCancelled + 472_000n);
  });

  it('refuses anything that is not cancelled, and needs a reason', async () => {
    const id = await invoice(owner, cust, '1100');
    expect((await fails(reopenDocument(db.web, owner, id, 'why not'))).message).toBe('Only a cancelled document can be re-opened.');
    const d = await draft(owner, cust, '1100');
    expect((await fails(reopenDocument(db.web, owner, d.id, 'why not'))).message).toBe('Only a cancelled document can be re-opened.');
    const dead = await invoice(owner, cust, '1100');
    await cancelDocument(db.web, owner, dead, 'gone');
    expect((await fails(reopenDocument(db.web, owner, dead, ' '))).message).toMatch(/Reason/);
  });

  it('cannot reach across businesses', async () => {
    const id = await invoice(owner, cust, '1300');
    await cancelDocument(db.web, owner, id, 'gone');
    expect((await fails(reopenDocument(db.web, other, id, 'not yours'))).message).toBe('Only a cancelled document can be re-opened.');
    const [still] = await db.owner`select status from document where id = ${id}`;
    expect(still!.status).toBe('cancelled');
  });
});
