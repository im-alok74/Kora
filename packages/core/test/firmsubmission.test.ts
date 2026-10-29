import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addClient, addDefaultChecklist, addFirmMember, addStaffVersion, assignClient, assignEngagement, createFirm, decideSubmission, demoGstin, generateEngagements, listClients, listEngagements,
  listRequests, raiseIssue, resolveFirm, resolveIssue, reviewRequest, reviewState, submitForReview, type FirmSession,
} from '../src/index.js';

let db: TestDb;
let partner: FirmSession, prep: FirmSession, rev: FirmSession, other: FirmSession;
let eng: string;
const pdf = (s: string) => Buffer.from(`%PDF-1.4 ${s}`).toString('base64');
const engStatus = async () => (await listEngagements(db.web, partner)).engagements.find((e) => e.id === eng)!.status;

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [p, q, r, o] = [await mk('p@e.test'), await mk('q@e.test'), await mk('r@e.test'), await mk('o@e.test')] as string[] as [string, string, string, string];
  const f = await createFirm(db.web, p, 'Sharma and Co');
  const f2 = await createFirm(db.web, o, 'Rao');
  await addFirmMember(db.web, p, f, q, 'preparer');
  await addFirmMember(db.web, p, f, r, 'reviewer');
  [partner, prep, rev, other] = await Promise.all([resolveFirm(db.web, p, f), resolveFirm(db.web, q, f), resolveFirm(db.web, r, f), resolveFirm(db.web, o, f2)]);
  await addClient(db.web, partner, { legalName: 'Alpha Foods', registrations: [{ gstin: demoGstin('27', '7001') }] });
  const alpha = (await listClients(db.web, partner)).clients[0]!.id;
  await assignClient(db.web, partner, alpha, prep.userId);
  await assignClient(db.web, partner, alpha, rev.userId);
  await generateEngagements(db.web, partner, '2026-08');
  eng = (await listEngagements(db.web, partner)).engagements.find((e) => e.service === 'gstr1')!.id;
  await addDefaultChecklist(db.web, partner, eng);
}, 60_000);
afterAll(async () => { await db?.drop(); });

const closeItems = async () => {
  for (const r of await listRequests(db.web, partner, eng)) {
    if (r.status === 'accepted' || r.status === 'waived') continue;
    await addStaffVersion(db.web, partner, r.id, { name: 'x.pdf', type: 'application/pdf', dataBase64: pdf(r.label) });
    await reviewRequest(db.web, partner, r.id, { decision: 'accepted' });
  }
};

describe('submitting', () => {
  it('needs a preparer and a reviewer on the work', async () => {
    await expect(submitForReview(db.web, partner, eng)).rejects.toThrow(/preparer and a reviewer/);
    await assignEngagement(db.web, partner, eng, { ownerId: prep.userId, reviewerId: rev.userId });
  });
  it('refuses while checklist items are not accepted or waived', async () => {
    await expect(submitForReview(db.web, prep, eng)).rejects.toThrow(/3 item\(s\)/);
    await closeItems();
  });
  it('refuses a reviewer submitting their own review, and an outsider', async () => {
    await expect(submitForReview(db.web, rev, eng)).rejects.toThrow(/cannot submit work they are reviewing/);
    await expect(submitForReview(db.web, other, eng)).rejects.toThrow(/not found/);
  });
  it('freezes a version, moves the work into review, and supersedes an earlier one', async () => {
    const a = await submitForReview(db.web, prep, eng);
    expect(a.versionNo).toBe(1);
    expect(await engStatus()).toBe('in_review');
    const b = await submitForReview(db.web, prep, eng);
    expect(b.versionNo).toBe(2);
    const [old] = await db.owner`select status from review_submission where id = ${a.id}`;
    expect(old!.status).toBe('superseded');
    const st = await reviewState(db.web, partner, eng);
    expect(st).toMatchObject({ effective: 'pending', submission: { versionNo: 2, unchanged: true } });
  });
  it('can never edit the frozen snapshot, even directly', async () => {
    await expect(db.owner`update review_submission set snapshot = '[]'::jsonb where engagement_id = ${eng}`).rejects.toThrow(/cannot be changed/);
    await expect(db.owner`update review_submission set package_hash = ${'0'.repeat(64)} where engagement_id = ${eng}`).rejects.toThrow(/cannot be changed/);
  });
});

describe('review', () => {
  let sub: string;
  it('blocks approval until raised points are resolved', async () => {
    sub = (await reviewState(db.web, partner, eng)).submission!.id;
    const issue = await raiseIssue(db.web, rev, sub, 'Bank statement is for the wrong month');
    await expect(decideSubmission(db.web, rev, sub, { decision: 'approved' })).rejects.toThrow(/1 point\(s\) are still open/);
    await resolveIssue(db.web, prep, issue);
    expect((await reviewState(db.web, partner, eng)).submission!.issues[0]).toMatchObject({ status: 'resolved' });
  });
  it('lets only the reviewer, a partner or a manager decide, and never the person who submitted', async () => {
    await expect(decideSubmission(db.web, prep, sub, { decision: 'approved' })).rejects.toThrow(/someone else|Only the reviewer/);
    await expect(raiseIssue(db.web, prep, sub, 'x')).rejects.toThrow(/Only the reviewer/);
    // a partner who submits cannot approve their own submission
    const mine = await submitForReview(db.web, partner, eng);
    await expect(decideSubmission(db.web, partner, mine.id, { decision: 'approved' })).rejects.toThrow(/someone else/);
    sub = mine.id;
  });
  it('sends back with a note, and the work returns to preparing', async () => {
    await expect(decideSubmission(db.web, rev, sub, { decision: 'returned' })).rejects.toThrow(/what needs to change/);
    await decideSubmission(db.web, rev, sub, { decision: 'returned', note: 'Recheck the sales total' });
    expect(await engStatus()).toBe('preparing');
    expect(await reviewState(db.web, partner, eng)).toMatchObject({ effective: 'returned', submission: { decisionNote: 'Recheck the sales total' } });
    await expect(decideSubmission(db.web, rev, sub, { decision: 'approved' })).rejects.toThrow(/waiting for review/);
  });
  it('approves a new version, and the approval goes stale when a file changes afterwards', async () => {
    const v = await submitForReview(db.web, prep, eng);
    await decideSubmission(db.web, rev, v.id, { decision: 'approved', note: 'Looks right' });
    expect(await reviewState(db.web, partner, eng)).toMatchObject({ effective: 'approved', submission: { unchanged: true, decidedBy: rev.userId } });
    // a new file for an accepted item changes what the reviewer signed off on
    const item = (await listRequests(db.web, partner, eng))[0]!;
    await expect(addStaffVersion(db.web, partner, item.id, { name: 'new.pdf', type: 'application/pdf', dataBase64: pdf('changed') })).rejects.toThrow(/already closed/);
    await reviewRequest(db.web, partner, item.id, { decision: 'requested' });
    await addStaffVersion(db.web, partner, item.id, { name: 'new.pdf', type: 'application/pdf', dataBase64: pdf('changed') });
    expect(await reviewState(db.web, partner, eng)).toMatchObject({ effective: 'stale', submission: { status: 'approved', unchanged: false } });
  });
  it('refuses to approve a pending version whose files changed after it was submitted', async () => {
    await reviewRequest(db.web, partner, (await listRequests(db.web, partner, eng))[0]!.id, { decision: 'accepted' });
    const v = await submitForReview(db.web, prep, eng);
    const item = (await listRequests(db.web, partner, eng))[1]!;
    await reviewRequest(db.web, partner, item.id, { decision: 'requested' });
    await addStaffVersion(db.web, partner, item.id, { name: 'late.pdf', type: 'application/pdf', dataBase64: pdf('late') });
    await expect(decideSubmission(db.web, rev, v.id, { decision: 'approved' })).rejects.toThrow(/changed after this was submitted/);
  });
});
