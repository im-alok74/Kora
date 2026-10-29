import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addClient, addDefaultChecklist, addFirmMember, addStaffVersion, createFirm, createUploadLink, demoGstin, generateEngagements, listEngagements, listRequests, markReminder,
  planReminders, reminderSummary, resolveFirm, reviewRequest, uploadViaLink, type FirmSession,
} from '../src/index.js';

let db: TestDb;
let partner: FirmSession, prep: FirmSession;
let eng: string, noContactEng: string, token: string;
let reqs: { id: string; label: string }[];
const pdf = Buffer.from('%PDF-1.4 x').toString('base64');
const days = (n: number) => new Date(Date.now() + n * 86_400_000);

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [p, q] = [await mk('p@e.test'), await mk('q@e.test')] as [string, string];
  const f = await createFirm(db.web, p, 'Sharma and Co');
  await addFirmMember(db.web, p, f, q, 'preparer');
  [partner, prep] = await Promise.all([resolveFirm(db.web, p, f), resolveFirm(db.web, q, f)]);
  await addClient(db.web, partner, { legalName: 'Alpha Foods', contactEmail: 'asha@alpha.test', registrations: [{ gstin: demoGstin('27', '6001') }] });
  await addClient(db.web, partner, { legalName: 'Silent Co', registrations: [{ gstin: demoGstin('27', '6002') }] });
  await generateEngagements(db.web, partner, '2026-08');
  const l = (await listEngagements(db.web, partner)).engagements.filter((e) => e.service === 'gstr1');
  eng = l.find((e) => e.clientName === 'Alpha Foods')!.id;
  noContactEng = l.find((e) => e.clientName === 'Silent Co')!.id;
  await addDefaultChecklist(db.web, partner, eng);
  await addDefaultChecklist(db.web, partner, noContactEng);
  token = (await createUploadLink(db.web, partner, eng)).token;
  await createUploadLink(db.web, partner, noContactEng);
  reqs = (await listRequests(db.web, partner, eng)).map((r) => ({ id: r.id, label: r.label }));
}, 60_000);
afterAll(async () => { await db?.drop(); });

const status = async (id: string) => (await listRequests(db.web, partner, eng)).find((r) => r.id === id)!;

describe('review decisions', () => {
  it('will not accept an item nothing was received for', async () => {
    await expect(reviewRequest(db.web, partner, reqs[0]!.id, { decision: 'accepted' })).rejects.toThrow(/Nothing has been received/);
  });
  it('sends back with a reason, shows it to the client, and a new upload clears it', async () => {
    await uploadViaLink(db.web, token, reqs[0]!.id, { name: 'a.pdf', type: 'application/pdf', dataBase64: pdf });
    await expect(reviewRequest(db.web, partner, reqs[0]!.id, { decision: 'needs_correction' })).rejects.toThrow(/Say what is wrong/);
    await reviewRequest(db.web, partner, reqs[0]!.id, { decision: 'needs_correction', reason: 'Only page 1 came through' });
    expect(await status(reqs[0]!.id)).toMatchObject({ status: 'needs_correction', reason: 'Only page 1 came through' });
    await uploadViaLink(db.web, token, reqs[0]!.id, { name: 'a2.pdf', type: 'application/pdf', dataBase64: pdf });
    expect(await status(reqs[0]!.id)).toMatchObject({ status: 'received', reason: null });
    expect((await status(reqs[0]!.id)).versions).toHaveLength(2);
  });
  it('accepts, then refuses further uploads from the client, and can be reopened', async () => {
    await reviewRequest(db.web, partner, reqs[0]!.id, { decision: 'accepted' });
    await expect(uploadViaLink(db.web, token, reqs[0]!.id, { name: 'b.pdf', type: 'application/pdf', dataBase64: pdf })).rejects.toThrow(/could not be saved/);
    await expect(addStaffVersion(db.web, partner, reqs[0]!.id, { name: 'b.pdf', type: 'application/pdf', dataBase64: pdf })).rejects.toThrow(/closed/);
    await reviewRequest(db.web, partner, reqs[0]!.id, { decision: 'requested' });
    expect(await status(reqs[0]!.id)).toMatchObject({ status: 'requested', reason: null });
  });
  it('waives only with a reason', async () => {
    await expect(reviewRequest(db.web, partner, reqs[2]!.id, { decision: 'waived' })).rejects.toThrow(/why this is not needed/);
    await reviewRequest(db.web, partner, reqs[2]!.id, { decision: 'waived', reason: 'No bank activity this month' });
    expect(await status(reqs[2]!.id)).toMatchObject({ status: 'waived', reason: 'No bank activity this month' });
  });
  it('lets an assigned preparer review but not an outsider', async () => {
    await expect(reviewRequest(db.web, prep, reqs[1]!.id, { decision: 'waived', reason: 'x' })).rejects.toThrow(/not found/);
  });
});

describe('reminders', () => {
  it('queues nothing for brand-new items, and nothing for a client with no contact', async () => {
    expect(await planReminders(db.web, partner)).toEqual({ queued: 0, cancelled: 0 });
    const later = days(3);
    // Silent Co has no email or phone, so a reminder would have nowhere to go.
    const r = await planReminders(db.web, partner, later);
    const [n] = await db.owner`select count(*)::int as n from request_reminder rr join document_request d on d.id = rr.request_id where d.engagement_id = ${noContactEng}`;
    expect(n!.n).toBe(0);
    expect(r.queued).toBe(2); // Alpha: the item reopened and the one never sent; the waived one is skipped
  });
  it('does not double up when planned twice', async () => {
    expect(await planReminders(db.web, partner, days(3))).toEqual({ queued: 0, cancelled: 0 });
    expect(await reminderSummary(db.web, partner)).toEqual({ queued: 2, sent: 0, failed: 0 });
  });
  it('cancels the queued reminder for an item once the client sends a file', async () => {
    await uploadViaLink(db.web, token, reqs[1]!.id, { name: 'c.pdf', type: 'application/pdf', dataBase64: pdf });
    expect(await planReminders(db.web, partner, days(3))).toMatchObject({ cancelled: 1, queued: 0 });
    expect(await reminderSummary(db.web, partner)).toEqual({ queued: 1, sent: 0, failed: 0 });
    const [c] = await db.owner`select status from request_reminder rr where rr.request_id = ${reqs[1]!.id}`;
    expect(c!.status).toBe('cancelled');
  });
  it('records delivery separately from queueing, and only for a queued reminder', async () => {
    const [q] = await db.owner`select id from request_reminder where status = 'queued'`;
    await markReminder(db.web, partner, q!.id as string, { ok: false, error: 'No sender connected' });
    expect(await reminderSummary(db.web, partner)).toEqual({ queued: 0, sent: 0, failed: 1 });
    await expect(markReminder(db.web, partner, q!.id as string, { ok: true })).rejects.toThrow(/not waiting/);
  });
  it('spaces further reminders three days apart, caps them at four, and stops when the work is done', async () => {
    const id = reqs[0]!.id;
    expect((await planReminders(db.web, partner, days(2))).queued).toBe(0);   // the last reminder is under three days old
    expect((await planReminders(db.web, partner, days(4))).queued).toBe(1);   // now it is over three days old, so the next one is due
    // keep the link alive for the whole test, and age the existing reminders so the cadence allows the next ones
    await db.owner`update upload_link set expires_at = now() + interval '90 days'`;
    for (let round = 0; round < 6; round++) {
      await db.owner`update request_reminder set status = 'sent', settled_at = now() where status = 'queued'`;
      await db.owner`update request_reminder set created_at = created_at - interval '4 days'`;
      await planReminders(db.web, partner, days(30));
    }
    const [n] = await db.owner`select count(*)::int as n from request_reminder where request_id = ${id}`;
    expect(n!.n).toBe(4);   // the cap, reached and not passed
    await db.owner`update request_reminder set status = 'sent', settled_at = now() where status = 'queued'`;
    await db.owner`update engagement set status = 'done' where id = ${eng}`;   // closing goes through the review and filing steps, tested elsewhere
    await db.owner`update request_reminder set created_at = created_at - interval '9 days'`;
    expect((await planReminders(db.web, partner, days(60))).queued).toBe(0);
  });
  it('does not let a preparer plan reminders', async () => {
    await expect(planReminders(db.web, prep)).rejects.toThrow(/firm role/);
  });
});
