import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { createBill, createBusiness, createParty, getBill, listBills, msmeDeadline, msmeDue, msmeStatus, payBill, resolveTenant, updateParty, type TenantSession } from '../src/index.js';

const ist = (offsetDays: number) => new Date(Date.now() + 5.5 * 3600e3 + offsetDays * 86_400_000).toISOString().slice(0, 10);
let db: TestDb;
let owner: TenantSession;
let micro: string, plain: string, medium: string;
const line = { description: 'Goods', quantity: '1', rate: '1000', taxRateBp: 1800 };

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('m@e.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Buyer Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  micro = await createParty(db.web, owner, { kind: 'vendor', name: 'Tiny Works', stateCode: '27', udyamNumber: 'udyam-mh-12-0001234', msmeClass: 'micro' });
  medium = await createParty(db.web, owner, { kind: 'vendor', name: 'Mid Works', stateCode: '27', udyamNumber: 'UDYAM-MH-12-0005678', msmeClass: 'medium' });
  plain = await createParty(db.web, owner, { kind: 'vendor', name: 'Big Co', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('the 45-day rule', () => {
  it('works out the last day and how close it is', () => {
    expect(msmeDeadline('2026-01-01')).toBe('2026-02-15');
    expect(msmeDeadline('2026-01-01', '2026-01-20')).toBe('2026-01-20');   // an agreement shorter than 45 days wins
    expect(msmeDeadline('2026-01-01', '2026-04-01')).toBe('2026-02-15');   // a longer agreement does not
    expect(msmeStatus('2026-02-15', '2026-02-15')).toEqual({ state: 'soon', daysLeft: 0 });
    expect(msmeStatus('2026-02-15', '2026-02-16')).toEqual({ state: 'overdue', daysLeft: -1 });
    expect(msmeStatus('2026-02-15', '2026-01-01').state).toBe('ok');
  });
  it('needs the number and the class together, in the right shape', async () => {
    await expect(createParty(db.web, owner, { kind: 'vendor', name: 'X', stateCode: '27', udyamNumber: 'UDYAM-1' , msmeClass: 'micro' })).rejects.toThrow(/Udyam number like/);
    await expect(createParty(db.web, owner, { kind: 'vendor', name: 'X', stateCode: '27', udyamNumber: 'UDYAM-MH-12-0001234' })).rejects.toThrow(/micro, small or medium/);
    await expect(createParty(db.web, owner, { kind: 'vendor', name: 'X', stateCode: '27', msmeClass: 'small' })).rejects.toThrow(/Udyam number of the vendor/);
  });
  it('warns on unpaid bills from micro and small vendors only, and stops once paid', async () => {
    const late = await createBill(db.web, owner, { partyId: micro, billNumber: 'T-1', billDate: ist(-50), lines: [line] });
    const soon = await createBill(db.web, owner, { partyId: micro, billNumber: 'T-2', billDate: ist(-40), lines: [line] });
    const fine = await createBill(db.web, owner, { partyId: micro, billNumber: 'T-3', billDate: ist(-5), lines: [line] });
    await createBill(db.web, owner, { partyId: medium, billNumber: 'M-1', billDate: ist(-80), lines: [line] });
    await createBill(db.web, owner, { partyId: plain, billNumber: 'P-1', billDate: ist(-80), lines: [line] });
    const due = await msmeDue(db.web, owner);
    expect(due.bills.map((b) => b.billNumber)).toEqual(['T-1', 'T-2', 'T-3']);
    expect(due.bills.map((b) => b.state)).toEqual(['overdue', 'soon', 'ok']);
    expect(due.overdue).toBe(1); expect(due.soon).toBe(1);
    expect((await getBill(db.web, owner, late.id))!.msme).toMatchObject({ state: 'overdue', daysLeft: -5, class: 'micro' });
    expect((await getBill(db.web, owner, fine.id))!.msme).toMatchObject({ state: 'ok' });
    const rows = await listBills(db.web, owner);
    expect(rows.find((r) => r.bill_number === 'T-2')).toMatchObject({ msme_state: 'soon' });
    expect(rows.find((r) => r.bill_number === 'M-1')).not.toHaveProperty('msme_state');
    await payBill(db.web, owner, late.id, { amount: '1180' });
    expect((await msmeDue(db.web, owner)).bills.map((b) => b.billNumber)).toEqual(['T-2', 'T-3']);
    void soon;
  });
  it('stops warning when the vendor is changed to medium', async () => {
    await updateParty(db.web, owner, micro, { kind: 'vendor', name: 'Tiny Works', stateCode: '27', udyamNumber: 'UDYAM-MH-12-0001234', msmeClass: 'medium' });
    expect((await msmeDue(db.web, owner)).bills).toEqual([]);
  });
});
