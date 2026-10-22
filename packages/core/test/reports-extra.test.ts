import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  createBill, createBusiness, createParty, issueDocument, ITEM_COLUMNS, payablesRows, profitAndLoss, readXlsx, recordPayment, reportToXlsx, resolveTenant, saveDraft, saveExpense,
  salesByItem, salesByMonth, payBill, type DocIn, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession;
let cust: string, vendor: string;
const doc = async (over: Partial<DocIn> & { lines: DocIn['lines'] }) => {
  const { id } = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: cust, ...over });
  await issueDocument(db.web, owner, id);
  return id;
};
const line = (name: string, rate: string, qty = '1', bp = 1800) => ({ name, hsnSac: '998313', quantity: qty, rate, taxRateBp: bp, kind: 'service' as const });
const R = { from: '2026-09-01', to: '2026-11-30' };

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('o@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  cust = await createParty(db.web, owner, { kind: 'customer', name: 'Asha Stores', stateCode: '27' });
  vendor = await createParty(db.web, owner, { kind: 'vendor', name: 'Steel Co', stateCode: '27' });
  await doc({ docDate: '2026-09-10', lines: [line('Design', '1000', '2'), line('Hosting', '500')] });          // 2500 + 18%
  await doc({ docDate: '2026-10-05', lines: [line('Design', '1000')] });                                      // 1000 + 18%
  const inv = await doc({ docDate: '2026-10-20', lines: [line('Hosting', '500')] });
  await doc({ docType: 'credit_note', docDate: '2026-10-25', originalDocumentId: inv, lines: [line('Hosting', '500')] } as never);
  await createBill(db.web, owner, { partyId: vendor, billNumber: 'S-1', billDate: '2026-10-02', dueDate: '2026-10-10', lines: [{ description: 'Steel', quantity: '1', rate: '800', taxRateBp: 1800 }] });
  await createBill(db.web, owner, { partyId: vendor, billNumber: 'S-2', billDate: '2026-10-03', lines: [{ description: 'Steel', quantity: '1', rate: '200', taxRateBp: 0 }] });
  await saveExpense(db.web, owner, { date: '2026-10-08', category: 'Rent', amount: '300' });
  await saveExpense(db.web, owner, { date: '2026-12-08', category: 'Rent', amount: '999' });                 // outside the range
}, 90_000);
afterAll(async () => { await db?.drop(); });

describe('sales by item and by month', () => {
  it('adds up each item and takes credit notes away', async () => {
    const r = await salesByItem(db.web, owner, R);
    const by = Object.fromEntries(r.rows.map((x) => [x.item, x]));
    expect(by.Design).toMatchObject({ quantity: '3.000', documents: 2, taxable: '300000' });
    expect(by.Hosting).toMatchObject({ taxable: '50000', documents: 3 });   // 500 + 500 - 500
    expect(r.totals.taxable).toBe('350000');
    expect(r.rows[0]!.item).toBe('Design');
  });
  it('groups by month, net of credit notes', async () => {
    const r = await salesByMonth(db.web, owner, R);
    expect(r.rows.map((x) => [x.month, x.taxable])).toEqual([['2026-09', '250000'], ['2026-10', '100000']]);
    expect(r.totals).toMatchObject({ taxable: '350000', documents: 4 });
  });
  it('respects the date range', async () => {
    expect((await salesByMonth(db.web, owner, { from: '2026-10-01', to: '2026-10-31' })).rows.map((x) => x.month)).toEqual(['2026-10']);
  });
});

describe('profit and loss', () => {
  it('is sales less purchases less expenses, before GST, inside the range only', async () => {
    const r = await profitAndLoss(db.web, owner, R);
    const v = (l: string) => r.rows.find((x) => x.line.startsWith(l))!.amount;
    expect(v('Sales')).toBe('350000');
    expect(v('Purchases')).toBe('100000');
    expect(v('Gross profit')).toBe('250000');
    expect(v('Rent')).toBe('30000');
    expect(r.netPaise).toBe('220000');
  });
});

describe('payables and Excel', () => {
  it('lists what is owed with days late, and drops a bill once paid', async () => {
    const a = await payablesRows(db.web, owner);
    expect(a.rows.map((x) => x.bill_number)).toEqual(['S-2', 'S-1']);
    expect(a.rows.every((x) => x.days_late > 0)).toBe(true);
    expect(BigInt(a.outstanding)).toBe(94400n + 20000n);
    const [b] = await db.owner`select id from purchase_bill where bill_number = 'S-1'`;
    await payBill(db.web, owner, b!.id as string, { amount: '944' });
    expect((await payablesRows(db.web, owner)).rows.map((x) => x.bill_number)).toEqual(['S-2']);
  });
  it('writes a report as a workbook with real numbers', async () => {
    const r = await salesByItem(db.web, owner, R);
    const rows = readXlsx(reportToXlsx(ITEM_COLUMNS, r.rows, 'Sales by item'));
    expect(rows[0]).toEqual(['Item', 'HSN or SAC', 'Quantity', 'Documents', 'Taxable value', 'Tax', 'Total']);
    expect(rows[1]![0]).toBe('Design');
    expect(rows[1]![4]).toBe('3000');
  });
});

void recordPayment;
