import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { createBill, createBusiness, createParty, dashboardSummary, issueDocument, resolveTenant, saveDraft, type TenantSession } from '../src/index.js';

let db: TestDb;
let owner: TenantSession;
const day = (n: number) => new Date(Date.now() + 5.5 * 3600e3 + n * 86_400_000).toISOString().slice(0, 10);
const invoice = async (partyId: string, rate: string, dueIn: number) => {
  const { id } = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId, docDate: day(-20), dueDate: day(dueIn), lines: [{ name: 'Work', hsnSac: '998313', quantity: '1', rate, taxRateBp: 0, kind: 'service' }] });
  await issueDocument(db.web, owner, id);
};

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('o@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('dashboard: coming up, top customers, what you owe', () => {
  it('shows money due this week, the biggest customers and what is owed to vendors', async () => {
    const a = await createParty(db.web, owner, { kind: 'customer', name: 'Big Buyer', stateCode: '27' });
    const b = await createParty(db.web, owner, { kind: 'customer', name: 'Small Buyer', stateCode: '27' });
    await invoice(a, '5000', 3);       // due this week
    await invoice(a, '2000', 30);      // later
    await invoice(b, '700', 5);        // due this week
    await invoice(b, '100', -5);       // already late: not "this week"
    const micro = await createParty(db.web, owner, { kind: 'vendor', name: 'Tiny Works', stateCode: '27', udyamNumber: 'UDYAM-MH-12-0001234', msmeClass: 'micro' });
    const plain = await createParty(db.web, owner, { kind: 'vendor', name: 'Big Co', stateCode: '27' });
    await createBill(db.web, owner, { partyId: micro, billNumber: 'T-1', billDate: day(-40), lines: [{ description: 'Goods', quantity: '1', rate: '1000', taxRateBp: 0 }] });   // 45-day limit in 5 days
    await createBill(db.web, owner, { partyId: plain, billNumber: 'P-1', billDate: day(-40), dueDate: day(-3), lines: [{ description: 'Goods', quantity: '1', rate: '400', taxRateBp: 0 }] });   // late
    await createBill(db.web, owner, { partyId: plain, billNumber: 'P-2', billDate: day(-1), dueDate: day(4), lines: [{ description: 'Goods', quantity: '1', rate: '300', taxRateBp: 0 }] });
    const d = await dashboardSummary(db.web, owner);
    expect(d.dueThisWeek).toEqual({ amount: '570000', count: 2 });
    expect(d.topCustomers.map((c) => [c.name, c.total])).toEqual([['Big Buyer', '700000'], ['Small Buyer', '80000']]);
    expect(d.toPay).toMatchObject({ owed: '170000', late: '140000', bills: 3, msmeAttention: 1 });
    expect(d.toPay.dueThisWeek).toBe('30000');   // a bill with no due date counts as due on its bill date, so the micro bill is late here, and flagged by the 45-day rule
  });
});
