import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, addToInbox, bulkDocuments, createBill, createBusiness, createMatter, createParty, globalSearch, issueDocument, notifications, partyOverview, recordPayment, resolveTenant,
  saveDraft, saveExpense, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, staff: TenantSession, ca: TenantSession, other: TenantSession;
let asha: string, vendor: string;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const line = (rate: string) => ({ name: 'Consulting', hsnSac: '998313', quantity: '1', rate, taxRateBp: 1800, kind: 'service' as const });
const issue = async (o: { rate?: string; party?: string; due?: string; date?: string } = {}) => {
  const { id } = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: o.party ?? asha, docDate: o.date, dueDate: o.due, lines: [line(o.rate ?? '1000')] });
  await issueDocument(db.web, owner, id);
  return id;
};

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [o, s, c, x] = [await mk('o@e.test'), await mk('s@e.test'), await mk('c@e.test'), await mk('x@e.test')];
  const bid = await createBusiness(db.web, o, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  await addMember(db.web, o, bid, s, 'staff'); await addMember(db.web, o, bid, c, 'accountant');
  owner = await resolveTenant(db.web, o, bid); staff = await resolveTenant(db.web, s, bid); ca = await resolveTenant(db.web, c, bid);
  other = await resolveTenant(db.web, x, await createBusiness(db.web, x, { legalName: 'Other Co', gstin: null, stateCode: '27', registrationType: 'unregistered' }));
  asha = await createParty(db.web, owner, { kind: 'customer', name: 'Asha Stores', stateCode: '27', phone: '9876500001', email: 'asha@example.test' });
  vendor = await createParty(db.web, owner, { kind: 'vendor', name: 'Paper Mart', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('search', () => {
  it('finds documents, customers, bills, expenses and matters from one box, and nothing for a short or unknown term', async () => {
    const inv = await issue({ rate: '500' });
    await createBill(db.web, owner, { partyId: vendor, billNumber: 'PM-2026-1', billDate: today(), lines: [{ description: 'Paper', quantity: '1', rate: '100', taxRateBp: 1200 }] });
    await saveExpense(db.web, owner, { category: 'Travel', vendor: 'Asha Cabs', amount: '300' });
    await createMatter(db.web, owner, { partyId: asha, title: 'Asha supply dispute', reference: 'CS-5/2026', rate: '1000' });
    const r = await globalSearch(db.web, owner, 'asha');
    const kinds = r.hits.map((h) => h.kind);
    expect(kinds).toEqual(expect.arrayContaining(['document', 'customer', 'expense', 'matter']));
    expect(r.hits.find((h) => h.kind === 'document')).toMatchObject({ id: inv, href: `/app/invoices/${inv}` });
    expect(r.hits.find((h) => h.kind === 'customer')).toMatchObject({ title: 'Asha Stores', href: expect.stringMatching(/^\/app\/customers\//) });
    expect((await globalSearch(db.web, owner, 'pm-2026')).hits[0]).toMatchObject({ kind: 'bill', title: 'Bill PM-2026-1' });
    expect((await globalSearch(db.web, owner, 'a')).hits).toEqual([]);
    expect((await globalSearch(db.web, owner, 'zzzz-nothing')).hits).toEqual([]);
    expect((await globalSearch(db.web, owner, '100%')).hits).toEqual([]);            // a percent sign is text, not a wildcard
  });
  it('only searches what the role may read, and never across businesses', async () => {
    expect((await globalSearch(db.web, other, 'asha')).hits).toEqual([]);
    const forCa = (await globalSearch(db.web, ca, 'asha')).hits.map((h) => h.kind);
    expect(forCa).toContain('customer');
    expect((await globalSearch(db.web, staff, 'asha')).hits.length).toBeGreaterThan(0);
  });
});

describe('what needs attention', () => {
  it('is empty for a business with nothing going on', async () => {
    const r = await notifications(db.web, other);
    expect(r.notices).toEqual([]);
  });
  it('lists overdue invoices, old drafts, due vendor bills and inbox papers, worst first, each with a place to go', async () => {
    await issue({ rate: '2000', date: addDays(today(), -40), due: addDays(today(), -10) });
    const draft = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: asha, lines: [line('10')] });
    await db.owner`update document set created_at = now() - interval '5 days' where id = ${draft.id}`;
    await createBill(db.web, owner, { partyId: vendor, billNumber: 'PM-DUE', billDate: addDays(today(), -20), dueDate: addDays(today(), 2), lines: [{ description: 'Paper', quantity: '1', rate: '500', taxRateBp: 1200 }] });
    await addToInbox(db.web, staff, { title: 'Rent bill', name: 'r.pdf', type: 'application/pdf', dataBase64: Buffer.from('%PDF-1.4 x').toString('base64') });
    const { notices } = await notifications(db.web, owner);
    const ids = notices.map((n) => n.id.split(':')[0]);
    expect(ids).toEqual(expect.arrayContaining(['overdue', 'drafts', 'payables', 'inbox']));
    expect(notices[0]!.severity).toBe('critical');
    expect(notices.find((n) => n.id.startsWith('overdue'))).toMatchObject({ title: '1 overdue invoice', href: '/app/reports' });
    expect(notices.find((n) => n.id.startsWith('payables'))!.title).toMatch(/2 vendor bills are due within a week/);
    const rank = { critical: 0, warning: 1, info: 2 };
    expect(notices.map((n) => rank[n.severity])).toEqual([...notices.map((n) => rank[n.severity])].sort());
  });
  it('shows each person only what their role may see', async () => {
    const forStaff = (await notifications(db.web, staff)).notices.map((n) => n.id.split(':')[0]);
    expect(forStaff).toContain('overdue');              // staff can read reports
    expect(forStaff).not.toContain('inbox');            // staff send to the inbox, they do not review it
    const forCa = (await notifications(db.web, ca)).notices.map((n) => n.id.split(':')[0]);
    expect(forCa).toEqual(expect.arrayContaining(['overdue', 'inbox', 'payables']));
  });
  it('puts a hearing today at the top for the lawyer', async () => {
    const m = (await createMatter(db.web, owner, { partyId: asha, title: 'Hearing matter', rate: '1000' })).id;
    const { addEvent } = await import('../src/index.js');
    await addEvent(db.web, owner, m, { date: today(), title: 'Final arguments' });
    const n = (await notifications(db.web, owner)).notices.find((x) => x.id.startsWith('event:'))!;
    expect(n).toMatchObject({ severity: 'critical', title: 'Hearing today: Final arguments', href: `/app/matters/${m}` });
  });
});

describe('one customer in full', () => {
  it('adds up billing, payments and lateness, and the averages are honest', async () => {
    const o = (await partyOverview(db.web, ca, asha))!;
    expect(o.party).toMatchObject({ name: 'Asha Stores', phone: '9876500001', kind: 'customer' });
    expect(BigInt(o.summary.billedPaise)).toBe(59000n + 236000n);              // Rs 500 and Rs 2,000, each with 18% GST
    expect(o.summary.invoices).toBe(2);
    expect(o.summary.openInvoices).toBe(2);
    expect(o.summary.maxDaysLate).toBe(10);
    expect(BigInt(o.summary.overduePaise)).toBe(236000n);
    expect(o.summary.averageDaysToPay).toBeNull();
    expect(o.documents.length).toBeGreaterThanOrEqual(3);
    const id = (await db.owner`select id from document where number is not null and grand_total_paise = 236000`)[0]!.id as string;
    await recordPayment(db.web, owner, { documentId: id, amount: '1000', method: 'upi', receivedOn: today() });
    const after = (await partyOverview(db.web, owner, asha))!;
    expect(BigInt(after.summary.receivedPaise)).toBe(100000n);
    expect(BigInt(after.summary.outstandingPaise)).toBe(295000n - 100000n);
    expect(after.summary.averageDaysToPay).toBe(40);
    expect(after.payments[0]).toMatchObject({ method: 'upi', amount_paise: '100000' });
  });
  it('is not visible from another business, and unknown ids are null', async () => {
    expect(await partyOverview(db.web, other, asha)).toBeNull();
    expect(await partyOverview(db.web, owner, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('bulk actions', () => {
  it('issues several drafts and reports each one, so one failure does not stop the rest', async () => {
    const mk = async (rate: string) => (await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: asha, lines: [line(rate)] })).id;
    const [a, b] = [await mk('11'), await mk('12')];
    const issued = await issue({ rate: '13' });
    const r = await bulkDocuments(db.web, owner, { action: 'issue', ids: [a, issued, b] });
    expect(r).toMatchObject({ done: 2, failed: 1 });
    expect(r.results.find((x) => x.id === issued)).toMatchObject({ ok: false });
    expect(r.results.filter((x) => x.ok).map((x) => x.id).sort()).toEqual([a, b].sort());
    expect((await db.owner`select status from document where id = ${a}`)[0]!.status).toBe('issued');
  });
  it('deletes drafts, refuses to delete issued documents, and cancels with one reason', async () => {
    const d = (await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: asha, lines: [line('21')] })).id;
    const i = await issue({ rate: '22' });
    const del = await bulkDocuments(db.web, owner, { action: 'delete', ids: [d, i] });
    expect(del).toMatchObject({ done: 1, failed: 1 });
    expect(await db.owner`select 1 from document where id = ${d}`).toHaveLength(0);
    await expect(bulkDocuments(db.web, owner, { action: 'cancel', ids: [i] })).rejects.toThrow(/reason/);
    expect((await bulkDocuments(db.web, owner, { action: 'cancel', ids: [i], reason: 'Duplicate' })).done).toBe(1);
    expect((await db.owner`select status, cancel_reason from document where id = ${i}`)[0]).toMatchObject({ status: 'cancelled', cancel_reason: 'Duplicate' });
  });
  it('sends reminders to the customer\'s number, and says when there is no number', async () => {
    const withPhone = await issue({ rate: '31' });
    const noPhone = await createParty(db.web, owner, { kind: 'customer', name: 'No Contact', stateCode: '27' });
    const without = await issue({ rate: '32', party: noPhone });
    const r = await bulkDocuments(db.web, owner, { action: 'remind', ids: [withPhone, without], channel: 'whatsapp' });
    expect(r).toMatchObject({ done: 1, failed: 1 });
    expect(r.results.find((x) => x.id === without)!.error).toMatch(/no mobile number/);
    expect((await db.owner`select count(*)::int as n from reminder where document_id = ${withPhone}`)[0]!.n).toBeGreaterThan(0);
  });
  it('limits the batch, validates the action, and respects roles', async () => {
    await expect(bulkDocuments(db.web, owner, { action: 'issue', ids: [] })).rejects.toThrow(/at least one/);
    await expect(bulkDocuments(db.web, owner, { action: 'issue', ids: Array.from({ length: 51 }, (_, k) => `00000000-0000-0000-0000-${String(k).padStart(12, '0')}`) })).rejects.toThrow(/50 documents or fewer/);
    await expect(bulkDocuments(db.web, owner, { action: 'explode' as never, ids: ['x'] })).rejects.toThrow(/Choose what to do/);
    const d = (await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: asha, lines: [line('41')] })).id;
    const r = await bulkDocuments(db.web, ca, { action: 'issue', ids: [d] });
    expect(r).toMatchObject({ done: 0, failed: 1 });
    expect(r.results[0]!.error).toMatch(/cannot do this/);
    const o = await bulkDocuments(db.web, other, { action: 'issue', ids: [d] });
    expect(o.failed).toBe(1);
  });
});
