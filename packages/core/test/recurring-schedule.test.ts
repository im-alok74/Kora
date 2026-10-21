import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  createBusiness, createParty, createRecurring, getRecurring, processDueRecurring, recurringPreview, resolveTenant, setRecurringActive, skipNextRecurring,
  upcomingDates, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession;
let buyer: string;

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const base = () => ({ name: 'Retainer', partyId: buyer, unit: 'month' as const, startDate: addDays(today(), 10), mode: 'draft' as const, termsDays: 15,
  lines: [{ name: 'Retainer', hsnSac: '998313', quantity: '1', rate: '2000.00', taxRateBp: 1800, kind: 'service' as const }] });

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('owner@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  buyer = await createParty(db.web, owner, { kind: 'customer', name: 'Local Buyer', stateCode: '27', phone: '9876543210' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('upcoming dates', () => {
  it('lists the next dates, keeps a month-end start on month ends, and stops at the end date', () => {
    expect(upcomingDates({ startDate: '2026-01-31', everyN: 1, unit: 'month' }, 4)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(upcomingDates({ startDate: '2026-01-05', everyN: 2, unit: 'week' }, 3)).toEqual(['2026-01-05', '2026-01-19', '2026-02-02']);
    expect(upcomingDates({ startDate: '2026-01-01', everyN: 1, unit: 'month', endDate: '2026-03-01' }, 6)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
    expect(upcomingDates({ startDate: '2026-01-01', everyN: 1, unit: 'year', occurrence: 2 }, 2)).toEqual(['2028-01-01', '2029-01-01']);
  });
});

describe('skipping and previewing a schedule', () => {
  it('skips the next date without making an invoice, and says so in the history', async () => {
    const { id } = await createRecurring(db.web, owner, base());
    const first = base().startDate;
    const out = await skipNextRecurring(db.web, owner, id);
    expect(out.skipped).toBe(first);
    expect(out.nextRunDate).toBe(upcomingDates({ startDate: first, everyN: 1, unit: 'month' }, 2)[1]);
    const cur = (await getRecurring(db.web, owner, id))!;
    expect(cur.profile.next_run_date).toBe(out.nextRunDate);
    expect(cur.runs.map((r) => [r.run_date, r.status])).toEqual([[first, 'skipped']]);
    expect(cur.runs[0]!.document_id).toBeNull();
  });

  it('previews the next runs with the amount and due dates, and nothing while paused', async () => {
    const { id } = await createRecurring(db.web, owner, base());
    const p = await recurringPreview(db.web, owner, id, 3);
    expect(p.dates).toHaveLength(3);
    expect(p.amountPaise).toBe('236000');
    expect(p.dates[0]!.dueDate).toBe(addDays(p.dates[0]!.date, 15));
    await setRecurringActive(db.web, owner, id, false);
    expect((await recurringPreview(db.web, owner, id)).dates).toEqual([]);
    expect((await fails(skipNextRecurring(db.web, owner, id))).message).toMatch(/paused/);
  });

  it('a skipped date is never made later by the worker, and the last date finishes the schedule', async () => {
    const start = addDays(today(), -1);
    const { id } = await createRecurring(db.web, owner, { ...base(), unit: 'week' as const, startDate: start, endDate: addDays(start, 10) });
    await skipNextRecurring(db.web, owner, id);
    const r = await processDueRecurring(db.web);
    expect(r.created).toBe(0);
    const cur = (await getRecurring(db.web, owner, id))!;
    expect(cur.runs.filter((x) => x.status === 'created')).toHaveLength(0);
    const out = await skipNextRecurring(db.web, owner, id);
    expect(out.nextRunDate).toBeNull();
    expect((await getRecurring(db.web, owner, id))!.profile.active).toBe(false);
  });
});
