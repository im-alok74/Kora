import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addClient, addDefaultChecklist, addFilingEvidence, addFirmMember, addStaffVersion, assignClient, assignEngagement, clearBlocker, closeEngagement, createFirm, decideSubmission, demoGstin,
  generateEngagements, getEvidenceFile, inFirm, listClients, listEngagements, listFilingEvidence, listRequests, resolveFirm, reviewRequest, reviewState, setBlocker, submitForReview,
  type FirmSession,
} from '../src/index.js';

let db: TestDb;
let partner: FirmSession, prep: FirmSession, rev: FirmSession, other: FirmSession;
let e1: string, e2: string;
const pdf = (s: string) => Buffer.from(`%PDF-1.4 ${s}`).toString('base64');
const ack = { name: 'ack.pdf', type: 'application/pdf', dataBase64: pdf('acknowledgement') };
const status = async (id: string) => (await listEngagements(db.web, partner)).engagements.find((e) => e.id === id)!.status;

/** Gets a piece of work to "approved": checklist accepted, submitted by the preparer, approved by the reviewer. */
async function approve(id: string) {
  await addDefaultChecklist(db.web, partner, id);
  await assignEngagement(db.web, partner, id, { ownerId: prep.userId, reviewerId: rev.userId });
  for (const r of await listRequests(db.web, partner, id)) {
    await addStaffVersion(db.web, partner, r.id, { name: 'x.pdf', type: 'application/pdf', dataBase64: pdf(r.label) });
    await reviewRequest(db.web, partner, r.id, { decision: 'accepted' });
  }
  const sub = await submitForReview(db.web, prep, id);
  await decideSubmission(db.web, rev, sub.id, { decision: 'approved' });
}

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [p, q, r, o] = [await mk('p@e.test'), await mk('q@e.test'), await mk('r@e.test'), await mk('o@e.test')] as string[] as [string, string, string, string];
  const f = await createFirm(db.web, p, 'Sharma and Co');
  const f2 = await createFirm(db.web, o, 'Rao');
  await addFirmMember(db.web, p, f, q, 'preparer');
  await addFirmMember(db.web, p, f, r, 'reviewer');
  [partner, prep, rev, other] = await Promise.all([resolveFirm(db.web, p, f), resolveFirm(db.web, q, f), resolveFirm(db.web, r, f), resolveFirm(db.web, o, f2)]);
  await addClient(db.web, partner, { legalName: 'Alpha Foods', registrations: [{ gstin: demoGstin('27', '8001') }] });
  const alpha = (await listClients(db.web, partner)).clients[0]!.id;
  await assignClient(db.web, partner, alpha, prep.userId);
  await assignClient(db.web, partner, alpha, rev.userId);
  await generateEngagements(db.web, partner, '2026-08');
  const l = (await listEngagements(db.web, partner)).engagements;
  [e1, e2] = [l.find((e) => e.service === 'gstr1')!.id, l.find((e) => e.service === 'gstr3b')!.id];
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('filing evidence and closing', () => {
  it('records nothing and closes nothing before the review is approved', async () => {
    await expect(addFilingEvidence(db.web, partner, e1, { reference: 'AA270826001', filedOn: '2026-09-10', file: ack })).rejects.toThrow(/approved review/);
    await expect(closeEngagement(db.web, partner, e1)).rejects.toThrow(/approved review/);
    await approve(e1);
  });
  it('refuses a bad reference, date or file', async () => {
    await expect(addFilingEvidence(db.web, partner, e1, { reference: ' ', filedOn: '2026-09-10', file: ack })).rejects.toThrow(/reference/);
    await expect(addFilingEvidence(db.web, partner, e1, { reference: 'X', filedOn: '10/09/2026', file: ack })).rejects.toThrow(/date/);
    await expect(addFilingEvidence(db.web, partner, e1, { reference: 'X', filedOn: '2999-01-01', file: ack })).rejects.toThrow(/future/);
    await expect(addFilingEvidence(db.web, partner, e1, { reference: 'X', filedOn: '2026-09-10', file: { ...ack, dataBase64: Buffer.from('MZ').toString('base64') } })).rejects.toThrow(/real file/);
  });
  it('will not close until the filing is recorded', async () => {
    await expect(closeEngagement(db.web, partner, e1)).rejects.toThrow(/Record the filing/);
  });
  it('records the filing and lets it be downloaded exactly as sent, by this firm only', async () => {
    const id = await addFilingEvidence(db.web, prep, e1, { reference: 'AA270826001', filedOn: '2026-09-10', file: ack });
    expect(await listFilingEvidence(db.web, partner, e1)).toMatchObject([{ reference: 'AA270826001', filedOn: '2026-09-10', fileName: 'ack.pdf' }]);
    expect((await getEvidenceFile(db.web, partner, id))!.data.toString()).toBe('%PDF-1.4 acknowledgement');
    expect(await getEvidenceFile(db.web, other, id)).toBeNull();
  });
  it('cannot be edited or deleted afterwards', async () => {
    await expect(inFirm(db.web, partner, 'engagement.work', (tx) => tx`update filing_evidence set reference = 'changed'`)).rejects.toThrow(/permission denied/);
    await expect(inFirm(db.web, partner, 'engagement.work', (tx) => tx`delete from filing_evidence`)).rejects.toThrow(/permission denied/);
  });
  it('will not close while something is holding the work up, or for a preparer', async () => {
    await setBlocker(db.web, prep, e1, { reason: 'Waiting on a notice', party: 'third_party' });
    await expect(closeEngagement(db.web, partner, e1)).rejects.toThrow(/holding this work up/);
    await clearBlocker(db.web, prep, e1);
    await expect(closeEngagement(db.web, prep, e1)).rejects.toThrow(/Only a partner, a manager or the assigned reviewer/);
  });
  it('closes for the assigned reviewer, once, and only then shows done', async () => {
    await closeEngagement(db.web, rev, e1);
    expect(await status(e1)).toBe('done');
    await expect(closeEngagement(db.web, partner, e1)).rejects.toThrow(/already closed/);
  });
  it('refuses to close, or to record a filing, once something changed after approval', async () => {
    await approve(e2);
    const item = (await listRequests(db.web, partner, e2))[0]!;
    await reviewRequest(db.web, partner, item.id, { decision: 'requested' });
    await addStaffVersion(db.web, partner, item.id, { name: 'changed.pdf', type: 'application/pdf', dataBase64: pdf('changed') });
    expect((await reviewState(db.web, partner, e2)).effective).toBe('stale');
    await expect(addFilingEvidence(db.web, partner, e2, { reference: 'AA1', filedOn: '2026-09-10', file: ack })).rejects.toThrow(/Something changed/);
    await expect(closeEngagement(db.web, partner, e2)).rejects.toThrow(/Something changed/);
  });
  it('lets a stale approval be fixed by reviewing again, then close', async () => {
    const item = (await listRequests(db.web, partner, e2))[0]!;
    await reviewRequest(db.web, partner, item.id, { decision: 'accepted' });
    const sub = await submitForReview(db.web, prep, e2);
    await decideSubmission(db.web, rev, sub.id, { decision: 'approved' });
    await addFilingEvidence(db.web, partner, e2, { reference: 'AA2', filedOn: '2026-09-11', file: ack });
    await closeEngagement(db.web, partner, e2);
    expect(await status(e2)).toBe('done');
  });
});
