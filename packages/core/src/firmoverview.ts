import type { Sql, Tx } from '@kora/db';
import { inFirm, seesAllClients, type FirmSession } from './firmtenancy.js';
import { loadEngagement } from './firmwork.js';
import { ValidationError } from './validation.js';

// ---------------------------------------------------------------- the questions a partner asks every morning

export type EngagementView = 'due_soon' | 'passed' | 'no_date' | 'blocked' | 'blocked_client' | 'in_review' | 'filing_missing' | 'unassigned' | 'unbilled';
export const ENGAGEMENT_VIEWS: EngagementView[] = ['due_soon', 'passed', 'no_date', 'blocked', 'blocked_client', 'in_review', 'filing_missing', 'unassigned', 'unbilled'];

/** The SQL condition for one view of the work, on engagement alias `e`. "Today" is the date in India, whatever the server's clock says. */
export function viewFilter(t: Tx, v: EngagementView) {
  const today = t`(now() at time zone 'Asia/Kolkata')::date`;
  switch (v) {
    case 'due_soon': return t`e.status <> 'done' and e.statutory_deadline between ${today} and ${today} + 5`;
    case 'passed': return t`e.status <> 'done' and e.statutory_deadline < ${today}`;
    case 'no_date': return t`e.status <> 'done' and e.statutory_deadline is null`;
    case 'blocked': return t`e.status <> 'done' and e.blocker_reason is not null`;
    case 'blocked_client': return t`e.status <> 'done' and e.blocker_party = 'client'`;
    case 'in_review': return t`e.status = 'in_review'`;
    // The reviewer approved the latest version, but no filing has been recorded yet.
    case 'filing_missing': return t`e.status <> 'done' and exists (select 1 from review_submission r where r.engagement_id = e.id and r.status = 'approved'
                                      and r.version_no = (select max(version_no) from review_submission where engagement_id = e.id))
                                    and not exists (select 1 from filing_evidence x where x.engagement_id = e.id)`;
    case 'unassigned': return t`e.status <> 'done' and e.owner_id is null`;
    // Finished work with no fee billed, paid or waived. Work with no fee recorded at all counts too: nobody decided what to charge.
    case 'unbilled': return t`e.status = 'done' and not exists (select 1 from fee_item f where f.engagement_id = e.id and f.status in ('billed', 'paid', 'waived'))`;
  }
}

export interface Overview { asOf: string; counts: Record<EngagementView, number>; unbilledPaise: string; billedNotPaidPaise: string }

/** The counts behind the cards, for the work this person may see. Every number can be opened as the list it counts (listEngagements with the same view). */
export async function firmOverview(sql: Sql, s: FirmSession): Promise<Overview> {
  const all = seesAllClients(s.role);
  return inFirm(sql, s, 'engagement.read', async (tx) => {
    const scope = all ? tx`` : tx`and exists (select 1 from client_assignment a where a.client_id = e.client_id and a.user_id = ${s.userId})`;
    const counts = {} as Record<EngagementView, number>;
    for (const v of ENGAGEMENT_VIEWS) {
      const [r] = await tx`select count(*)::int as n from engagement e where e.firm_id = ${s.firmId} and ${viewFilter(tx, v)} ${scope}`;
      counts[v] = r!.n as number;
    }
    const [f] = await tx`select coalesce(sum(f.amount_paise) filter (where f.status = 'unbilled'), 0)::text as unbilled,
                                coalesce(sum(f.amount_paise) filter (where f.status = 'billed'), 0)::text as billed
                           from fee_item f join engagement e on e.id = f.engagement_id where f.firm_id = ${s.firmId} ${scope}`;
    return { asOf: new Date().toISOString(), counts, unbilledPaise: f!.unbilled as string, billedNotPaidPaise: f!.billed as string };
  });
}

// ---------------------------------------------------------------- what happened, for the measurements

export type FirmEventKind = 'request_created' | 'file_received' | 'reminder_queued' | 'request_accepted' | 'request_returned' | 'request_waived' | 'request_reopened'
  | 'review_submitted' | 'review_approved' | 'review_returned' | 'engagement_closed' | 'engagement_reopened' | 'link_created';

/** Writes one line to the firm's event log, inside the caller's transaction. Counts and times only. */
export async function logFirmEvent(tx: Tx, firmId: string, kind: FirmEventKind, ref: { engagementId?: string | null; requestId?: string | null; via?: 'link' | 'staff' | 'system' } = {}): Promise<void> {
  await tx`insert into firm_event (firm_id, engagement_id, request_id, kind, via) values (${firmId}, ${ref.engagementId ?? null}, ${ref.requestId ?? null}, ${kind}, ${ref.via ?? null})`;
}

export interface PilotMetrics {
  days: number;
  closed: number;
  /** Median days from the work being created to it being closed. null = nothing closed in the period, which is not the same as 0. */
  medianDaysToClose: number | null;
  /** Median hours from a version being sent for review to the reviewer deciding. */
  medianReviewHours: number | null;
  /** Median days from a document being asked for to it being accepted. */
  medianRequestDays: number | null;
  /** Reminders queued per document request asked for in the period. null when nothing was asked. */
  remindersPerRequest: number | null;
  reviewsReturned: number;
  reviewsDecided: number;
  reopened: number;
  filesViaClientLink: number;
  filesAddedByStaff: number;
}

/** Firm-wide figures for the pilot: how long work takes, how often it comes back, how many reminders it needed. Never per person. */
export async function pilotMetrics(sql: Sql, s: FirmSession, days = 90): Promise<PilotMetrics> {
  if (!Number.isInteger(days) || days < 1 || days > 730) throw new ValidationError('Choose between 1 and 730 days.', 'days');
  if (!seesAllClients(s.role)) throw new ValidationError('Only a partner or a manager can see the firm\'s figures.');
  return inFirm(sql, s, 'engagement.write', async (tx) => {
    const since = tx`now() - ${days + ' days'}::interval`;
    const num = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
    const [closed] = await tx`select count(*)::int as n,
        percentile_cont(0.5) within group (order by extract(epoch from (ev.at - e.created_at)) / 86400) as med
      from firm_event ev join engagement e on e.id = ev.engagement_id where ev.firm_id = ${s.firmId} and ev.kind = 'engagement_closed' and ev.at >= ${since}`;
    const [review] = await tx`select count(*) filter (where status in ('approved', 'returned'))::int as decided, count(*) filter (where status = 'returned')::int as returned,
        percentile_cont(0.5) within group (order by extract(epoch from (decided_at - submitted_at)) / 3600) filter (where decided_at is not null) as med
      from review_submission where firm_id = ${s.firmId} and submitted_at >= ${since}`;
    const [req] = await tx`select percentile_cont(0.5) within group (order by extract(epoch from (a.at - r.created_at)) / 86400) as med
      from firm_event a join document_request r on r.id = a.request_id where a.firm_id = ${s.firmId} and a.kind = 'request_accepted' and a.at >= ${since}`;
    const [rem] = await tx`select (select count(*) from firm_event where firm_id = ${s.firmId} and kind = 'reminder_queued' and at >= ${since})::float8 as reminders,
        (select count(*) from document_request where firm_id = ${s.firmId} and created_at >= ${since})::float8 as asked`;
    const [other] = await tx`select count(*) filter (where kind = 'engagement_reopened')::int as reopened,
        count(*) filter (where kind = 'file_received' and via = 'link')::int as via_link, count(*) filter (where kind = 'file_received' and via = 'staff')::int as via_staff
      from firm_event where firm_id = ${s.firmId} and at >= ${since}`;
    return {
      days, closed: closed!.n as number, medianDaysToClose: num(closed!.med), medianReviewHours: num(review!.med), medianRequestDays: num(req!.med),
      remindersPerRequest: (rem!.asked as number) > 0 ? Math.round(((rem!.reminders as number) / (rem!.asked as number)) * 100) / 100 : null,
      reviewsReturned: review!.returned as number, reviewsDecided: review!.decided as number, reopened: other!.reopened as number,
      filesViaClientLink: other!.via_link as number, filesAddedByStaff: other!.via_staff as number,
    };
  });
}

// ---------------------------------------------------------------- the firm's fee for a piece of work

export type FeeStatus = 'unbilled' | 'billed' | 'paid' | 'waived';
export interface Fee { amountPaise: string; description: string; status: FeeStatus; reference: string | null; billedOn: string | null; paidOn: string | null; waivedReason: string | null }
const day = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : null);
const RUPEES = /^\d{1,9}(\.\d{1,2})?$/;
const toPaise = (v: string) => { const [r, p = ''] = v.split('.'); return BigInt(r!) * 100n + BigInt((p + '00').slice(0, 2)); };

async function feeEngagement(tx: Tx, s: FirmSession, engagementId: string) {
  const e = await loadEngagement(tx, s, engagementId);
  return e;
}

export async function getFee(sql: Sql, s: FirmSession, engagementId: string): Promise<Fee | null> {
  return inFirm(sql, s, 'engagement.read', async (tx) => {
    await feeEngagement(tx, s, engagementId);
    const [f] = await tx`select * from fee_item where engagement_id = ${engagementId}`;
    return f ? { amountPaise: String(f.amount_paise), description: f.description, status: f.status, reference: f.reference, billedOn: day(f.billed_on), paidOn: day(f.paid_on), waivedReason: f.waived_reason } : null;
  });
}

/** Sets or changes the agreed fee (in rupees). Only while it has not been billed. Partners and managers. */
export async function setFee(sql: Sql, s: FirmSession, engagementId: string, f: { amount: string; description?: string }): Promise<void> {
  const amount = String(f.amount ?? '').trim();
  if (!RUPEES.test(amount)) throw new ValidationError('Enter the fee in rupees, for example 2500 or 2500.50.', 'amount');
  const description = (typeof f.description === 'string' ? f.description : '').trim().slice(0, 200);
  return inFirm(sql, s, 'engagement.write', async (tx) => {
    const e = await feeEngagement(tx, s, engagementId);
    const [cur] = await tx`select status from fee_item where engagement_id = ${engagementId}`;
    if (cur && cur.status !== 'unbilled') throw new ValidationError('This fee has already been billed or settled.');
    await tx`insert into fee_item (firm_id, engagement_id, client_id, amount_paise, description, created_by) values (${s.firmId}, ${engagementId}, ${e.client_id}, ${toPaise(amount).toString()}, ${description}, ${s.userId})
             on conflict (engagement_id) do update set amount_paise = excluded.amount_paise, description = excluded.description, updated_at = now()`;
  });
}

/** Records that the fee was invoiced (the invoice itself is made in the firm's own Kora business), with its number. */
export async function markFeeBilled(sql: Sql, s: FirmSession, engagementId: string, b: { reference: string; billedOn?: string }): Promise<void> {
  const reference = (typeof b.reference === 'string' ? b.reference : '').trim();
  if (!reference || reference.length > 60) throw new ValidationError('Enter the invoice number (up to 60 characters).', 'reference');
  const on = b.billedOn ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) throw new ValidationError('Dates must look like 2026-10-20.', 'billedOn');
  return inFirm(sql, s, 'engagement.write', async (tx) => {
    await feeEngagement(tx, s, engagementId);
    const r = await tx`update fee_item set status = 'billed', reference = ${reference}, billed_on = ${on}, updated_at = now() where engagement_id = ${engagementId} and status = 'unbilled' returning id`;
    if (!r.length) throw new ValidationError('Set the fee first, and bill it only once.');
  });
}

export async function markFeePaid(sql: Sql, s: FirmSession, engagementId: string, paidOn?: string): Promise<void> {
  const on = paidOn ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) throw new ValidationError('Dates must look like 2026-10-20.', 'paidOn');
  return inFirm(sql, s, 'engagement.write', async (tx) => {
    await feeEngagement(tx, s, engagementId);
    const r = await tx`update fee_item set status = 'paid', paid_on = ${on}, updated_at = now() where engagement_id = ${engagementId} and status = 'billed' returning id`;
    if (!r.length) throw new ValidationError('Only a billed fee can be marked paid.');
  });
}

/** No fee for this work (included in a retainer, a goodwill job). A reason is kept so it is a decision, not an oversight. */
export async function waiveFee(sql: Sql, s: FirmSession, engagementId: string, reason: string): Promise<void> {
  const why = (typeof reason === 'string' ? reason : '').trim().slice(0, 300);
  if (!why) throw new ValidationError('Say why there is no fee for this work.', 'reason');
  return inFirm(sql, s, 'engagement.write', async (tx) => {
    const e = await feeEngagement(tx, s, engagementId);
    const [cur] = await tx`select status from fee_item where engagement_id = ${engagementId}`;
    if (cur && cur.status !== 'unbilled') throw new ValidationError('This fee has already been billed or settled.');
    await tx`insert into fee_item (firm_id, engagement_id, client_id, amount_paise, status, waived_reason, created_by) values (${s.firmId}, ${engagementId}, ${e.client_id}, 0, 'waived', ${why}, ${s.userId})
             on conflict (engagement_id) do update set status = 'waived', waived_reason = ${why}, amount_paise = 0, updated_at = now()`;
  });
}

