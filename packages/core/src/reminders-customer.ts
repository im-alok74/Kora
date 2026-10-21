import type { Sql, Tx } from '@kora/db';
import { formatMoney } from '@kora/tax';
import { docLabel } from './delivery.js';
import { DEFAULT_MESSAGES, fillMessage } from './messages.js';
import { reminderTime, sanitiseReminderConfig, scheduleReminders } from './reminders.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { ValidationError } from './validation.js';

const INVOICE_TYPES = ['tax_invoice', 'bill_of_supply', 'debit_note'];

/** "2 days before the due date", "On the due date", "7 days after the due date". */
export function offsetLabel(o: number): string {
  if (o === 0) return 'On the due date';
  const n = Math.abs(o);
  return `${n} day${n === 1 ? '' : 's'} ${o < 0 ? 'before' : 'after'} the due date`;
}

/** Plans reminders again for the open invoices of one customer, after their schedule changed. Reminders already sent stay as history. */
async function replanForParty(tx: Tx, businessId: string, partyId: string): Promise<number> {
  await tx`update reminder set delivery_status = 'cancelled'
            where delivery_status = 'scheduled' and document_id in (select id from document where party_id = ${partyId})`;
  const docs = await tx`select id, doc_type, due_date::text as due_date from document
                         where party_id = ${partyId} and status = 'issued' and doc_type = any(${INVOICE_TYPES}) and grand_total_paise > amount_settled_paise`;
  let n = 0;
  for (const d of docs) n += await scheduleReminders(tx, { id: d.id as string, business_id: businessId, doc_type: d.doc_type as string, due_date: d.due_date as string | null });
  return n;
}

export async function getCustomerReminder(sql: Sql, t: TenantSession, partyId: string) {
  return inTenant(sql, t, 'document.read', async (tx) => {
    const [p] = await tx`select p.reminder_override, p.name, p.phone, p.email, b.reminder_config from party p join business b on b.id = p.business_id where p.id = ${partyId}`;
    if (!p) throw new ValidationError('Customer not found.');
    const business = sanitiseReminderConfig(p.reminder_config);
    const override = p.reminder_override ? sanitiseReminderConfig(p.reminder_override) : null;
    const upcoming = await tx`
      select r.id, r.channel, r.scheduled_at, d.id as document_id, d.number, d.due_date::text as due_date
        from reminder r join document d on d.id = r.document_id
       where d.party_id = ${partyId} and r.delivery_status = 'scheduled' order by r.scheduled_at limit 50`;
    return { business, override, effective: override ?? business, usingBusinessDefault: !override, upcoming, phone: p.phone as string | null, email: p.email as string | null };
  });
}

/** input null puts the customer back on the business's schedule. */
export async function saveCustomerReminder(sql: Sql, t: TenantSession, partyId: string, input: unknown) {
  const cfg = input === null ? null : sanitiseReminderConfig(input);
  await inTenant(sql, t, 'party.write', async (tx) => {
    const r = await tx`update party set reminder_override = ${cfg ? tx.json(cfg as any) : null} where id = ${partyId} returning id`;
    if (r.length === 0) throw new ValidationError('Customer not found.');
    await replanForParty(tx, t.businessId, partyId);
  });
  return getCustomerReminder(sql, t, partyId);
}

/**
 * What the customer will read, and when. Uses the business's own reminder wording if it has one. The link is a stand-in: a real link
 * is made when the message is sent. Picks the customer's oldest unpaid invoice unless one is named.
 */
export async function previewReminder(sql: Sql, t: TenantSession, a: { partyId: string; documentId?: string; config?: unknown }) {
  const cfg = a.config === undefined ? (await getCustomerReminder(sql, t, a.partyId)).effective : sanitiseReminderConfig(a.config);
  return inTenant(sql, t, 'document.read', async (tx) => {
    const [d] = await tx`
      select d.id, d.doc_type, d.number, d.due_date::text as due_date, d.currency, d.grand_total_paise, d.amount_settled_paise, p.name as customer, p.phone, p.email,
             b.legal_name, b.trade_name, b.message_templates
        from document d join party p on p.id = d.party_id join business b on b.id = d.business_id
       where d.party_id = ${a.partyId} and d.status = 'issued' and d.doc_type = any(${INVOICE_TYPES}) and d.grand_total_paise > d.amount_settled_paise
         and (${a.documentId ?? null}::uuid is null or d.id = ${a.documentId ?? null}::uuid)
       order by d.due_date nulls last, d.created_at limit 1`;
    const schedule = cfg.offsets.map((o) => ({ offset: o, label: offsetLabel(o), at: d?.due_date ? reminderTime(d.due_date as string, o).toISOString() : null }));
    if (!d) return { channel: cfg.channel, enabled: cfg.enabled, text: null as string | null, to: null as string | null, schedule, documentNumber: null as string | null };
    const from = (d.trade_name ?? d.legal_name) as string;
    const own = ((d.message_templates ?? {}) as { reminder?: string }).reminder ?? DEFAULT_MESSAGES.reminder;
    const out = BigInt(d.grand_total_paise as string) - BigInt(d.amount_settled_paise as string);
    const text = fillMessage(own, {
      customer: d.customer as string, type: docLabel(d.doc_type as string), number: d.number as string, amount: formatMoney(BigInt(d.grand_total_paise as string), d.currency as string),
      outstanding: formatMoney(out, d.currency as string), due_date: (d.due_date as string | null) ?? '', business: from, link: 'https://your-link-appears-here',
    });
    return { channel: cfg.channel, enabled: cfg.enabled, text: text as string | null, to: (cfg.channel === 'email' ? d.email : d.phone) as string | null, schedule, documentNumber: d.number as string | null };
  });
}

/** What was sent, or tried, newest first. For one customer or the whole business. */
export async function reminderHistory(sql: Sql, t: TenantSession, f: { partyId?: string; limit?: number } = {}) {
  return inTenant(sql, t, 'document.read', (tx) => tx`
    select r.id, r.channel, r.scheduled_at, r.delivery_status, r.error_message, d.id as document_id, d.number, p.id as party_id, p.name as customer
      from reminder r join document d on d.id = r.document_id left join party p on p.id = d.party_id
     where r.delivery_status in ('queued', 'sent', 'delivered', 'read', 'failed') and (${f.partyId ?? null}::uuid is null or d.party_id = ${f.partyId ?? null}::uuid)
     order by r.scheduled_at desc limit ${Math.min(f.limit ?? 100, 500)}`);
}
