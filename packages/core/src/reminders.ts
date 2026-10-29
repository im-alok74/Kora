import { requireFeature } from './plans.js';
import type { Sql, Tx } from '@kora/db';
import { SYSTEM_USER, withTenant } from '@kora/db';
import { enqueue } from './jobs.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { ValidationError } from './validation.js';
import { queueDocumentSend, type SendChannel } from './delivery.js';

export interface ReminderConfig { enabled: boolean; channel: SendChannel; offsets: number[] }
export const DEFAULT_REMINDERS: ReminderConfig = { enabled: false, channel: 'whatsapp', offsets: [-2, 3, 7] };

export function sanitiseReminderConfig(raw: unknown): ReminderConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const channel = r.channel === undefined ? DEFAULT_REMINDERS.channel : r.channel;
  if (channel !== 'whatsapp' && channel !== 'sms' && channel !== 'email') throw new ValidationError('Choose WhatsApp, SMS or email.', 'channel');
  const offsets = r.offsets === undefined ? DEFAULT_REMINDERS.offsets : r.offsets;
  if (!Array.isArray(offsets) || offsets.length > 6 || offsets.some((o) => !Number.isInteger(o) || o < -30 || o > 90)) {
    throw new ValidationError('Reminders can be up to 6, each between 30 days before and 90 days after the due date.', 'offsets');
  }
  return { enabled: r.enabled === true, channel, offsets: [...new Set(offsets as number[])].sort((a, b) => a - b) };
}

export async function getReminderConfig(sql: Sql, t: TenantSession): Promise<ReminderConfig> {
  const rows = await inTenant(sql, t, 'document.read', (tx) => tx`select reminder_config from business where id = ${t.businessId}`);
  return sanitiseReminderConfig(rows[0]?.reminder_config);
}

export async function saveReminderConfig(sql: Sql, t: TenantSession, input: unknown): Promise<ReminderConfig> {
  const cfg = sanitiseReminderConfig(input);
  await inTenant(sql, t, 'settings.write', async (tx) => {
    if (cfg.enabled) await requireFeature(tx, t.businessId, 'reminders');
    await tx`update business set reminder_config = ${tx.json(cfg as any)} where id = ${t.businessId}`;
  });
  return cfg;
}

/** 10:00 India time on (dueDate + offset days), as a UTC instant. */
export function reminderTime(dueDate: string, offsetDays: number): Date {
  const [y, m, d] = dueDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + offsetDays, 4, 30));
}

/** Called when a document is issued. Only future reminders are created. */
export async function scheduleReminders(tx: Tx, doc: { id: string; business_id: string; doc_type: string; due_date: string | null }, now = new Date()): Promise<number> {
  if (!doc.due_date || !['tax_invoice', 'bill_of_supply', 'debit_note'].includes(doc.doc_type)) return 0;
  const [b] = await tx`select b.reminder_config, p.reminder_override from business b
                         left join document d on d.id = ${doc.id} left join party p on p.id = d.party_id where b.id = ${doc.business_id}`;
  const cfg = sanitiseReminderConfig(b?.reminder_override ?? b?.reminder_config);
  if (!cfg.enabled) return 0;
  let n = 0;
  for (const off of cfg.offsets) {
    const at = reminderTime(doc.due_date, off);
    if (at <= now) continue;
    await tx`insert into reminder (business_id, document_id, channel, scheduled_at) values (${doc.business_id}, ${doc.id}, ${cfg.channel}, ${at})`;
    n++;
  }
  return n;
}

/**
 * Worker tick. Finds reminders that are due, skips any whose invoice has been paid, and hands the rest to the
 * send queue. The send itself has the retry and backoff.
 */
export async function processDueReminders(sql: Sql, limit = 50): Promise<{ queued: number; skipped: number }> {
  const due = await sql`select id, business_id, document_id from due_reminders(${limit})`;
  let queued = 0, skipped = 0;
  for (const r of due) {
    await withTenant(sql, { businessId: r.business_id as string, userId: SYSTEM_USER }, async (tx) => {
      const [rem] = await tx`select id, channel from reminder where id = ${r.id} and delivery_status = 'scheduled' for update skip locked`;
      if (!rem) return;
      const [d] = await tx`select d.status, d.grand_total_paise, d.amount_settled_paise, p.phone, p.email
                             from document d left join party p on p.id = d.party_id where d.id = ${r.document_id}`;
      if (!d || d.status !== 'issued' || BigInt(d.grand_total_paise as string) <= BigInt(d.amount_settled_paise as string)) {
        await tx`update reminder set delivery_status = 'cancelled' where id = ${r.id}`; skipped++; return;
      }
      const to = (rem.channel === 'email' ? d.email : d.phone) as string | null;
      if (!to) {
        await tx`update reminder set delivery_status = 'failed', error_message = 'The customer has no contact for this channel.' where id = ${r.id}`; skipped++; return;
      }
      const [del] = await tx`insert into delivery (business_id, document_id, channel, to_address, status)
                             values (${r.business_id}, ${r.document_id}, ${rem.channel}, ${to}, 'queued') returning id`;
      await enqueue(tx, 'delivery.send', { deliveryId: del!.id, documentId: r.document_id, channel: rem.channel, to, reminderId: r.id },
        { businessId: r.business_id as string, dedupeKey: `reminder:${r.id}` });
      await tx`update reminder set delivery_status = 'queued' where id = ${r.id}`;
      queued++;
    });
  }
  return { queued, skipped };
}

export async function listReminders(sql: Sql, t: TenantSession, documentId: string) {
  return inTenant(sql, t, 'document.read', (tx) => tx`select id, channel, scheduled_at, delivery_status, error_message from reminder where document_id = ${documentId} order by scheduled_at`);
}

/** "Send a reminder now" from the invoice screen. Recorded as a reminder so it shows in the history. */
export async function sendReminderNow(sql: Sql, t: TenantSession, a: { documentId: string; channel: SendChannel; to: string }) {
  const outstanding = await inTenant(sql, t, 'document.issue', async (tx) => {
    const [d] = await tx`select status, doc_type, grand_total_paise, amount_settled_paise from document where id = ${a.documentId}`;
    if (!d || d.status !== 'issued' || !['tax_invoice', 'bill_of_supply', 'debit_note'].includes(d.doc_type as string)) throw new ValidationError('Reminders are for issued invoices.');
    return BigInt(d.grand_total_paise as string) - BigInt(d.amount_settled_paise as string);
  });
  if (outstanding <= 0n) throw new ValidationError('This invoice is already paid.');
  const reminderId = await inTenant(sql, t, 'document.issue', async (tx) => {
    const [r] = await tx`insert into reminder (business_id, document_id, channel, scheduled_at, delivery_status)
                         values (${t.businessId}, ${a.documentId}, ${a.channel}, now(), 'queued') returning id`;
    return r!.id as string;
  });
  return queueDocumentSend(sql, t, { ...a, reminderId });
}
