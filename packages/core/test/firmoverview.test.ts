import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addClient, addDefaultChecklist, addFilingEvidence, addFirmMember, addStaffVersion, assignClient, assignEngagement, closeEngagement, createFirm, decideSubmission, demoGstin, firmOverview,
  generateEngagements, getFee, listClients, listEngagements, listRequests, markFeeBilled, markFeePaid, pilotMetrics, planReminders, createUploadLink, resolveFirm, reviewRequest, setBlocker,
  setEngagementStatus, setFee, submitForReview, waiveFee, ENGAGEMENT_VIEWS, type FirmSession,
} from '../src/index.js';

let db: TestDb;
let partner: FirmSession, prep: FirmSession, rev: FirmSession;
const pdf = (s: string) => Buffer.from(`%PDF-1.4 ${s}`).toString('base64');
const ack = { name: 'ack.pdf', type: 'application/pdf', dataBase64: pdf('ack') };
let ids: string[] = [];

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [p, q, r] = [await mk('p@e.test'), await mk('q@e.test'), await mk('r@e.test')] as [string, string, string];
  const f = await createFirm(db.web, p, 'Sharma and Co');
  await addFirmMember(db.web, p, f, q, 'preparer');
  await addFirmMember(db.web, p, f, r, 'reviewer');
  [partner, prep, rev] = await Promise.all([resolveFirm(db.web, p, f), resolveFirm(db.web, q, f), resolveFirm(db.web, r, f)]);
  await addClient(db.web, partner, { legalName: 'Alpha Foods', registrations: [{ gstin: demoGstin('27', '9001') }] });
  await addClient(db.web, partner, { legalName: 'Beta Traders', registrations: [{ gstin: demoGstin('27', '9002') }] });
  await generateEngagements(db.web, partner, '2026-08');
  ids = (await listEngagements(db.web, partner)).engagements.map((e) => e.id);   // 4: GSTR-1 and GSTR-3B for each client
}, 60_000);
afterAll(async () => { await db?.drop(); });

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const plus = (n: number) => new Date(Date.parse(today()) + n * 86_400_000).toISOString().slice(0, 10);

describe('overview cards and the lists behind them', () => {
  it('counts what needs attention, and each count equals the list it opens', async () => {
    const [a, b, c, d] = ids as [string, string, string, string];
    await db.owner`update engagement set statutory_deadline = ${plus(2)} where id = ${a}`;          // due soon
    await db.owner`update engagement set statutory_deadline = ${plus(-3)} where id = ${b}`;         // date passed
    await db.owner`update engagement set statutory_deadline = null where id = ${c}`;                // no date
    await db.owner`update engagement set statutory_deadline = ${plus(30)} where id = ${d}`;         // later
    await setBlocker(db.web, partner, a, { reason: 'Bank statement', party: 'client' });
    await setBlocker(db.web, partner, b, { reason: 'Waiting on a notice', party: 'third_party' });
    await assignEngagement(db.web, partner, d, { ownerId: prep.userId, reviewerId: rev.userId });
    await setEngagementStatus(db.web, partner, d, 'in_review');
    const o = await firmOverview(db.web, partner);
    expect(o.counts).toMatchObject({ due_soon: 1, passed: 1, no_date: 1, blocked: 2, blocked_client: 1, in_review: 1, unassigned: 3, filing_missing: 0, unbilled: 0 });
    expect(Date.now() - Date.parse(o.asOf)).toBeLessThan(10_000);
    for (const v of ENGAGEMENT_VIEWS) expect((await listEngagements(db.web, partner, { view: v })).total, v).toBe(o.counts[v]);
  });
  it('rejects a view that does not exist, and shows a preparer only the work of clients given to them', async () => {
    await expect(listEngagements(db.web, partner, { view: 'nope' as 'passed' })).rejects.toThrow(/view does not exist/);
    expect((await firmOverview(db.web, prep)).counts.unassigned).toBe(0);
    const alpha = (await listClients(db.web, partner)).clients.find((c) => c.legalName === 'Alpha Foods')!;
    await assignClient(db.web, partner, alpha.id, prep.userId);
    expect((await firmOverview(db.web, prep)).counts.due_soon).toBe(1);
  });
});

/** Takes one piece of work from checklist to closed. */
async function closeOne(id: string) {
  for (const c of (await listClients(db.web, partner)).clients) for (const u of [prep.userId, rev.userId]) await assignClient(db.web, partner, c.id, u);
  await addDefaultChecklist(db.web, partner, id);
  await assignEngagement(db.web, partner, id, { ownerId: prep.userId, reviewerId: rev.userId });
  for (const r of await listRequests(db.web, partner, id)) {
    await addStaffVersion(db.web, partner, r.id, { name: 'x.pdf', type: 'application/pdf', dataBase64: pdf(r.label) });
    await reviewRequest(db.web, partner, r.id, { decision: 'accepted' });
  }
  const sub = await submitForReview(db.web, prep, id);
  await decideSubmission(db.web, rev, sub.id, { decision: 'approved' });
  await addFilingEvidence(db.web, partner, id, { reference: 'AA1', filedOn: today(), file: ack });
  await closeEngagement(db.web, partner, id);
}

describe('fees and unbilled work', () => {
  it('shows finished work with no fee decided as unbilled, and lets the partner record the fee, the bill and the payment', async () => {
    const id = ids[3]!;
    await db.owner`update engagement set blocker_reason = null, blocker_party = null, blocker_since = null where id = ${id}`;
    await closeOne(id);
    expect((await firmOverview(db.web, partner)).counts.unbilled).toBe(1);
    await expect(markFeeBilled(db.web, partner, id, { reference: 'INV-1' })).rejects.toThrow(/Set the fee first/);
    await expect(setFee(db.web, partner, id, { amount: '25,00' })).rejects.toThrow(/in rupees/);
    await expect(setFee(db.web, prep, id, { amount: '2500' })).rejects.toThrow(/firm role/);
    await setFee(db.web, partner, id, { amount: '2500.50', description: 'GSTR-1 and 3B, August' });
    expect(await getFee(db.web, partner, id)).toMatchObject({ amountPaise: '250050', status: 'unbilled', description: 'GSTR-1 and 3B, August' });
    expect((await firmOverview(db.web, partner)).unbilledPaise).toBe('250050');
    await markFeeBilled(db.web, partner, id, { reference: 'INV-1', billedOn: today() });
    await expect(setFee(db.web, partner, id, { amount: '1' })).rejects.toThrow(/already been billed/);
    expect((await firmOverview(db.web, partner)).counts.unbilled).toBe(0);
    expect((await firmOverview(db.web, partner)).billedNotPaidPaise).toBe('250050');
    await markFeePaid(db.web, partner, id);
    expect((await firmOverview(db.web, partner)).billedNotPaidPaise).toBe('0');
    await expect(markFeePaid(db.web, partner, id)).rejects.toThrow(/Only a billed fee/);
  });
  it('waives a fee only with a reason, and a waived one is not unbilled', async () => {
    const id = ids[2]!;
    await db.owner`update engagement set status = 'done' where id = ${id}`;
    expect((await firmOverview(db.web, partner)).counts.unbilled).toBe(1);
    await expect(waiveFee(db.web, partner, id, ' ')).rejects.toThrow(/why/);
    await waiveFee(db.web, partner, id, 'Included in the annual retainer');
    expect((await firmOverview(db.web, partner)).counts.unbilled).toBe(0);
    expect(await getFee(db.web, partner, id)).toMatchObject({ status: 'waived', amountPaise: '0' });
  });
});

describe('pilot measurements', () => {
  it('says unknown (null), not zero, when nothing has happened, and refuses anyone but a partner or manager', async () => {
    const empty = await db.owner`select 1`; void empty;
    await expect(pilotMetrics(db.web, prep)).rejects.toThrow(/partner or a manager/);
    await expect(pilotMetrics(db.web, partner, 0)).rejects.toThrow(/between 1 and 730/);
  });
  it('measures time to close, review turnaround, reminders and reopened work for the whole firm', async () => {
    const id = ids[1]!;
    await db.owner`update engagement set blocker_reason = null, blocker_party = null, blocker_since = null where id = ${id}`;
    await closeOne(id);
    await createUploadLink(db.web, partner, ids[0]!);
    await addDefaultChecklist(db.web, partner, ids[0]!);
    await db.owner`update document_request set updated_at = now() - interval '3 days' where engagement_id = ${ids[0]!}`;
    await planReminders(db.web, partner);
    await setEngagementStatus(db.web, partner, id, 'preparing');   // reopened
    const m = await pilotMetrics(db.web, partner);
    expect(m.closed).toBeGreaterThanOrEqual(2);
    expect(m.medianDaysToClose).not.toBeNull();
    expect(m.medianReviewHours).not.toBeNull();
    expect(m.medianRequestDays).not.toBeNull();
    expect(m.reviewsDecided).toBeGreaterThanOrEqual(2);
    expect(m.reopened).toBe(1);
    expect(m.filesAddedByStaff).toBeGreaterThan(0);
    expect(m.remindersPerRequest).not.toBeNull();
    // the log holds counts and times, never a person
    const cols = await db.owner`select column_name from information_schema.columns where table_name = 'firm_event'`;
    expect(cols.map((c) => c.column_name)).not.toContain('actor');
    expect(cols.map((c) => c.column_name)).not.toContain('user_id');
  });
});
