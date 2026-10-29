import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addClient, addFirmMember, assignClient, createFirm, demoGstin, generateEngagements, listClients, listEngagements, resolveFirm, setEngagementDates, standardDeadline,
  type FirmSession,
} from '../src/index.js';

let db: TestDb;
let partner: FirmSession, prep: FirmSession, other: FirmSession;
const g = (n: number, state = '27') => demoGstin(state, String(3000 + n));

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [p, q, o] = [await mk('p@e.test'), await mk('q@e.test'), await mk('o@e.test')] as [string, string, string];
  const f = await createFirm(db.web, p, 'Sharma and Co');
  const f2 = await createFirm(db.web, o, 'Rao');
  await addFirmMember(db.web, p, f, q, 'preparer');
  [partner, prep, other] = [await resolveFirm(db.web, p, f), await resolveFirm(db.web, q, f), await resolveFirm(db.web, o, f2)];
  await addClient(db.web, partner, { legalName: 'Alpha Foods', registrations: [{ gstin: g(1) }] });
  await addClient(db.web, partner, { legalName: 'Beta Quarterly', registrations: [{ gstin: g(2), filingFrequency: 'quarterly' }] });
  await addClient(db.web, partner, { legalName: 'Gamma Composition', registrations: [{ gstin: g(3), registrationType: 'composition' }] });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('standard dates', () => {
  it('gives the 11th and 20th of the next month, rolls over December, and refuses to guess otherwise', () => {
    expect(standardDeadline('gstr1', '2026-09', 'regular', 'monthly')).toMatchObject({ date: '2026-10-11' });
    expect(standardDeadline('gstr3b', '2026-09', 'regular', 'monthly')).toMatchObject({ date: '2026-10-20' });
    expect(standardDeadline('gstr3b', '2026-12', 'regular', 'monthly')).toMatchObject({ date: '2027-01-20' });
    expect(standardDeadline('gstr3b', '2026-09', 'regular', 'quarterly')).toBeNull();
    expect(standardDeadline('gstr3b', '2026-09', 'composition', 'monthly')).toBeNull();
  });
});

describe('generator', () => {
  it('creates GSTR-1 and GSTR-3B for the regular monthly registration only, with dates and a target', async () => {
    const r = await generateEngagements(db.web, partner, '2026-08');
    expect(r).toMatchObject({ created: 2, existing: 0 });
    expect(r.skipped.map((x) => x.count)).toEqual([1, 1]);
    const l = await listEngagements(db.web, partner, { period: '2026-08' });
    expect(l.engagements.map((e) => [e.clientName, e.form, e.statutoryDeadline, e.internalTarget, e.status])).toEqual([
      ['Alpha Foods', 'GSTR-1', '2026-09-11', '2026-09-08', 'open'],
      ['Alpha Foods', 'GSTR-3B', '2026-09-20', '2026-09-17', 'open'],
    ]);
  });
  it('creates nothing new when run again', async () => {
    expect(await generateEngagements(db.web, partner, '2026-08')).toMatchObject({ created: 0, existing: 2 });
    expect((await listEngagements(db.web, partner)).total).toBe(2);
  });
  it('creates quarterly filers only in quarter-end months, with no guessed date', async () => {
    const r = await generateEngagements(db.web, partner, '2026-12');
    expect(r.created).toBe(4); // Alpha x2 (monthly) + Beta x2 (quarter end)
    const beta = (await listEngagements(db.web, partner, { period: '2026-12' })).engagements.filter((e) => e.clientName === 'Beta Quarterly');
    expect(beta).toHaveLength(2);
    expect(beta.every((e) => e.statutoryDeadline === null && e.internalTarget === null && /set the date/.test(e.deadlineSource))).toBe(true);
    // nulls sort first, so the ones needing a date are at the top of the list
    expect((await listEngagements(db.web, partner, { period: '2026-12' })).engagements[0]!.statutoryDeadline).toBeNull();
  });
  it('lets a manager-level person set a date by hand, and rejects a bad one', async () => {
    const beta = (await listEngagements(db.web, partner, { period: '2026-12' })).engagements.find((e) => e.clientName === 'Beta Quarterly' && e.service === 'gstr3b')!;
    await setEngagementDates(db.web, partner, beta.id, { statutoryDeadline: '2027-01-24', source: 'Notified QRMP date', internalTarget: '2027-01-20' });
    const again = (await listEngagements(db.web, partner, { period: '2026-12' })).engagements.find((e) => e.id === beta.id)!;
    expect(again).toMatchObject({ statutoryDeadline: '2027-01-24', deadlineSource: 'Notified QRMP date', internalTarget: '2027-01-20' });
    await expect(setEngagementDates(db.web, partner, beta.id, { statutoryDeadline: '24/01/2027' })).rejects.toThrow(/Dates must/);
  });
  it('rejects a bad period', async () => {
    await expect(generateEngagements(db.web, partner, '2026-13')).rejects.toThrow(/Period/);
  });
});

describe('who can do what', () => {
  it('shows a preparer only the engagements of assigned clients, and stops them generating', async () => {
    expect((await listEngagements(db.web, prep)).total).toBe(0);
    const alpha = (await listClients(db.web, partner)).clients.find((c) => c.legalName === 'Alpha Foods')!;
    await assignClient(db.web, partner, alpha.id, prep.userId);
    expect((await listEngagements(db.web, prep, { period: '2026-08' })).total).toBe(2);
    await expect(generateEngagements(db.web, prep, '2026-07')).rejects.toThrow(/firm role/);
  });
  it('keeps another firm out', async () => {
    expect((await listEngagements(db.web, other)).total).toBe(0);
    expect(await generateEngagements(db.web, other, '2026-08')).toMatchObject({ created: 0 });
  });
});
