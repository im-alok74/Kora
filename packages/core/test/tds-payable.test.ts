import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { gstinCheckChar } from '@kora/tax';
import { createBill, createBusiness, createParty, getBill, payBill, removeBillPayment, resolveTenant, tdsDepositDate, tdsPayable, toCsv, TDS_PAYABLE_COLUMNS, type TenantSession } from '../src/index.js';

const gstinFor = (state: string, pan: string, n: string) => { const b = `${state}${pan}${n}A1Z`; return b + gstinCheckChar(b); };
let db: TestDb;
let owner: TenantSession;
let a: string, c: string;
const bill = (partyId: string, no: string, rate: string, date = '2026-10-05') => createBill(db.web, owner, { partyId, billNumber: no, billDate: date, lines: [{ description: 'Work', quantity: '1', rate, taxRateBp: 0 }] });

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('t@e.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Buyer', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  a = await createParty(db.web, owner, { kind: 'vendor', name: 'Contractor One', gstin: gstinFor('27', 'AAACV', '1111'), stateCode: '27' });
  c = await createParty(db.web, owner, { kind: 'vendor', name: 'Consultant Two', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('TDS held back on a vendor payment', () => {
  it('settles the bill by cash plus tax, and refuses what does not add up', async () => {
    const b = await bill(a, 'C-1', '10000');                                   // Rs 10,000, no GST
    await expect(payBill(db.web, owner, b.id, { amount: '9900', tds: '100' })).rejects.toThrow(/section/);
    await expect(payBill(db.web, owner, b.id, { amount: '9900', tds: '200', tdsSection: '194C' })).rejects.toThrow(/Only Rs 10000.00 is still due/);
    const r = await payBill(db.web, owner, b.id, { amount: '9900', tds: '100', tdsSection: '194c', paidOn: '2026-10-10' });
    expect(r.duePaise).toBe('0');
    const got = (await getBill(db.web, owner, b.id))!;
    expect(got.bill.paidPaise).toBe('1000000');
    expect(got.payments[0]).toMatchObject({ amount_paise: '990000', tds_paise: '10000', tds_section: '194C' });
  });
  it('removing the payment puts back both parts', async () => {
    const b = await bill(a, 'C-2', '5000');
    const p = await payBill(db.web, owner, b.id, { amount: '4500', tds: '500', tdsSection: '194J' });
    await removeBillPayment(db.web, owner, p.id);
    expect((await getBill(db.web, owner, b.id))!.bill.paidPaise).toBe('0');
  });
  it('a payment without TDS behaves as before', async () => {
    const b = await bill(c, 'K-1', '2000', '2026-10-12');
    await payBill(db.web, owner, b.id, { amount: '2000' });
    expect((await getBill(db.web, owner, b.id))!.payments[0]).toMatchObject({ tds_paise: '0', tds_section: null });
  });
});

describe('TDS payable report', () => {
  it('groups by vendor and section, reads PAN from the GSTIN, and lists deposit dates', async () => {
    const b = await bill(c, 'K-2', '20000', '2026-10-14');
    await payBill(db.web, owner, b.id, { amount: '18000', tds: '2000', tdsSection: '194J', paidOn: '2026-10-20' });
    const b2 = await bill(c, 'K-3', '10000', '2026-11-02');
    await payBill(db.web, owner, b2.id, { amount: '9000', tds: '1000', tdsSection: '194J', paidOn: '2026-11-03' });
    const r = await tdsPayable(db.web, owner, { from: '2026-10-01', to: '2026-11-30' });
    expect(r.rows.map((x) => [x.vendor, x.section, x.tds])).toEqual([['Consultant Two', '194J', '300000'], ['Contractor One', '194C', '10000']]);
    expect(r.rows.find((x) => x.vendor === 'Contractor One')!.pan).toBe('AAACV1111A');
    expect(r.total).toBe('310000');
    expect(r.deposits.map((d) => [d.month, d.section, d.tds, d.depositBy])).toEqual([['2026-10', '194C', '10000', '2026-11-07'], ['2026-10', '194J', '200000', '2026-11-07'], ['2026-11', '194J', '100000', '2026-12-07']]);
    expect(toCsv(TDS_PAYABLE_COLUMNS, r.rows)).toContain('Contractor One');
    const narrow = await tdsPayable(db.web, owner, { from: '2026-11-01', to: '2026-11-30' });
    expect(narrow.total).toBe('100000');
  });
  it('knows the March exception', () => { expect(tdsDepositDate('2027-03')).toBe('2027-04-30'); expect(tdsDepositDate('2026-12')).toBe('2027-01-07'); });
});
