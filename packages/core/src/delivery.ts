import { createHash, randomBytes } from 'node:crypto';
import { formatMoney } from '@kora/tax';
import type { Messenger } from '@kora/adapters';
import { SYSTEM_USER, withTenant, type Sql } from '@kora/db';
import { normaliseIdentifier } from './identifier.js';
import { enqueue, PermanentJobError, type JobRow } from './jobs.js';
import { fillMessage } from './messages.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { ValidationError } from './validation.js';

export type SendChannel = 'whatsapp' | 'email' | 'sms';

const LABEL: Record<string, string> = {
  tax_invoice: 'Tax invoice', bill_of_supply: 'Bill of supply', estimate: 'Estimate', proforma: 'Proforma invoice',
  delivery_challan: 'Delivery challan', credit_note: 'Credit note', debit_note: 'Debit note',
};
export const docLabel = (t: string) => LABEL[t] ?? 'Document';

export function normaliseRecipient(channel: SendChannel, raw: string): string {
  const to = raw.trim();
  if (channel === 'email') {
    const e = to.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new ValidationError('Enter a valid email address.', 'to');
    return e;
  }
  try { return normaliseIdentifier(to).value; } catch { throw new ValidationError('Enter a valid 10-digit mobile number.', 'to'); }
}

/**
 * Queues a send. The delivery row and the job commit together, and the worker retries a failed send
 * with backoff, so a provider outage delays a message but does not lose it.
 */
export async function queueDocumentSend(
  sql: Sql, t: TenantSession, a: { documentId: string; channel: SendChannel; to: string; reminderId?: string },
) {
  const to = normaliseRecipient(a.channel, a.to);
  return inTenant(sql, t, 'document.issue', async (tx) => {
    const [d] = await tx`select status from document where id = ${a.documentId}`;
    if (!d) throw new ValidationError('Document not found.');
    if (d.status !== 'issued') throw new ValidationError('Only an issued document can be sent.');
    const [r] = await tx`insert into delivery (business_id, document_id, channel, to_address, status)
                         values (${t.businessId}, ${a.documentId}, ${a.channel}, ${to}, 'queued') returning id`;
    await enqueue(tx, 'delivery.send', { deliveryId: r!.id, documentId: a.documentId, channel: a.channel, to, reminderId: a.reminderId ?? null },
      { businessId: t.businessId });
    return { deliveryId: r!.id as string, status: 'queued' as const };
  });
}

export async function getDelivery(sql: Sql, t: TenantSession, deliveryId: string) {
  const rows = await inTenant(sql, t, 'document.read', (tx) => tx`select id, channel, to_address, status, error_message from delivery where id = ${deliveryId}`);
  return rows[0] ?? null;
}

export function messageText(o: { label: string; number: string; total: bigint; currency?: string; from: string; url: string; reminder?: { outstanding: bigint; dueDate: string | null } }): string {
  if (o.reminder) {
    return `Reminder: ${o.label} ${o.number} from ${o.from}, ${formatMoney(o.reminder.outstanding, o.currency)} still due${o.reminder.dueDate ? ` (due ${o.reminder.dueDate})` : ''}. View and pay: ${o.url}`;
  }
  return `${o.label} ${o.number} for ${formatMoney(o.total, o.currency)} from ${o.from}. View and download: ${o.url}`;
}

/** Worker side of 'delivery.send'. Safe to run twice for the same delivery. */
export async function processDeliveryJob(sql: Sql, deps: { messenger: Messenger; appUrl: string }, job: JobRow): Promise<void> {
  const p = job.payload as { deliveryId: string; documentId: string; channel: SendChannel; to: string; reminderId: string | null };
  if (!job.business_id) throw new PermanentJobError('Job has no business.');
  const ctx = { businessId: job.business_id, userId: SYSTEM_USER };
  const final = job.attempts >= job.max_attempts;

  const prep = await withTenant(sql, ctx, async (tx) => {
    const [del] = await tx`select id, status from delivery where id = ${p.deliveryId} for update`;
    if (!del) throw new PermanentJobError('Delivery not found.');
    if (del.status === 'sent') return null;
    const [d] = await tx`select d.status, d.doc_type, d.number, d.due_date, d.currency, d.grand_total_paise, d.amount_settled_paise, b.legal_name, b.trade_name, b.message_templates,
                                 (select name from party where id = d.party_id) as customer
                           from document d join business b on b.id = d.business_id where d.id = ${p.documentId}`;
    const stop = async (why: string) => {
      await tx`update delivery set status = 'failed', error_message = ${why} where id = ${p.deliveryId}`;
      if (p.reminderId) await tx`update reminder set delivery_status = 'cancelled' where id = ${p.reminderId}`;
      return null;
    };
    if (!d || d.status !== 'issued') { await stop('The document is no longer issued.'); return null; }
    const outstanding = BigInt(d.grand_total_paise as string) - BigInt(d.amount_settled_paise as string);
    if (p.reminderId && outstanding <= 0n) return stop('Paid before the reminder was sent.');
    const token = randomBytes(18).toString('base64url');
    await tx`insert into share_link (business_id, document_id, token_hash) values (${job.business_id}, ${p.documentId}, ${createHash('sha256').update(token).digest()})`;
    const url = `${deps.appUrl.replace(/\/$/, '')}/i/${token}`;
    const from = (d.trade_name ?? d.legal_name) as string;
    const own = ((d.message_templates ?? {}) as { invoice?: string; reminder?: string })[p.reminderId ? 'reminder' : 'invoice'];
    const text = own
      ? fillMessage(own, {
        customer: (d.customer as string | null) ?? 'Customer', type: docLabel(d.doc_type as string), number: d.number as string, amount: formatMoney(BigInt(d.grand_total_paise as string), d.currency as string),
        outstanding: formatMoney(outstanding, d.currency as string), due_date: (d.due_date as string | null) ?? '', business: from, link: url,
      })
      : messageText({
        label: docLabel(d.doc_type as string), number: d.number as string, total: BigInt(d.grand_total_paise as string), currency: d.currency as string, from, url,
        reminder: p.reminderId ? { outstanding, dueDate: d.due_date as string | null } : undefined,
      });
    return { url, text, subject: `${docLabel(d.doc_type as string)} ${d.number} from ${from}` };
  });
  if (!prep) return;

  try {
    const res = p.channel === 'whatsapp' ? await deps.messenger.sendWhatsApp({ to: p.to, text: prep.text, documentUrl: prep.url })
      : p.channel === 'email' ? await deps.messenger.sendEmail({ to: p.to, subject: prep.subject, text: prep.text, documentUrl: prep.url })
      : await deps.messenger.sendSms({ to: p.to, text: prep.text });
    await withTenant(sql, ctx, async (tx) => {
      await tx`update delivery set status = 'sent', provider_message_id = ${res.providerMessageId}, error_message = null where id = ${p.deliveryId}`;
      await tx`update document set last_sent_at = now() where id = ${p.documentId}`;
      if (p.reminderId) await tx`update reminder set delivery_status = 'sent', provider_message_id = ${res.providerMessageId} where id = ${p.reminderId}`;
    });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    await withTenant(sql, ctx, async (tx) => {
      await tx`update delivery set status = ${final ? 'failed' : 'queued'}, error_message = ${msg} where id = ${p.deliveryId}`;
      if (p.reminderId && final) await tx`update reminder set delivery_status = 'failed', error_message = ${msg} where id = ${p.reminderId}`;
    });
    throw e;
  }
}
