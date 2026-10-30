import { createHash, randomBytes } from 'node:crypto';
import type { Messenger } from '@kora/adapters';
import { SYSTEM_USER, withFirm, type Sql, type Tx } from '@kora/db';
import { FORM_NAME, generateEngagementsIn, type Service } from './firmengagement.js';
import { planRemindersIn } from './firmreview.js';
import { log } from './observe.js';

/** The month before this one, in India: the month whose returns are being prepared. */
export function previousPeriod(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Runs fn as the system actor, which is what lets a job see across firms (only the listed database functions answer to it). */
async function asSystem<T>(sql: Sql, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${SYSTEM_USER}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
const inFirmAsSystem = <T>(sql: Sql, firmId: string, fn: (tx: Tx) => Promise<T>) => withFirm(sql, { firmId, userId: SYSTEM_USER }, fn);

/**
 * Creates last month's GSTR-1 and GSTR-3B work for every firm that does not have it yet, so a partner opens the screen on the 1st and finds
 * it there. Safe to run any number of times: it is remembered per firm (last_generated_period), and the generator itself never makes a duplicate.
 * One firm failing is logged and does not stop the others.
 */
export async function processFirmMonthly(sql: Sql, now: Date = new Date()): Promise<{ period: string; firms: number; created: number; failed: number }> {
  const period = previousPeriod(now);
  const ids = (await asSystem(sql, (tx) => tx`select id from firms_needing_month(${period})`)).map((r) => r.id as string);
  let created = 0, failed = 0;
  for (const id of ids) {
    try {
      created += await inFirmAsSystem(sql, id, async (tx) => {
        const r = await generateEngagementsIn(tx, id, period);
        await tx`select mark_firm_generated(${id}, ${period})`;
        return r.created;
      });
    } catch (e) {
      failed++;
      log('error', 'firm.monthly_failed', { firm: id, period, message: String((e as Error).message ?? e).slice(0, 200) });
    }
  }
  return { period, firms: ids.length, created, failed };
}

const LINK_DAYS = 14;
const MAX_LIVE_LINKS = 3;
const hashToken = (t: string) => createHash('sha256').update(t.trim()).digest('hex');

/**
 * A fresh client link for a reminder. The raw token is never stored, so an earlier link cannot be resent; the newest few stay valid,
 * so a client who still has an older message is not locked out by a newer reminder.
 */
async function reminderLink(tx: Tx, firmId: string, engagementId: string): Promise<string> {
  const live = await tx`select id from upload_link where engagement_id = ${engagementId} and revoked_at is null and expires_at > now() order by created_at asc`;
  for (const old of live.slice(0, Math.max(0, live.length - (MAX_LIVE_LINKS - 1)))) await tx`update upload_link set revoked_at = now() where id = ${old.id}`;
  const token = randomBytes(24).toString('base64url');
  await tx`insert into upload_link (firm_id, engagement_id, token_hash, expires_at, created_by) values (${firmId}, ${engagementId}, ${hashToken(token)}, now() + ${LINK_DAYS + ' days'}::interval, null)`;
  return token;
}

export interface ReminderRun { planned: number; cancelled: number; sent: number; failed: number }

/**
 * The reminder cycle for every firm: decide who needs one (the same rules as the Queue reminders button), then send each queued reminder to the
 * client contact the firm entered, by email, or by WhatsApp when only a phone is on file. A reminder is settled as sent before it goes out, so a
 * crash can lose one reminder but never send the same one twice; a send that fails is recorded as failed with the reason.
 */
export async function processFirmReminders(sql: Sql, deps: { messenger: Messenger; appUrl: string }, now: Date = new Date()): Promise<ReminderRun> {
  const out: ReminderRun = { planned: 0, cancelled: 0, sent: 0, failed: 0 };
  const openFirms = (await asSystem(sql, (tx) => tx`select id from firms_with_open_requests()`)).map((r) => r.id as string);
  for (const id of openFirms) {
    try { const r = await inFirmAsSystem(sql, id, (tx) => planRemindersIn(tx, id, now)); out.planned += r.queued; out.cancelled += r.cancelled; }
    catch (e) { log('error', 'firm.reminder_plan_failed', { firm: id, message: String((e as Error).message ?? e).slice(0, 200) }); }
  }
  const sendFirms = (await asSystem(sql, (tx) => tx`select id from firms_with_queued_reminders()`)).map((r) => r.id as string);
  for (const id of sendFirms) {
    const rows = await inFirmAsSystem(sql, id, (tx) => tx`
      select q.id, r.label, r.engagement_id, e.service, e.period, c.legal_name, c.contact_name, c.contact_email, c.contact_phone, f.name as firm_name
        from request_reminder q join document_request r on r.id = q.request_id join engagement e on e.id = r.engagement_id
        join client_entity c on c.id = r.client_id join firm f on f.id = q.firm_id
       where q.firm_id = ${id} and q.status = 'queued' and r.status in ('requested', 'needs_correction') and e.status <> 'done' order by q.created_at limit 50`);
    // One message per piece of work, listing everything still missing, so a client is not sent three emails at once.
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) groups.set(row.engagement_id as string, [...(groups.get(row.engagement_id as string) ?? []), row]);
    for (const [engagementId, items] of groups) {
      const first = items[0]!;
      const to = (first.contact_email as string) || (first.contact_phone as string);
      if (!to) continue;
      const ids = items.map((i) => i.id as string);
      const claimed = await inFirmAsSystem(sql, id, (tx) => tx`update request_reminder set status = 'sent', settled_at = now() where id = any(${ids}) and status = 'queued' returning id`);
      if (!claimed.length) continue;
      try {
        const token = await inFirmAsSystem(sql, id, (tx) => reminderLink(tx, id, engagementId));
        const url = `${deps.appUrl}/send/${token}`;
        const who = (first.contact_name as string) || 'there';
        const work = `${FORM_NAME[first.service as Service]} for ${first.period}`;
        const list = items.map((i) => `"${i.label}"`).join(', ');
        const text = `Hello ${who}, ${first.firm_name} is still waiting for ${list} for ${first.legal_name} (${work}). You can send ${items.length === 1 ? 'it' : 'them'} here, with no sign-in: ${url} . The link works for ${LINK_DAYS} days.`;
        if (first.contact_email) await deps.messenger.sendEmail({ to, subject: `${first.firm_name}: ${items.length === 1 ? `${items[0]!.label} is` : `${items.length} documents are`} still needed`, text, documentUrl: url });
        else await deps.messenger.sendWhatsApp({ to, text, documentUrl: url });
        out.sent += claimed.length;
      } catch (e) {
        out.failed += claimed.length;
        await inFirmAsSystem(sql, id, (tx) => tx`update request_reminder set status = 'failed', error = ${String((e as Error).message ?? e).slice(0, 300)} where id = any(${claimed.map((c) => c.id as string)})`);
      }
    }
  }
  return out;
}

/** What the tick calls. Each part is guarded, so a problem in one never stops the rest of the background work. */
export async function processFirmWork(sql: Sql, deps: { messenger: Messenger; appUrl: string }, now: Date = new Date()) {
  const guard = async <T>(name: string, fn: () => Promise<T>): Promise<T | { error: string }> => {
    try { return await fn(); } catch (e) { log('error', `firm.${name}_failed`, { message: String((e as Error).message ?? e).slice(0, 200) }); return { error: 'failed' }; }
  };
  return { monthly: await guard('monthly', () => processFirmMonthly(sql, now)), reminders: await guard('reminders', () => processFirmReminders(sql, deps, now)) };
}
