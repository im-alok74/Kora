import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addExpense, addFunds, addMember, addTime, billMatter, createBusiness, createMatter, createParty, formatDuration, getDocument, getMatter, issueDocument,
  listMatters, parseDuration, removeEntry, resolveTenant, setEntryBillable, timeAmount, updateMatter, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, staff: TenantSession, ca: TenantSession, other: TenantSession;
let client: string, matter: string;

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [o, s, c, x] = [await mk('o@e.test'), await mk('s@e.test'), await mk('c@e.test'), await mk('x@e.test')];
  const bid = await createBusiness(db.web, o, { legalName: 'Rao and Associates', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  await addMember(db.web, o, bid, s, 'staff'); await addMember(db.web, o, bid, c, 'accountant');
  owner = await resolveTenant(db.web, o, bid); staff = await resolveTenant(db.web, s, bid); ca = await resolveTenant(db.web, c, bid);
  other = await resolveTenant(db.web, x, await createBusiness(db.web, x, { legalName: 'Other Chambers', gstin: null, stateCode: '27', registrationType: 'unregistered' }));
  client = await createParty(db.web, owner, { kind: 'customer', name: 'Mehta Exports', stateCode: '27' });
  matter = (await createMatter(db.web, owner, { partyId: client, title: 'Recovery suit against Delta Ltd', reference: 'CS-102/2026', rate: '3000' })).id;
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('time arithmetic', () => {
  it('reads the usual ways of writing a duration', () => {
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('1h 30m')).toBe(90);
    expect(parseDuration('90m')).toBe(90);
    expect(parseDuration('45 min')).toBe(45);
    expect(parseDuration('1.5')).toBe(90);
    expect(parseDuration('2h')).toBe(120);
    expect(parseDuration('0.25')).toBe(15);
  });
  it('refuses nonsense, zero and more than a day', () => {
    for (const bad of ['', 'abc', '0', '0:00', '25', '1:75', '-1', '1,5']) expect(() => parseDuration(bad), bad).toThrow(/Enter the time/);
  });
  it('charges whole paise, rounding half up, and formats minutes', () => {
    expect(timeAmount(90, 300000n)).toBe(450000n);       // 1h30 at Rs 3,000
    expect(timeAmount(7, 350000n)).toBe(40833n);         // 7 minutes at Rs 3,500 = Rs 408.333..
    expect(timeAmount(1, 3000n)).toBe(50n);              // Rs 30 an hour, one minute = 50 paise
    expect(timeAmount(1, 30n)).toBe(1n);                 // half a paisa rounds up
    expect(formatDuration(95)).toBe('1h 35m');
  });
});

describe('matters', () => {
  it('needs a customer, and keeps references unique per business', async () => {
    await expect(createMatter(db.web, owner, { partyId: '00000000-0000-0000-0000-000000000000', title: 'x' })).rejects.toThrow(/Choose a client/);
    await expect(createMatter(db.web, owner, { partyId: client, title: 'Another', reference: 'cs-102/2026' })).rejects.toThrow(/already uses that reference/);
    await expect(createMatter(db.web, owner, { partyId: client, title: '' })).rejects.toThrow(/Title/);
    await expect(createMatter(db.web, owner, { partyId: client, title: 'x', sac: '12' })).rejects.toThrow(/SAC/);
  });
  it('lists only this business\'s matters, with unbilled time and money held', async () => {
    await addTime(db.web, staff, matter, { duration: '1:30', description: 'Drafting plaint' });
    const [m] = await listMatters(db.web, ca);
    expect(m).toMatchObject({ title: 'Recovery suit against Delta Ltd', party_name: 'Mehta Exports', unbilled_paise: '450000', unbilled_minutes: 90, held_paise: '0' });
    expect(await listMatters(db.web, other)).toEqual([]);
    expect(await getMatter(db.web, other, matter)).toBeNull();
    expect(await listMatters(db.web, owner, { q: 'delta' })).toHaveLength(1);
    expect(await listMatters(db.web, owner, { q: 'nothing like this' })).toHaveLength(0);
  });
  it('keeps roles apart: the accountant reads but cannot add time', async () => {
    await expect(addTime(db.web, ca, matter, { duration: '1', description: 'x' })).rejects.toThrow(/cannot do this/);
    await expect(createMatter(db.web, ca, { partyId: client, title: 'x' })).rejects.toThrow(/cannot do this/);
    expect((await getMatter(db.web, ca, matter))?.matter.title).toBe('Recovery suit against Delta Ltd');
  });
});

describe('time and expenses', () => {
  it('uses the matter rate unless one is given, and refuses a matter with no rate', async () => {
    const e = await addTime(db.web, owner, matter, { duration: '30m', description: 'Call with client', rate: '4000' });
    expect(e.amountPaise).toBe('200000');
    const free = (await createMatter(db.web, owner, { partyId: client, title: 'No rate yet' })).id;
    await expect(addTime(db.web, owner, free, { duration: '1', description: 'x' })).rejects.toThrow(/Set an hourly rate/);
    await expect(addExpense(db.web, owner, matter, { description: 'x', amount: '0' })).rejects.toThrow(/more than zero/);
    await removeEntry(db.web, owner, e.id);
  });
  it('does not change an old entry when the matter rate changes', async () => {
    await updateMatter(db.web, owner, matter, { rate: '5000' });
    const d = await getMatter(db.web, owner, matter);
    expect(d!.entries.find((x) => x.description === 'Drafting plaint')).toMatchObject({ rate_paise: '300000', amount_paise: '450000' });
    await updateMatter(db.web, owner, matter, { rate: '3000' });
  });
  it('refuses new entries on a closed matter', async () => {
    const m2 = (await createMatter(db.web, owner, { partyId: client, title: 'Closed one', rate: '1000' })).id;
    await updateMatter(db.web, owner, m2, { status: 'closed' });
    await expect(addTime(db.web, owner, m2, { duration: '1', description: 'x' })).rejects.toThrow(/closed/);
    await expect(addExpense(db.web, owner, m2, { description: 'x', amount: '10' })).rejects.toThrow(/closed/);
  });
});

describe('billing a matter', () => {
  let invoice: string;
  it('makes one draft invoice with a narrative line per entry, and skips what is not billable', async () => {
    await addTime(db.web, owner, matter, { duration: '2h', description: 'Hearing at the commercial court', date: '2026-09-20' });
    await addExpense(db.web, owner, matter, { description: 'Court fee', amount: '1500', pureAgent: true, date: '2026-09-21' });
    await addExpense(db.web, owner, matter, { description: 'Courier of notice', amount: '200', date: '2026-09-22' });
    const free = await addTime(db.web, owner, matter, { duration: '1', description: 'Goodwill call, not charged' });
    await setEntryBillable(db.web, owner, free.id, false);

    const r = await billMatter(db.web, staff, matter);
    expect(r.lines).toBe(4);
    invoice = r.id;
    const doc = await getDocument(db.web, owner, invoice);
    expect(doc!.document).toMatchObject({ status: 'draft', doc_type: 'tax_invoice', notes: 'Matter: CS-102/2026: Recovery suit against Delta Ltd' });
    const names = doc!.lines.map((l) => l.item_name as string);
    expect(names.some((n: string) => n.includes('Drafting plaint (1h 30m at Rs 3000.00 an hour)'))).toBe(true);
    expect(names.some((n: string) => n.includes('Court fee (paid on your behalf, at cost)'))).toBe(true);
    // 4,500 + 6,000 + 1,500 (at cost, no GST) + 200 = Rs 12,200 before tax; GST 18% on 10,700 = 1,926
    expect(doc!.document.taxable_paise).toBe('1220000');
    expect(doc!.document.grand_total_paise).toBe('1412600');
  });
  it('marks entries as billed, locks them, and will not bill them twice', async () => {
    const d = await getMatter(db.web, owner, matter);
    const billed = d!.entries.filter((e) => e.invoiced_document_id === invoice);
    expect(billed).toHaveLength(4);
    expect(d!.unbilled).toMatchObject({ count: 0, amountPaise: '0' });
    await expect(removeEntry(db.web, owner, billed[0]!.id)).rejects.toThrow(/on an invoice/);
    await expect(setEntryBillable(db.web, owner, billed[0]!.id, false)).rejects.toThrow(/on an invoice/);
    await expect(billMatter(db.web, owner, matter)).rejects.toThrow(/nothing unbilled/);
  });
  it('bills only what happened up to a date, and bills at once only once', async () => {
    const m3 = (await createMatter(db.web, owner, { partyId: client, title: 'Split billing', rate: '1200' })).id;
    await addTime(db.web, owner, m3, { duration: '1', description: 'Early', date: '2026-08-01' });
    await addTime(db.web, owner, m3, { duration: '1', description: 'Late', date: '2026-10-01' });
    const first = await billMatter(db.web, owner, m3, { upTo: '2026-08-31' });
    expect(first.lines).toBe(1);
    const [a, b] = await Promise.allSettled([billMatter(db.web, owner, m3), billMatter(db.web, owner, m3)]);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
  });
  it('frees the entries when the draft is deleted, and locks them once it is issued', async () => {
    const m4 = (await createMatter(db.web, owner, { partyId: client, title: 'Draft deleted', rate: '1200' })).id;
    await addTime(db.web, owner, m4, { duration: '1', description: 'Work' });
    const { id } = await billMatter(db.web, owner, m4);
    await db.owner`delete from document where id = ${id}`;
    expect((await getMatter(db.web, owner, m4))!.unbilled.count).toBe(1);
    const again = await billMatter(db.web, owner, m4);
    await issueDocument(db.web, owner, again.id);
    const e = (await getMatter(db.web, owner, m4))!.entries[0]!;
    expect(e.invoice_status).toBe('issued');
    await expect(removeEntry(db.web, owner, e.id)).rejects.toThrow(/on an invoice/);
  });
  it('carries reverse charge and TDS from the matter onto the invoice', async () => {
    const m5 = (await createMatter(db.web, owner, { partyId: client, title: 'RCM matter', rate: '1000', reverseCharge: true, tdsBp: 1000 })).id;
    await addTime(db.web, owner, m5, { duration: '1', description: 'Advice' });
    const doc = await getDocument(db.web, owner, (await billMatter(db.web, owner, m5)).id);
    expect(doc!.document).toMatchObject({ reverse_charge: true, tds_bp: 1000 });
  });
});

describe('client money', () => {
  it('keeps a running balance and refuses to pay out more than is held', async () => {
    const m = (await createMatter(db.web, owner, { partyId: client, title: 'Advance held', rate: '1000' })).id;
    await addFunds(db.web, owner, m, { kind: 'deposit', amount: '10000', note: 'Advance cheque 4412' });
    await addFunds(db.web, owner, m, { kind: 'applied', amount: '2500.50' });
    expect((await getMatter(db.web, owner, m))!.heldPaise).toBe('749950');
    await expect(addFunds(db.web, owner, m, { kind: 'refund', amount: '7500' })).rejects.toThrow(/Only Rs 7499.50 is held/);
    await addFunds(db.web, owner, m, { kind: 'refund', amount: '7499.50' });
    expect((await getMatter(db.web, owner, m))!.heldPaise).toBe('0');
    await expect(addFunds(db.web, owner, m, { kind: 'applied', amount: '0.01' })).rejects.toThrow(/Only Rs 0.00 is held/);
  });
  it('cannot be edited or deleted, even directly in the database by the app role', async () => {
    const m = (await createMatter(db.web, owner, { partyId: client, title: 'Ledger', rate: '1000' })).id;
    const { id } = await addFunds(db.web, owner, m, { kind: 'deposit', amount: '100' });
    await expect(db.web`update client_fund_entry set amount_paise = 1 where id = ${id}`).rejects.toThrow();
    await expect(db.web`delete from client_fund_entry where id = ${id}`).rejects.toThrow();
  });
  it('lets two refunds race without going below zero', async () => {
    const m = (await createMatter(db.web, owner, { partyId: client, title: 'Race', rate: '1000' })).id;
    await addFunds(db.web, owner, m, { kind: 'deposit', amount: '1000' });
    const r = await Promise.allSettled([addFunds(db.web, owner, m, { kind: 'refund', amount: '700' }), addFunds(db.web, owner, m, { kind: 'refund', amount: '700' })]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((await getMatter(db.web, owner, m))!.heldPaise).toBe('30000');
  });
  it('is hidden from other businesses', async () => {
    const m = (await listMatters(db.web, owner))[0]!;
    await expect(addFunds(db.web, other, m.id as string, { kind: 'deposit', amount: '1' })).rejects.toThrow(/not found/);
  });
});
