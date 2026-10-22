import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { createBusiness, createParty, getDocument, invoiceBillableExpenses, listBillable, listExpenseCategories, resolveTenant, saveExpense, saveMileage, setBillable, type TenantSession } from '../src/index.js';

let db: TestDb;
let owner: TenantSession;
let cust: string, vendor: string;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('o@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  cust = await createParty(db.web, owner, { kind: 'customer', name: 'Asha Stores', stateCode: '27' });
  vendor = await createParty(db.web, owner, { kind: 'vendor', name: 'Taxi Co', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('categories', () => {
  it('offers the suggestions and anything the business used itself, most used first', async () => {
    await saveExpense(db.web, owner, { category: 'Client gifts', amount: '500' });
    await saveExpense(db.web, owner, { category: 'Client gifts', amount: '300' });
    const c = await listExpenseCategories(db.web, owner);
    expect(c[0]).toBe('Client gifts');
    expect(c).toContain('Rent');
  });
});

describe('mileage', () => {
  it('works out the amount from kilometres and rate, and keeps the route in the notes', async () => {
    const m = await saveMileage(db.web, owner, { date: '2026-10-10', from: 'Pune', to: 'Mumbai', km: '148.5', ratePerKm: '12' });
    expect(m.amountPaise).toBe('178200');
    const [e] = await db.owner`select category, amount_paise::text as a, distance_tenth_km, rate_per_km_paise, notes from expense where id = ${m.id}`;
    expect(e).toMatchObject({ category: 'Mileage', a: '178200', distance_tenth_km: 1485, rate_per_km_paise: 1200 });
    expect(e!.notes).toContain('Pune to Mumbai');
    expect(e!.notes).toContain('148.5 km at Rs 12.00 per km');
  });
  it('refuses nonsense', async () => {
    expect((await fails(saveMileage(db.web, owner, { km: '0', ratePerKm: '10' }))).message).toMatch(/distance/);
    expect((await fails(saveMileage(db.web, owner, { km: '10', ratePerKm: 'abc' }))).message).toMatch(/rate per kilometre/);
  });
});

describe('billable expenses', () => {
  it('marks, lists and turns them into a draft invoice, once', async () => {
    const a = await saveExpense(db.web, owner, { category: 'Courier', vendor: 'Speedy', amount: '236', date: '2026-10-05' });
    const b = await saveExpense(db.web, owner, { category: 'Travel', amount: '1000', date: '2026-10-06' });
    await setBillable(db.web, owner, a.id, cust); await setBillable(db.web, owner, b.id, cust);
    expect((await fails(setBillable(db.web, owner, a.id, vendor))).message).toMatch(/Choose a customer/);
    expect((await listBillable(db.web, owner, cust)).map((r) => r.amount_paise)).toEqual(['23600', '100000']);
    const r = await invoiceBillableExpenses(db.web, owner, { partyId: cust, expenseIds: [a.id, b.id] });
    expect(r.count).toBe(2);
    const d = (await getDocument(db.web, owner, r.documentId))!;
    expect(d.document).toMatchObject({ status: 'draft', grand_total_paise: '123600' });
    expect(d.lines.map((l: any) => l.item_name)).toEqual(['Reimbursement: Speedy, Courier (2026-10-05)', 'Reimbursement: Travel (2026-10-06)']);
    expect(await listBillable(db.web, owner, cust)).toEqual([]);
    expect((await fails(invoiceBillableExpenses(db.web, owner, { partyId: cust, expenseIds: [a.id] }))).message).toMatch(/not billable|already on an invoice/);
    expect((await fails(setBillable(db.web, owner, a.id, null))).message).toMatch(/already on an invoice/);
  });
  it('deleting the draft makes the expense billable again', async () => {
    const x = await saveExpense(db.web, owner, { category: 'Courier', amount: '100' });
    await setBillable(db.web, owner, x.id, cust);
    const r = await invoiceBillableExpenses(db.web, owner, { partyId: cust, expenseIds: [x.id], taxRateBp: 1800 });
    await db.owner`delete from document_line where document_id = ${r.documentId}`;
    await db.owner`delete from document where id = ${r.documentId}`;
    expect((await listBillable(db.web, owner, cust)).map((e) => e.id)).toEqual([x.id]);
  });
  it('refuses another customer\'s expense and an empty choice', async () => {
    const other = await createParty(db.web, owner, { kind: 'customer', name: 'Other Co', stateCode: '27' });
    const y = await saveExpense(db.web, owner, { category: 'Courier', amount: '100' });
    await setBillable(db.web, owner, y.id, cust);
    expect((await fails(invoiceBillableExpenses(db.web, owner, { partyId: other, expenseIds: [y.id] }))).message).toMatch(/not billable/);
    expect((await fails(invoiceBillableExpenses(db.web, owner, { partyId: cust, expenseIds: [] }))).message).toMatch(/at least one/);
  });
});
