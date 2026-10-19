import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addEvent, addExpense, addFee, addFunds, getMatterAccess, listEvents, payInvoiceFromHeld, removeEvent, setEventDone, setMatterAccess, upcomingEvents, voidPayment, addMember, addTime, billMatter, createBusiness, createMatter, createParty, formatDuration, getDocument, getMatter, issueDocument,
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
    await addFunds(db.web, owner, m, { kind: 'refund', amount: '2500.50' });
    expect((await getMatter(db.web, owner, m))!.heldPaise).toBe('749950');
    await expect(addFunds(db.web, owner, m, { kind: 'refund', amount: '7500' })).rejects.toThrow(/Only Rs 7499.50 is held/);
    await addFunds(db.web, owner, m, { kind: 'refund', amount: '7499.50' });
    expect((await getMatter(db.web, owner, m))!.heldPaise).toBe('0');
    await expect(addFunds(db.web, owner, m, { kind: 'refund', amount: '0.01' })).rejects.toThrow(/Only Rs 0.00 is held/);
    await expect(addFunds(db.web, owner, m, { kind: 'applied' as never, amount: '1' })).rejects.toThrow(/Pay an invoice/);
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

describe('fixed fees', () => {
  it('bills a lump sum with no hours, taxed like the rest', async () => {
    const m = (await createMatter(db.web, owner, { partyId: client, title: 'Retainer client' })).id;
    await expect(addFee(db.web, owner, m, { description: 'x', amount: '0' })).rejects.toThrow(/more than zero/);
    await addFee(db.web, staff, m, { description: 'Retainer for October 2026', amount: '25000', date: '2026-10-01' });
    const d = await getMatter(db.web, owner, m);
    expect(d!.entries[0]).toMatchObject({ kind: 'fee', minutes: null, rate_paise: null, amount_paise: '2500000' });
    const doc = await getDocument(db.web, owner, (await billMatter(db.web, owner, m)).id);
    expect(doc!.document.taxable_paise).toBe('2500000');
    expect(doc!.document.grand_total_paise).toBe('2950000');
  });
});

describe('paying an invoice from money held', () => {
  let m: string, inv: string;
  it('moves money from the ledger onto the invoice as one payment', async () => {
    m = (await createMatter(db.web, owner, { partyId: client, title: 'Advance matter', rate: '1000' })).id;
    await addTime(db.web, owner, m, { duration: '1', description: 'Advice' });          // Rs 1,000 + 18% = Rs 1,180
    inv = (await billMatter(db.web, owner, m)).id;
    await issueDocument(db.web, owner, inv);
    await addFunds(db.web, owner, m, { kind: 'deposit', amount: '5000' });
    expect(await payInvoiceFromHeld(db.web, owner, m, { documentId: inv, amount: '500' })).toEqual({ paidPaise: '50000' });
    const doc = await getDocument(db.web, owner, inv);
    expect(doc!.document.amount_settled_paise).toBe('50000');
    expect((await getMatter(db.web, owner, m))!.heldPaise).toBe('450000');
    const [p] = await db.owner`select method, note from payment where id in (select payment_id from payment_allocation where document_id = ${inv})`;
    expect(p).toMatchObject({ method: 'client_money', note: 'Paid from money held for Advance matter' });
    const [k] = await db.owner`select kind, document_id from client_fund_entry where matter_id = ${m} and kind = 'applied'`;
    expect(k).toMatchObject({ document_id: inv });
  });
  it('pays what is due when no amount is given, and cannot be removed afterwards', async () => {
    expect(await payInvoiceFromHeld(db.web, owner, m, { documentId: inv })).toEqual({ paidPaise: '68000' });
    expect((await getMatter(db.web, owner, m))!.heldPaise).toBe('382000');
    const [p] = await db.owner`select id from payment where method = 'client_money' limit 1`;
    await expect(voidPayment(db.web, owner, p!.id as string)).rejects.toThrow(/client money ledger/);
    await expect(payInvoiceFromHeld(db.web, owner, m, { documentId: inv })).rejects.toThrow(/already paid/);
  });
  it('refuses more than is held, more than is due, another client invoice, a draft, and the accountant', async () => {
    const m2 = (await createMatter(db.web, owner, { partyId: client, title: 'Small advance', rate: '1000' })).id;
    await addTime(db.web, owner, m2, { duration: '1', description: 'Advice' });
    const inv2 = (await billMatter(db.web, owner, m2)).id;
    await expect(payInvoiceFromHeld(db.web, owner, m2, { documentId: inv2 })).rejects.toThrow(/Choose an issued invoice/);
    await issueDocument(db.web, owner, inv2);
    await expect(payInvoiceFromHeld(db.web, owner, m2, { documentId: inv2 })).rejects.toThrow(/no money held/);
    await addFunds(db.web, owner, m2, { kind: 'deposit', amount: '100' });
    await expect(payInvoiceFromHeld(db.web, owner, m2, { documentId: inv2, amount: '150' })).rejects.toThrow(/Only Rs 100.00 is held/);
    await addFunds(db.web, owner, m2, { kind: 'deposit', amount: '5000' });
    await expect(payInvoiceFromHeld(db.web, owner, m2, { documentId: inv2, amount: '2000' })).rejects.toThrow(/only Rs 1180.00 still due/);
    await expect(payInvoiceFromHeld(db.web, ca, m2, { documentId: inv2 })).rejects.toThrow(/cannot do this/);
    const other2 = await createParty(db.web, owner, { kind: 'customer', name: 'Someone Else', stateCode: '27' });
    const m3 = (await createMatter(db.web, owner, { partyId: other2, title: 'Other client', rate: '1000' })).id;
    await addFunds(db.web, owner, m3, { kind: 'deposit', amount: '5000' });
    await expect(payInvoiceFromHeld(db.web, owner, m3, { documentId: inv2 })).rejects.toThrow(/different client/);
  });
});

describe('hearings and deadlines', () => {
  const add = (m: string, date: string, title: string, kind = 'hearing') => addEvent(db.web, staff, m, { date, title, kind });
  const day = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10); };
  it('lists what is overdue and coming, soonest first, and drops done and distant ones', async () => {
    const m = (await createMatter(db.web, owner, { partyId: client, title: 'Calendar matter', rate: '1000' })).id;
    const late = await add(m, day(-3), 'File reply');
    await add(m, day(5), 'Hearing before Justice Rao');
    await add(m, day(2), 'Serve notice', 'deadline');
    await add(m, day(90), 'Far away');
    const done = await add(m, day(1), 'Already done');
    await setEventDone(db.web, staff, done.id, true);
    const u = await upcomingEvents(db.web, ca, 30);
    const mine = u.events.filter((e) => e.matter_id === m);
    expect(mine.map((e) => e.title)).toEqual(['File reply', 'Serve notice', 'Hearing before Justice Rao']);
    expect(mine.map((e) => e.days_left)).toEqual([-3, 2, 5]);
    expect(mine[0]).toMatchObject({ matter_title: 'Calendar matter', kind: 'hearing' });
    await removeEvent(db.web, staff, late.id);
    expect((await listEvents(db.web, ca, m)).map((e) => e.title)).not.toContain('File reply');
  });
  it('validates, keeps roles apart, and hides other businesses', async () => {
    const m = (await createMatter(db.web, owner, { partyId: client, title: 'Calendar two', rate: '1000' })).id;
    await expect(add(m, '2026-13-45', 'x')).rejects.toThrow(/YYYY-MM-DD/);
    await expect(add(m, '2026-11-01', 'x', 'party')).rejects.toThrow(/hearing, deadline or other/);
    await expect(addEvent(db.web, ca, m, { date: '2026-11-01', title: 'x' })).rejects.toThrow(/cannot do this/);
    await expect(addEvent(db.web, other, m, { date: '2026-11-01', title: 'x' })).rejects.toThrow(/not found/);
    expect((await upcomingEvents(db.web, other)).events).toEqual([]);
  });
});

describe('private matters', () => {
  it('are seen by owners and listed people only, down to entries, money and dates', async () => {
    const m = (await createMatter(db.web, owner, { partyId: client, title: 'Sensitive matter', rate: '1000' })).id;
    await addTime(db.web, owner, m, { duration: '1', description: 'Secret work' });
    await addFunds(db.web, owner, m, { kind: 'deposit', amount: '100' });
    await addEvent(db.web, owner, m, { date: '2026-11-01', title: 'Secret hearing' });
    const people = await getMatterAccess(db.web, owner, m);
    expect(people!.restricted).toBe(false);
    const staffId = people!.people.find((p) => p.role === 'staff')!.user_id as string;
    expect((await getMatter(db.web, staff, m))?.matter.title).toBe('Sensitive matter');

    await setMatterAccess(db.web, owner, m, { restricted: true, userIds: [] });
    expect(await getMatter(db.web, staff, m)).toBeNull();
    expect(await getMatter(db.web, ca, m)).toBeNull();
    expect((await listMatters(db.web, staff)).some((x) => x.id === m)).toBe(false);
    expect((await upcomingEvents(db.web, staff, 365)).events.some((e) => e.matter_id === m)).toBe(false);
    await expect(addTime(db.web, staff, m, { duration: '1', description: 'x' })).rejects.toThrow(/not found/);
    expect((await getMatter(db.web, owner, m))?.entries).toHaveLength(1);       // owners always see it

    await setMatterAccess(db.web, owner, m, { restricted: true, userIds: [staffId] });
    expect((await getMatter(db.web, staff, m))?.entries).toHaveLength(1);
    expect(await getMatter(db.web, ca, m)).toBeNull();
    await addTime(db.web, staff, m, { duration: '1', description: 'Listed person can work' });

    await setMatterAccess(db.web, owner, m, { restricted: false });
    expect((await getMatter(db.web, ca, m))?.entries).toHaveLength(2);
  });
  it('can only be changed by an owner, only for people in the business', async () => {
    const m = (await listMatters(db.web, owner))[0]!.id as string;
    await expect(setMatterAccess(db.web, staff, m, { restricted: true })).rejects.toThrow(/cannot do this/);
    await expect(getMatterAccess(db.web, ca, m)).rejects.toThrow(/cannot do this/);
    await expect(setMatterAccess(db.web, owner, m, { restricted: true, userIds: ['00000000-0000-0000-0000-000000000099'] })).rejects.toThrow(/belong to this business/);
  });
});
