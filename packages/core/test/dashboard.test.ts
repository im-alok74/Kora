import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, createBusiness, createParty, dashboardSummary, decideEstimate, issueDocument, recordPayment, resolveTenant, saveDraft, saveExpense, startNote,
  type DocIn, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, accountant: TenantSession, other: TenantSession, empty: TenantSession;
let buyer: string;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const line = (rate: string) => ({ name: 'Service', hsnSac: '998313', quantity: '1', rate, taxRateBp: 1800, kind: 'service' as const });
const issued = async (over: Partial<DocIn>) => {
  const { id } = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: buyer, lines: [line('1000')], ...over });
  await issueDocument(db.web, owner, id);
  return id;
};

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [u, a, o, z] = [await mk('o@e.test'), await mk('a@e.test'), await mk('x@e.test'), await mk('z@e.test')];
  const bid = await createBusiness(db.web, u, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  await addMember(db.web, u, bid, a, 'accountant');
  owner = await resolveTenant(db.web, u, bid); accountant = await resolveTenant(db.web, a, bid);
  other = await resolveTenant(db.web, o, await createBusiness(db.web, o, { legalName: 'Other Co', gstin: null, stateCode: '29', registrationType: 'unregistered' }));
  empty = await resolveTenant(db.web, z, await createBusiness(db.web, z, { legalName: 'Empty Co', gstin: null, stateCode: '27', registrationType: 'unregistered' }));
  buyer = await createParty(db.web, owner, { kind: 'customer', name: 'Asha Stores', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('dashboard', () => {
  it('is all zeros, with a setup picture, for a business with nothing in it', async () => {
    const d = await dashboardSummary(db.web, empty);
    expect(d.owed).toEqual({ outstanding: '0', overdue: '0', unpaid: 0, overdueCount: 0 });
    expect(d.thisMonth).toEqual({ sales: '0', collected: '0', expenses: '0' });
    expect(d.chart).toHaveLength(6);
    expect(d.chart.every((c) => c.total === '0')).toBe(true);
    expect(d.attention).toEqual({ overdue: [], drafts: 0, openEstimates: 0, acceptedEstimates: 0 });
    expect(d.recent).toEqual([]);
    expect(d.setup).toMatchObject({ customers: 0, items: 0, documents: 0, hasAddress: false, hasUpi: false });
    expect(d.business.name).toBe('Empty Co');
  });

  it('adds up what is owed, what is late, this month, and the last six months', async () => {
    const late = await issued({ docDate: addDays(today(), -40), dueDate: addDays(today(), -10) });          // 1,180 overdue
    await issued({ docDate: addDays(today(), -2), dueDate: addDays(today(), 20) });                          // 1,180 not yet due
    const paid = await issued({ lines: [line('2000')] });                                                    // 2,360 this month
    await recordPayment(db.web, owner, { documentId: paid, amount: '2360', method: 'upi' });
    await recordPayment(db.web, owner, { documentId: late, amount: '180', method: 'cash' });
    await recordPayment(db.web, owner, { documentId: late, amount: '100', method: 'tds' });                  // TDS is not money received
    await saveExpense(db.web, owner, { category: 'Rent', amount: '500' });
    await saveExpense(db.web, owner, { category: 'Rent', amount: '9', date: addDays(today(), -100) });        // an old one is not this month's
    await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: buyer, lines: [line('10')] });         // a draft

    const d = await dashboardSummary(db.web, owner);
    expect(d.owed).toMatchObject({ outstanding: String(118000 - 18000 - 10000 + 118000), overdue: String(118000 - 18000 - 10000), unpaid: 2, overdueCount: 1 });
    expect(BigInt(d.thisMonth.collected)).toBe(236000n + 18000n);                                             // not the TDS
    expect(d.thisMonth.expenses).toBe('50000');
    const sales = BigInt(d.thisMonth.sales);
    expect(sales).toBeGreaterThanOrEqual(236000n);                                                            // the two this month, and maybe the third if it is in the same month
    const total = d.chart.reduce((n, c) => n + BigInt(c.total), 0n);
    expect(total).toBe(118000n * 2n + 236000n);                                                               // every issued invoice is somewhere in the six months
    expect(d.chart.at(-1)!.label).toMatch(/^[A-Z][a-z]{2}$/);
    expect(d.attention.overdue).toEqual([{ id: late, number: expect.stringMatching(/^INV\//), party_name: 'Asha Stores', outstanding_paise: '90000', days: 10 }]);
    expect(d.attention.drafts).toBe(1);
    expect(d.recent).toHaveLength(4);
    expect(d.recent[0]).toMatchObject({ status: 'draft', party_name: 'Asha Stores' });
    expect(d.setup).toMatchObject({ customers: 1, documents: 4 });
  });

  it('nets credit notes out of sales, and counts estimates by where they stand', async () => {
    const before = (await dashboardSummary(db.web, owner)).chart.reduce((n, c) => n + BigInt(c.total), 0n);
    const inv = await issued({ lines: [line('1000')] });
    const note = (await startNote(db.web, owner, inv, 'credit_note')).id;
    await issueDocument(db.web, owner, note);
    expect((await dashboardSummary(db.web, owner)).chart.reduce((n, c) => n + BigInt(c.total), 0n)).toBe(before);   // the note cancels the invoice

    const e1 = await issued({ docType: 'estimate', dueDate: addDays(today(), 10) });
    await issued({ docType: 'estimate', dueDate: addDays(today(), -1) });                                     // expired: not open
    await decideEstimate(db.web, owner, e1, 'accepted');
    await issued({ docType: 'estimate', dueDate: addDays(today(), 5) });
    const d = await dashboardSummary(db.web, owner);
    expect(d.attention).toMatchObject({ openEstimates: 1, acceptedEstimates: 1 });
  });

  it('is readable by an accountant and never shows another business', async () => {
    const a = await dashboardSummary(db.web, accountant);
    expect(a.owed.unpaid).toBeGreaterThan(0);
    const o = await dashboardSummary(db.web, other);
    expect(o.setup.documents).toBe(0);
    expect(o.recent).toEqual([]);
    expect(o.owed.outstanding).toBe('0');
  });
});
