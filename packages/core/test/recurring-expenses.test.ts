import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, archiveRecurringExpense, createBusiness, createRecurringExpense, getRecurringExpense, listRecurringExpenses, processDueRecurring,
  resolveTenant, resumeRecurringExpense, stopRecurringExpense, updateRecurringExpense, validateRecurringExpense, ForbiddenError, ValidationError,
  type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, accountant: TenantSession, other: TenantSession;

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const rent = (over = {}) => ({ name: 'Shop rent', category: 'Rent', amount: '11800.00', gst: '1800.00', vendor: 'Landlord', paidVia: 'bank_transfer', unit: 'week' as const, startDate: today(), ...over });
const expenseCount = async (bid: string) => (await db.owner`select count(*)::int as n from expense where business_id = ${bid}`)[0]!.n as number;
const dateOf = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('owner@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  const [a] = await db.owner`insert into app_user (email) values ('acct@example.test') returning id`;
  await addMember(db.web, owner.userId, bid, a!.id as string, 'accountant');
  accountant = await resolveTenant(db.web, a!.id as string, bid);
  const [u2] = await db.owner`insert into app_user (email) values ('other@example.test') returning id`;
  const bid2 = await createBusiness(db.web, u2!.id as string, { legalName: 'Other Co', gstin: null, stateCode: '27', registrationType: 'unregistered' });
  other = await resolveTenant(db.web, u2!.id as string, bid2);
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('recurring expenses', () => {
  it('a due profile makes exactly one expense with the right amount, GST and category; a second tick makes none', async () => {
    const id = (await createRecurringExpense(db.web, owner, rent())).id;
    expect(await processDueRecurring(db.web)).toEqual({ created: 1, failed: 0 });
    const r = (await getRecurringExpense(db.web, owner, id))!;
    expect(r.expenses).toHaveLength(1);
    expect(r.expenses[0]).toMatchObject({ expense_date: today(), category: 'Rent', amount_paise: '1180000', gst_paise: '180000', vendor: 'Landlord', paid_via: 'bank_transfer' });
    expect(r.runs[0]).toMatchObject({ status: 'created', run_date: today() });
    expect(dateOf(r.profile.next_run_date)).toBe(addDays(today(), 7));
    expect(await processDueRecurring(db.web)).toEqual({ created: 0, failed: 0 });
    expect((await getRecurringExpense(db.web, owner, id))!.expenses).toHaveLength(1);
    await archiveRecurringExpense(db.web, owner, id);
  });

  it('two workers ticking at once still make one expense per date', async () => {
    const id = (await createRecurringExpense(db.web, owner, rent({ name: 'Race' }))).id;
    const [a, b] = await Promise.all([processDueRecurring(db.web), processDueRecurring(db.web)]);
    expect(a.created + b.created).toBe(1);
    expect((await getRecurringExpense(db.web, owner, id))!.expenses).toHaveLength(1);
    await archiveRecurringExpense(db.web, owner, id);
  });

  it('catches up every missed date, as recurring invoices do', async () => {
    const id = (await createRecurringExpense(db.web, owner, rent({ name: 'Catch up', startDate: addDays(today(), -14) }))).id;
    expect(await processDueRecurring(db.web)).toEqual({ created: 3, failed: 0 });
    expect((await getRecurringExpense(db.web, owner, id))!.expenses.map((e) => e.expense_date).sort()).toEqual([addDays(today(), -14), addDays(today(), -7), today()]);
    await archiveRecurringExpense(db.web, owner, id);
  });

  it('a stopped profile makes nothing; resuming carries on without back-filling', async () => {
    const id = (await createRecurringExpense(db.web, owner, rent({ name: 'Stop', startDate: addDays(today(), -21) }))).id;
    await stopRecurringExpense(db.web, owner, id);
    const before = await expenseCount(owner.businessId);
    expect(await processDueRecurring(db.web)).toEqual({ created: 0, failed: 0 });
    expect(await expenseCount(owner.businessId)).toBe(before);
    const resumed = await resumeRecurringExpense(db.web, owner, id);
    expect(resumed.nextRunDate).toBe(today());                                  // 21 days is 3 weeks, so today is a scheduled date
    expect(await processDueRecurring(db.web)).toEqual({ created: 1, failed: 0 });
    expect((await getRecurringExpense(db.web, owner, id))!.expenses).toHaveLength(1);
    await archiveRecurringExpense(db.web, owner, id);
  });

  it('archiving or deleting a profile keeps the expenses already made, and an archived profile makes no more', async () => {
    const id = (await createRecurringExpense(db.web, owner, rent({ name: 'Archive' }))).id;
    await processDueRecurring(db.web);
    const before = await expenseCount(owner.businessId);
    await archiveRecurringExpense(db.web, owner, id);
    expect((await listRecurringExpenses(db.web, owner)).find((p) => p.id === id)).toBeUndefined();
    expect(await getRecurringExpense(db.web, owner, id)).toBeNull();
    expect(await expenseCount(owner.businessId)).toBe(before);
    await db.owner`update recurring_profile set next_run_date = ${today()}, active = true where id = ${id}`;   // forced due, but archived
    expect(await processDueRecurring(db.web)).toEqual({ created: 0, failed: 0 });
    await db.owner`delete from recurring_profile where id = ${id}`;                                         // even a hard delete leaves the expense
    expect(await expenseCount(owner.businessId)).toBe(before);
  });

  it('an edit changes what is spent from then on', async () => {
    const id = (await createRecurringExpense(db.web, owner, rent({ name: 'Edit', startDate: addDays(today(), 7) }))).id;
    await updateRecurringExpense(db.web, owner, id, { name: 'Edit', category: 'Utilities', amount: '500.00' });
    expect((await getRecurringExpense(db.web, owner, id))!.profile.payload).toMatchObject({ category: 'Utilities', amountPaise: '50000', gstPaise: '0' });
    await archiveRecurringExpense(db.web, owner, id);
  });

  it('refuses bad input and an accountant', async () => {
    expect(() => validateRecurringExpense(rent({ amount: '0' }))).toThrow(ValidationError);
    expect(() => validateRecurringExpense(rent({ gst: '99999.00' }))).toThrow(/more than the amount/);
    expect(() => validateRecurringExpense(rent({ category: '' }))).toThrow(ValidationError);
    expect(() => validateRecurringExpense(rent({ paidVia: 'barter' }))).toThrow(ValidationError);
    expect(await fails(createRecurringExpense(db.web, accountant, rent()))).toBeInstanceOf(ForbiddenError);
  });

  it('one business cannot see or touch the schedules of another', async () => {
    const id = (await createRecurringExpense(db.web, owner, rent({ name: 'Mine', startDate: addDays(today(), 30) }))).id;
    expect(await listRecurringExpenses(db.web, other)).toEqual([]);
    expect(await getRecurringExpense(db.web, other, id)).toBeNull();
    expect(await fails(stopRecurringExpense(db.web, other, id))).toBeInstanceOf(ValidationError);
    expect(await fails(archiveRecurringExpense(db.web, other, id))).toBeInstanceOf(ValidationError);
    expect(await fails(updateRecurringExpense(db.web, other, id, { name: 'x', category: 'Rent', amount: '1' }))).toBeInstanceOf(ValidationError);
    await archiveRecurringExpense(db.web, owner, id);
  });
});
