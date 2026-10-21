import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  cancelDocument, createBusiness, createContactPerson, createParty, customerStatement, issueDocument, queueStatementSend,
  recordAdvance, recordPayment, refundCredit, resolveTenant, saveDraft, startNote, statementText, updateParty, ValidationError,
  type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, other: TenantSession;
let cust: string;
let marchInvoice: string;

const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };

const draft = (date: string, rate: string, extra: object = {}) => saveDraft(db.web, owner, {
  docType: 'tax_invoice', partyId: cust, docDate: date, lines: [{ name: 'Consulting', hsnSac: '9983', quantity: '1', rate, taxRateBp: 1800 }], ...extra,
});
const invoice = async (date: string, rate: string, extra: object = {}) => (await issueDocument(db.web, owner, (await draft(date, rate, extra)).id)).document;

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('stmt-owner@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Nilgiri Works', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  cust = await createParty(db.web, owner, { kind: 'customer', name: 'Verma Stores', stateCode: '27' });

  const [u2] = await db.owner`insert into app_user (email) values ('stmt-other@example.test') returning id`;
  const bid2 = await createBusiness(db.web, u2!.id as string, { legalName: 'Konkan Supply', gstin: '29BBBCC1234D1Z4', stateCode: '29', registrationType: 'regular' });
  other = await resolveTenant(db.web, u2!.id as string, bid2);

  // January: one invoice of 1,180 and 200 received against it.
  const jan = await invoice('2027-01-10', '1000');
  await recordPayment(db.web, owner, { documentId: jan.id as string, amount: '200', method: 'cash', receivedOn: '2027-01-20' });
  // February: a reverse-charge invoice (the tax is shown but the recipient pays it, so only the taxable value is due) and a credit note.
  await invoice('2027-02-05', '1000', { reverseCharge: true });
  const note = await startNote(db.web, owner, jan.id as string, 'credit_note');
  await saveDraft(db.web, owner, {
    docType: 'credit_note', partyId: cust, originalDocumentId: jan.id as string, docDate: '2027-02-10',
    lines: [{ name: 'Consulting', hsnSac: '9983', quantity: '1', rate: '100', taxRateBp: 1800 }],
  }, note.id);
  await issueDocument(db.web, owner, note.id);
  // Neither of these may appear: one never left draft, the other was cancelled.
  await draft('2027-02-15', '777');
  const scrapped = await invoice('2027-02-20', '888');
  await cancelDocument(db.web, owner, scrapped.id as string, 'raised in error');
  // March: an invoice with 10% TDS on it, then an advance and part of it returned.
  marchInvoice = (await invoice('2027-03-01', '1000', { tdsBp: 1000 })).id as string;
  const adv = await recordAdvance(db.web, owner, { partyId: cust, amount: '500', method: 'bank_transfer', receivedOn: '2027-03-10' });
  await refundCredit(db.web, owner, adv.paymentId, { amount: '200', method: 'bank_transfer', refundedOn: '2027-03-12' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('customer statement', () => {
  it('runs the balance in date order, and every line is the one before it plus its own movement', async () => {
    const s = await customerStatement(db.web, owner, cust, { from: '2027-01-01', to: '2027-12-31' });
    expect(s.rows.map((r) => r.date)).toEqual([...s.rows.map((r) => r.date)].sort());
    let bal = BigInt(s.opening);
    for (const r of s.rows) {
      bal += BigInt(r.debit) - BigInt(r.credit);
      expect(r.balance).toBe(bal.toString());
    }
    expect(s.closing).toBe(bal.toString());
  });

  it('closing is opening plus the movements in the range, whatever the range', async () => {
    for (const range of [{ from: '2027-01-01', to: '2027-12-31' }, { from: '2027-02-01', to: '2027-02-28' }, { from: '2027-03-01', to: '2027-03-31' }, { from: '2027-06-01', to: '2027-06-30' }]) {
      const s = await customerStatement(db.web, owner, cust, range);
      const moved = s.rows.reduce((n, r) => n + BigInt(r.debit) - BigInt(r.credit), 0n);
      expect(BigInt(s.closing)).toBe(BigInt(s.opening) + moved);
    }
  });

  it('the opening balance is everything strictly before the start date', async () => {
    const feb = await customerStatement(db.web, owner, cust, { from: '2027-02-01', to: '2027-02-28' });
    expect(feb.opening).toBe('98000');                                  // January: 1,180 billed less 200 received
    const jan = await customerStatement(db.web, owner, cust, { from: '2027-01-01', to: '2027-01-31' });
    expect(jan.opening).toBe('0');
    expect(jan.closing).toBe(feb.opening);                              // one period's close is the next one's open
    const later = await customerStatement(db.web, owner, cust, { from: '2027-06-01', to: '2027-06-30' });
    expect(later.rows).toEqual([]);
    expect(later.opening).toBe(later.closing);
  });

  it('leaves out drafts and cancelled documents', async () => {
    const s = await customerStatement(db.web, owner, cust, { from: '2027-02-01', to: '2027-02-28' });
    expect(s.rows.map((r) => [r.description.split(' ').slice(0, -1).join(' '), r.debit, r.credit])).toEqual([
      ['Tax invoice', '100000', '0'], ['Credit note', '0', '11800']]);
    expect(s.closing).toBe('186200');                                   // 98,000 + 1,000 reverse charge - 118 credit note
  });

  it('a reverse-charge invoice asks only for the taxable value', async () => {
    const s = await customerStatement(db.web, owner, cust, { from: '2027-02-05', to: '2027-02-05' });
    expect(s.rows).toEqual([expect.objectContaining({ debit: '100000', credit: '0' })]);
    const [d] = await db.owner`select grand_total_paise, cgst_paise from document where doc_date = '2027-02-05' and business_id = ${owner.businessId}`;
    expect([d!.grand_total_paise, d!.cgst_paise]).toEqual(['100000', '9000']);   // the tax is on the document, but not in the total
  });

  it('TDS is not taken off the bill; it is a credit when the deduction is recorded', async () => {
    const [d] = await db.owner`select tds_paise from document where id = ${marchInvoice}`;
    expect(d!.tds_paise).toBe('10000');                                 // 10% of the taxable 1,000
    const before = await customerStatement(db.web, owner, cust, { from: '2027-03-01', to: '2027-03-01' });
    expect(before.rows).toEqual([expect.objectContaining({ debit: '118000', credit: '0' })]);   // the whole total, not 1,180 less the 100 of TDS
    await recordPayment(db.web, owner, { documentId: marchInvoice, amount: '100', method: 'tds', receivedOn: '2027-03-05' });
    const after = await customerStatement(db.web, owner, cust, { from: '2027-03-05', to: '2027-03-05' });
    expect(after.rows).toEqual([expect.objectContaining({ description: 'TDS deducted by the customer', debit: '0', credit: '10000' })]);
    expect(BigInt(after.closing)).toBe(BigInt(before.closing) - 10000n);   // the credit lands now, it was never netted off the bill
  });

  it('money returned to the customer is a debit again', async () => {
    const s = await customerStatement(db.web, owner, cust, { from: '2027-03-10', to: '2027-03-12' });
    expect(s.rows.map((r) => [r.description, r.debit, r.credit])).toEqual([
      ['Payment (bank_transfer)', '0', '50000'], ['Refund (bank transfer)', '20000', '0']]);
  });

  it('is written out as plain text for an email', async () => {
    const s = await customerStatement(db.web, owner, cust, { from: '2027-01-01', to: '2027-01-31' });
    const text = statementText(s);
    expect(text).toContain('Statement for Verma Stores, 2027-01-01 to 2027-01-31');
    expect(text.split('\n')[2]).toMatch(/^Opening balance\s+0\.00$/);
    expect(text.trimEnd().endsWith('980.00')).toBe(true);
  });

  it('refuses a bad range and an unknown customer, and no other business can read it', async () => {
    expect(await fails(customerStatement(db.web, owner, cust, { from: '2027-03-01', to: '2027-01-01' }))).toBeInstanceOf(ValidationError);
    expect(await fails(customerStatement(db.web, owner, '00000000-0000-0000-0000-0000000000aa'))).toBeInstanceOf(ValidationError);
    // The other business asks for this customer by id: row-level security hides the party, so it is simply not there.
    expect((await fails(customerStatement(db.web, other, cust))).message).toBe('Customer not found.');
  });
});

describe('sending a statement', () => {
  it('goes to the address given, then a named contact, then the primary contact, then the customer itself', async () => {
    expect((await fails(queueStatementSend(db.web, owner, { partyId: cust }))).message).toMatch(/no email address/);
    await updateParty(db.web, owner, cust, { kind: 'customer', name: 'Verma Stores', stateCode: '27', email: 'office@verma.test' });
    expect((await queueStatementSend(db.web, owner, { partyId: cust, from: '2027-01-01', to: '2027-03-31' })).email).toBe('office@verma.test');
    await createContactPerson(db.web, owner, cust, { name: 'Meena', email: 'Meena@Verma.test', isPrimary: true });
    const raju = await createContactPerson(db.web, owner, cust, { name: 'Raju', email: 'raju@verma.test' });
    expect((await queueStatementSend(db.web, owner, { partyId: cust })).email).toBe('meena@verma.test');
    expect((await queueStatementSend(db.web, owner, { partyId: cust, contactPersonId: raju })).email).toBe('raju@verma.test');
    expect((await queueStatementSend(db.web, owner, { partyId: cust, email: 'audit@verma.test' })).email).toBe('audit@verma.test');
    expect(await fails(queueStatementSend(db.web, owner, { partyId: cust, email: 'not-an-email' }))).toBeInstanceOf(ValidationError);
    expect(await fails(queueStatementSend(db.web, other, { partyId: cust }))).toBeInstanceOf(ValidationError);
    const queued = await db.owner`select count(*)::int as n from job where queue = 'statement.send' and business_id = ${owner.businessId}`;
    expect(queued[0]!.n).toBe(4);
  });
});
