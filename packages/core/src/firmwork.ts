import type { Sql, Tx } from '@kora/db';
import { assertClientAccess } from './firmclients.js';
import type { EngagementStatus } from './firmengagement.js';
import { inFirm, seesAllClients, type FirmSession } from './firmtenancy.js';
import { ValidationError } from './validation.js';

export type BlockerParty = 'client' | 'firm' | 'third_party';
const PARTIES: BlockerParty[] = ['client', 'firm', 'third_party'];
const STATUSES: EngagementStatus[] = ['open', 'preparing', 'in_review', 'done'];

/** Loads an engagement and checks this person may work on its client. The one gate for every action below. */
export async function loadEngagement(tx: Tx, s: FirmSession, id: string) {
  const [e] = await tx`select id, client_id, owner_id, reviewer_id, status from engagement where id = ${id} and firm_id = ${s.firmId}`;
  if (!e) throw new ValidationError('That engagement was not found.');
  await assertClientAccess(tx, s, e.client_id as string);
  return e;
}

async function assertActiveMember(tx: Tx, s: FirmSession, userId: string, what: string) {
  const [m] = await tx`select 1 as ok from firm_member where firm_id = ${s.firmId} and user_id = ${userId} and active`;
  if (!m) throw new ValidationError(`The ${what} must be an active member of your firm.`);
}

/** Partner or manager: choose who prepares and who reviews. They must be different people. Pass null to clear, leave out to keep. */
export async function assignEngagement(sql: Sql, s: FirmSession, id: string, a: { ownerId?: string | null; reviewerId?: string | null }): Promise<void> {
  return inFirm(sql, s, 'engagement.write', async (tx) => {
    const e = await loadEngagement(tx, s, id);
    const owner = a.ownerId === undefined ? (e.owner_id as string | null) : a.ownerId;
    const reviewer = a.reviewerId === undefined ? (e.reviewer_id as string | null) : a.reviewerId;
    if (owner && reviewer && owner === reviewer) throw new ValidationError('The preparer and the reviewer must be different people.');
    if (a.ownerId) await assertActiveMember(tx, s, a.ownerId, 'preparer');
    if (a.reviewerId) await assertActiveMember(tx, s, a.reviewerId, 'reviewer');
    await tx`update engagement set owner_id = ${owner}, reviewer_id = ${reviewer}, updated_at = now() where id = ${id}`;
  });
}

/**
 * Moves the work along. Anyone who can see the client may mark it open, preparing or in review; only a partner, a manager or the
 * assigned reviewer may mark it done. Moving back out of done also needs one of them.
 */
export async function setEngagementStatus(sql: Sql, s: FirmSession, id: string, status: EngagementStatus): Promise<void> {
  if (!STATUSES.includes(status)) throw new ValidationError(`Status must be one of ${STATUSES.join(', ')}.`, 'status');
  return inFirm(sql, s, 'engagement.work', async (tx) => {
    const e = await loadEngagement(tx, s, id);
    const closer = seesAllClients(s.role) || e.reviewer_id === s.userId;
    if ((status === 'done' || e.status === 'done') && !closer) throw new ValidationError('Only a partner, a manager or the assigned reviewer can mark work done or reopen it.');
    await tx`update engagement set status = ${status}, updated_at = now() where id = ${id}`;
  });
}

/** Records what is holding the work up, who it is waiting on and what happens next. Replaces any earlier blocker. */
export async function setBlocker(sql: Sql, s: FirmSession, id: string, b: { reason: string; party: BlockerParty; nextAction?: string; expected?: string | null }): Promise<void> {
  const reason = (b.reason ?? '').trim();
  if (!reason || reason.length > 500) throw new ValidationError('Say what is holding this up (up to 500 characters).', 'reason');
  if (!PARTIES.includes(b.party)) throw new ValidationError('Say who it is waiting on: client, firm or third_party.', 'party');
  if (b.expected && !/^\d{4}-\d{2}-\d{2}$/.test(b.expected)) throw new ValidationError('Dates must look like 2026-10-20.', 'expected');
  return inFirm(sql, s, 'engagement.work', async (tx) => {
    await loadEngagement(tx, s, id);
    await tx`update engagement set blocker_reason = ${reason}, blocker_party = ${b.party}, blocker_next_action = ${(b.nextAction ?? '').trim().slice(0, 500) || null},
             blocker_expected = ${b.expected ?? null}, blocker_since = coalesce(blocker_since, now()), updated_at = now() where id = ${id}`;
  });
}

export async function clearBlocker(sql: Sql, s: FirmSession, id: string): Promise<void> {
  return inFirm(sql, s, 'engagement.work', async (tx) => {
    await loadEngagement(tx, s, id);
    await tx`update engagement set blocker_reason = null, blocker_party = null, blocker_next_action = null, blocker_expected = null, blocker_since = null, updated_at = now() where id = ${id}`;
  });
}
