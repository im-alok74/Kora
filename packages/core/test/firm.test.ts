import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { addMember, createBusiness, createParty, firmSummary, gstDeadlines, issueDocument, resolveTenant, saveDraft, type TenantSession } from '../src/index.js';

let db: TestDb;
let ca: string, client: string, stranger: string;
let a: TenantSession, b: TenantSession;

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  [ca, client, stranger] = [await mk('ca@e.test'), await mk('c@e.test'), await mk('s@e.test')] as [string, string, string];
  const ba = await createBusiness(db.web, ca, { legalName: 'Zed Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  const bb = await createBusiness(db.web, client, { legalName: 'Alpha Foods', gstin: null, stateCode: '27', registrationType: 'unregistered' });
  await addMember(db.web, client, bb, ca, 'accountant');
  a = await resolveTenant(db.web, ca, ba); b = await resolveTenant(db.web, client, bb);
  const p = await createParty(db.web, a, { kind: 'customer', name: 'Asha Stores', stateCode: '27' });
  const { id } = await saveDraft(db.web, a, { docType: 'tax_invoice', partyId: p, lines: [{ name: 'S', hsnSac: '998313', quantity: '1', rate: '1000', taxRateBp: 1800, kind: 'service' }], dueDate: '2020-01-01' });
  await issueDocument(db.web, a, id);
  await saveDraft(db.web, b, { docType: 'estimate', lines: [{ name: 'S', hsnSac: '998313', quantity: '1', rate: '10', taxRateBp: 0, kind: 'service' }] });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('GST dates', () => {
  it('lists the 11th and 20th for the month just ended, for regular dealers only', () => {
    expect(gstDeadlines('2026-10-19', 'regular')).toEqual([
      { form: 'GSTR-1', period: 'Sep 2026', due: '2026-10-11', daysLeft: -8 },
      { form: 'GSTR-3B', period: 'Sep 2026', due: '2026-10-20', daysLeft: 1 },
    ]);
    expect(gstDeadlines('2026-01-05', 'regular')[0]).toMatchObject({ period: 'Dec 2025', daysLeft: 6 });
    expect(gstDeadlines('2026-10-19', 'unregistered')).toEqual([]);
    expect(gstDeadlines('2026-10-19', 'composition')).toEqual([]);
  });
});

describe('firm summary', () => {
  it('shows every business the person belongs to, late ones first, and nothing from other people', async () => {
    const f = await firmSummary(db.web, ca);
    expect(f.clients.map((c) => c.name)).toEqual(['Zed Traders', 'Alpha Foods']);
    const z = f.clients[0]!;
    expect(z).toMatchObject({ visible: true, overdueCount: 1, needsAttention: true, role: 'owner', gstin: '27AAPFU0939F1ZV' });
    expect(z.outstanding).toBe('118000');
    expect(z.deadlines).toHaveLength(2);
    const al = f.clients[1]!;
    expect(al).toMatchObject({ role: 'accountant', registrationType: 'unregistered', deadlines: [], outstanding: '0', drafts: 1 });
    expect(f).toMatchObject({ truncated: false, shown: 2, total: 2 });
    expect(f.totals).toEqual({ clients: 2, outstanding: '118000', overdue: '118000', needingAttention: 1 });
  });
  it('is empty for someone with no businesses', async () => {
    expect(await firmSummary(db.web, stranger)).toEqual({ truncated: false, shown: 0, total: 0, totals: { clients: 0, outstanding: '0', overdue: '0', needingAttention: 0 }, clients: [] });
  });
});
