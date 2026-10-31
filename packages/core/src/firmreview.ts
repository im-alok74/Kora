import type { Sql, Tx } from '@kora/db';
import { logFirmEvent } from './firmoverview.js';
import { inFirm, type FirmSession } from './firmtenancy.js';
import { loadEngagement } from './firmwork.js';
import { ValidationError } from './validation.js';

export type ReviewDecision = 'accepted' | 'needs_correction' | 'waived' | 'requested';

/**
 * A firm member decides what to do with one checklist item.
 *   accepted          needs a file to have been received
 *   needs_correction  sent back; a reason is required so the client knows what to send instead
 *   waived            not needed this time; a reason is required so it is on the record
 *   requested         reopens an item that was accepted, waived or sent back
 */
export async function reviewRequest(sql: Sql, s: FirmSession, requestId: string, d: { decision: ReviewDecision; reason?: string | null }): Promise<void> {
  const reason = (typeof d.reason === 'string' ? d.reason : '').trim().slice(0, 500) || null;
  if (!['accepted', 'needs_correction', 'waived', 'requested'].includes(d.decision)) throw new ValidationError('Choose accept, send back, not needed or reopen.', 'decision');
  if ((d.decision === 'needs_correction' || d.decision === 'waived') && !reason) throw new ValidationError(d.decision === 'waived' ? 'Say why this is not needed.' : 'Say what is wrong, so the client knows what to send instead.', 'reason');
  return inFirm(sql, s, 'engagement.work', async (tx) => {
    const [r] = await tx`select id, engagement_id, status from document_request where id = ${requestId} and firm_id = ${s.firmId}`;
    if (!r) throw new ValidationError('That item was not found.');
    await loadEngagement(tx, s, r.engagement_id as string);
    if (d.decision === 'accepted') {
      const [v] = await tx`select 1 as ok from document_version where request_id = ${requestId} limit 1`;
      if (!v) throw new ValidationError('Nothing has been received for this item yet.');
    }
    await tx`update document_request set status = ${d.decision}, reason = ${d.decision === 'needs_correction' || d.decision === 'waived' ? reason : null}, updated_at = now() where id = ${requestId}`;
    const kind = ({ accepted: 'request_accepted', needs_correction: 'request_returned', waived: 'request_waived', requested: 'request_reopened' } as const)[d.decision];
    await logFirmEvent(tx, s.firmId, kind, { engagementId: r.engagement_id as string, requestId });
  });
}

// ---------------------------------------------------------------- reminders

export const REMIND_FIRST_AFTER_DAYS = 2;
export const REMIND_EVERY_DAYS = 3;
export const REMIND_MAX = 4;

/**
 * Decides which open items now deserve a reminder and queues one for each. An item qualifies when it is still waiting on the client,
 * its work is not done, the client has an email or phone on file and a live link exists to send. The first reminder comes two days
 * after the item was asked for or sent back, then one every three days, at most four. Queued reminders for items that have since been
 * dealt with are cancelled, so a file that arrives stops the next one. Running it twice in a row queues nothing new.
 * This only records the decision. Nothing is sent until a sender picks the row up and calls markReminder.
 */
export async function planReminders(sql: Sql, s: FirmSession, now: Date = new Date()): Promise<{ queued: number; cancelled: number }> {
  return inFirm(sql, s, 'engagement.write', (tx) => planRemindersIn(tx, s.firmId, now));
}

/** The same planning inside a transaction already open for the firm, for the scheduled job. */
export async function planRemindersIn(tx: Tx, firmId: string, now: Date = new Date()): Promise<{ queued: number; cancelled: number }> {
    const cancelled = await tx`
      update request_reminder set status = 'cancelled', settled_at = ${now}
       where firm_id = ${firmId} and status = 'queued'
         and request_id in (select r.id from document_request r join engagement e on e.id = r.engagement_id
                             where r.status not in ('requested', 'needs_correction') or e.status = 'done')
       returning id`;
    const queued = await tx`
      insert into request_reminder (firm_id, request_id, seq)
      select ${firmId}, r.id, coalesce(x.n, 0) + 1
        from document_request r
        join engagement e on e.id = r.engagement_id
        join client_entity c on c.id = r.client_id
        left join lateral (select count(*)::int as n, max(created_at) as last, bool_or(status = 'queued') as pending from request_reminder q where q.request_id = r.id) x on true
       where r.firm_id = ${firmId} and r.status in ('requested', 'needs_correction') and e.status <> 'done'
         and (c.contact_email <> '' or c.contact_phone <> '')
         and exists (select 1 from upload_link l where l.engagement_id = e.id and l.revoked_at is null and l.expires_at > ${now})
         and coalesce(x.n, 0) < ${REMIND_MAX} and not coalesce(x.pending, false)
         and (case when coalesce(x.n, 0) = 0 then r.updated_at <= ${now}::timestamptz - ${REMIND_FIRST_AFTER_DAYS + ' days'}::interval
                   else x.last <= ${now}::timestamptz - ${REMIND_EVERY_DAYS + ' days'}::interval end)
      on conflict (request_id, seq) do nothing
      returning id, request_id`;
    for (const q of queued) await logFirmEvent(tx, firmId, 'reminder_queued', { requestId: q.request_id as string, via: 'system' });
    return { queued: queued.length, cancelled: cancelled.length };
}

/** A sender records what happened to a queued reminder. Only a queued one can be settled. */
export async function markReminder(sql: Sql, s: FirmSession, id: string, outcome: { ok: boolean; error?: string }): Promise<void> {
  return inFirm(sql, s, 'engagement.write', async (tx) => {
    const r = await tx`update request_reminder set status = ${outcome.ok ? 'sent' : 'failed'}, error = ${outcome.ok ? null : (outcome.error ?? 'Not sent').slice(0, 300)}, settled_at = now()
                        where id = ${id} and firm_id = ${s.firmId} and status = 'queued' returning id`;
    if (!r.length) throw new ValidationError('That reminder is not waiting to be sent.');
  });
}

export async function reminderSummary(sql: Sql, s: FirmSession): Promise<{ queued: number; sent: number; failed: number }> {
  return inFirm(sql, s, 'engagement.read', async (tx) => {
    const rows = await tx`select status, count(*)::int as n from request_reminder where firm_id = ${s.firmId} group by status`;
    const n = (k: string) => (rows.find((r) => r.status === k)?.n as number | undefined) ?? 0;
    return { queued: n('queued'), sent: n('sent'), failed: n('failed') };
  });
}
