import { createHash } from 'node:crypto';
import type { Sql, Tx } from '@kora/db';
import { logFirmEvent } from './firmoverview.js';
import { inFirm, seesAllClients, type FirmSession } from './firmtenancy.js';
import { loadEngagement } from './firmwork.js';
import { ValidationError } from './validation.js';

interface PackageItem { requestId: string; label: string; status: string; versionId: string | null; sha256: string | null }

/** The checklist as it stands now: every item, its status, and the exact file (by hash) that is its latest version. */
export async function currentPackage(tx: Tx, engagementId: string): Promise<{ items: PackageItem[]; hash: string }> {
  const rows = await tx`
    select r.id, r.label, r.status, v.id as version_id, v.sha256
      from document_request r
      left join lateral (select id, sha256 from document_version where request_id = r.id order by created_at desc, id desc limit 1) v on true
     where r.engagement_id = ${engagementId} order by lower(r.label), r.id`;
  const items = rows.map((r) => ({ requestId: r.id as string, label: r.label as string, status: r.status as string, versionId: (r.version_id as string | null) ?? null, sha256: (r.sha256 as string | null) ?? null }));
  return { items, hash: createHash('sha256').update(JSON.stringify(items)).digest('hex') };
}

export interface SubmissionView {
  id: string; versionNo: number; status: 'pending' | 'approved' | 'returned' | 'superseded'; submittedBy: string; submittedAt: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null;
  /** True when the checklist and files are exactly what was submitted. False means something changed afterwards. */
  unchanged: boolean;
  issues: { id: string; text: string; status: 'open' | 'resolved'; raisedBy: string; createdAt: string; resolvedBy: string | null }[];
}
/** none: never submitted. pending/returned: as recorded. approved: signed off and unchanged. stale: signed off, then changed, so the approval no longer counts. */
export type ReviewEffective = 'none' | 'pending' | 'approved' | 'stale' | 'returned';

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);

async function reviewStateIn(tx: Tx, engagementId: string): Promise<{ effective: ReviewEffective; submission: SubmissionView | null }> {
  const [sub] = await tx`select * from review_submission where engagement_id = ${engagementId} order by version_no desc limit 1`;
  if (!sub) return { effective: 'none', submission: null };
  const issues = await tx`select * from review_issue where submission_id = ${sub.id} order by created_at, id`;
  const unchanged = (await currentPackage(tx, engagementId)).hash === sub.package_hash;
  const submission: SubmissionView = {
    id: sub.id, versionNo: sub.version_no, status: sub.status, submittedBy: sub.submitted_by, submittedAt: iso(sub.submitted_at)!, decidedBy: sub.decided_by ?? null,
    decidedAt: iso(sub.decided_at), decisionNote: sub.decision_note ?? null, unchanged,
    issues: issues.map((i) => ({ id: i.id, text: i.text, status: i.status, raisedBy: i.raised_by, createdAt: iso(i.created_at)!, resolvedBy: i.resolved_by ?? null })),
  };
  const effective: ReviewEffective = sub.status === 'approved' ? (unchanged ? 'approved' : 'stale') : sub.status === 'returned' ? 'returned' : 'pending';
  return { effective, submission };
}

/** Used by the close step, inside its own transaction. */
export const reviewStateOf = reviewStateIn;

export async function reviewState(sql: Sql, s: FirmSession, engagementId: string) {
  return inFirm(sql, s, 'engagement.read', async (tx) => { await loadEngagement(tx, s, engagementId); return reviewStateIn(tx, engagementId); });
}

/**
 * The preparer (or a partner or manager) hands the work to the reviewer. Needs a preparer and a different reviewer on the work,
 * and every checklist item accepted or waived. Freezes a snapshot; an earlier waiting submission is superseded.
 */
export async function submitForReview(sql: Sql, s: FirmSession, engagementId: string): Promise<{ id: string; versionNo: number }> {
  return inFirm(sql, s, 'engagement.work', async (tx) => {
    const e = await loadEngagement(tx, s, engagementId);
    if (!e.owner_id || !e.reviewer_id) throw new ValidationError('Choose a preparer and a reviewer for this work first.');
    if (e.status === 'done') throw new ValidationError('This work is already done. Reopen it first.');
    if (e.reviewer_id === s.userId) throw new ValidationError('A reviewer cannot submit work they are reviewing.');
    if (e.owner_id !== s.userId && !seesAllClients(s.role)) throw new ValidationError('Only the preparer, a partner or a manager can submit this work.');
    const pack = await currentPackage(tx, engagementId);
    const open = pack.items.filter((i) => i.status !== 'accepted' && i.status !== 'waived');
    if (open.length) throw new ValidationError(`${open.length} item(s) on the checklist are not accepted or marked not needed yet: ${open.slice(0, 3).map((i) => i.label).join(', ')}${open.length > 3 ? '…' : ''}.`);
    const [{ n }] = (await tx`select coalesce(max(version_no), 0)::int as n from review_submission where engagement_id = ${engagementId}`) as unknown as [{ n: number }];
    await tx`update review_submission set status = 'superseded' where engagement_id = ${engagementId} and status = 'pending'`;
    const [r] = await tx`insert into review_submission (firm_id, engagement_id, version_no, package_hash, snapshot, submitted_by)
                         values (${s.firmId}, ${engagementId}, ${n + 1}, ${pack.hash}, ${tx.json(pack.items as never)}, ${s.userId}) returning id`;
    await tx`update engagement set status = 'in_review', updated_at = now() where id = ${engagementId}`;
    await logFirmEvent(tx, s.firmId, 'review_submitted', { engagementId });
    return { id: r!.id as string, versionNo: n + 1 };
  });
}

async function pendingSubmission(tx: Tx, s: FirmSession, submissionId: string) {
  const [sub] = await tx`select id, engagement_id, status, submitted_by from review_submission where id = ${submissionId} and firm_id = ${s.firmId}`;
  if (!sub) throw new ValidationError('That submission was not found.');
  const e = await loadEngagement(tx, s, sub.engagement_id as string);
  return { sub, e };
}

/** The reviewer (or a partner or manager) raises a point that has to be dealt with before approval. */
export async function raiseIssue(sql: Sql, s: FirmSession, submissionId: string, text: string): Promise<string> {
  const t = (text ?? '').trim();
  if (!t || t.length > 1000) throw new ValidationError('Describe the point (up to 1000 characters).', 'text');
  return inFirm(sql, s, 'engagement.work', async (tx) => {
    const { sub, e } = await pendingSubmission(tx, s, submissionId);
    if (sub.status !== 'pending') throw new ValidationError('Only the version waiting for review can have points raised.');
    if (e.reviewer_id !== s.userId && !seesAllClients(s.role)) throw new ValidationError('Only the reviewer, a partner or a manager can raise points.');
    const [r] = await tx`insert into review_issue (firm_id, submission_id, text, raised_by) values (${s.firmId}, ${submissionId}, ${t}, ${s.userId}) returning id`;
    return r!.id as string;
  });
}

/** Anyone who can work on this client marks a point dealt with. The reviewer still decides whether that is enough. */
export async function resolveIssue(sql: Sql, s: FirmSession, issueId: string): Promise<void> {
  return inFirm(sql, s, 'engagement.work', async (tx) => {
    const [i] = await tx`select submission_id, status from review_issue where id = ${issueId} and firm_id = ${s.firmId}`;
    if (!i) throw new ValidationError('That point was not found.');
    await pendingSubmission(tx, s, i.submission_id as string);
    if (i.status === 'resolved') return;
    await tx`update review_issue set status = 'resolved', resolved_by = ${s.userId}, resolved_at = now() where id = ${issueId}`;
  });
}

/**
 * Approve or return the waiting version. The decider cannot be the person who submitted it. Approval needs every point resolved and
 * the checklist and files to be exactly as submitted. Returning needs a note and puts the work back to "preparing".
 */
export async function decideSubmission(sql: Sql, s: FirmSession, submissionId: string, d: { decision: 'approved' | 'returned'; note?: string | null }): Promise<void> {
  const note = (typeof d.note === 'string' ? d.note : '').trim().slice(0, 1000) || null;
  if (d.decision !== 'approved' && d.decision !== 'returned') throw new ValidationError('Choose approve or send back.', 'decision');
  if (d.decision === 'returned' && !note) throw new ValidationError('Say what needs to change.', 'note');
  return inFirm(sql, s, 'engagement.work', async (tx) => {
    const { sub, e } = await pendingSubmission(tx, s, submissionId);
    if (sub.status !== 'pending') throw new ValidationError('Only the version waiting for review can be decided.');
    if (sub.submitted_by === s.userId) throw new ValidationError('You submitted this version, so someone else has to review it.');
    if (e.reviewer_id !== s.userId && !seesAllClients(s.role)) throw new ValidationError('Only the reviewer, a partner or a manager can decide.');
    if (d.decision === 'approved') {
      const [open] = await tx`select count(*)::int as n from review_issue where submission_id = ${submissionId} and status = 'open'`;
      if ((open!.n as number) > 0) throw new ValidationError(`${open!.n} point(s) are still open.`);
      const [full] = await tx`select package_hash from review_submission where id = ${submissionId}`;
      if ((await currentPackage(tx, sub.engagement_id as string)).hash !== full!.package_hash) throw new ValidationError('The checklist or its files changed after this was submitted. Submit the new version for review.');
    }
    await tx`update review_submission set status = ${d.decision}, decided_by = ${s.userId}, decided_at = now(), decision_note = ${note} where id = ${submissionId}`;
    if (d.decision === 'returned') await tx`update engagement set status = 'preparing', updated_at = now() where id = ${sub.engagement_id}`;
    await logFirmEvent(tx, s.firmId, d.decision === 'approved' ? 'review_approved' : 'review_returned', { engagementId: sub.engagement_id as string });
  });
}
