import { parseRupees } from '@kora/tax';
import type { Sql } from '@kora/db';
import { ADVANCE_METHODS } from './credit.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { isDate, str, todayIn, ValidationError } from './validation.js';

const rupees = (p: bigint) => `${p / 100n}.${(p % 100n).toString().padStart(2, '0')}`;

export interface TimelineEvent {
  at: string;
  kind: 'issued' | 'payment' | 'credit_note' | 'refund' | 'write_off' | 'link';
  title: string;
  /** Money moved by this event. Positive reduces what is owed; a refund is negative. */
  amountPaise: string;
  /** What is still owed once this event has happened. Null for events that do not move it. */
  balancePaise: string | null;
  allocationId?: string;
  paymentId?: string;
  /** True when a refund can be made against this event from the invoice screen. */
  refundable?: boolean;
}

/**
 * The money story of one invoice, oldest first: issued, each payment or credit note with what was left after it, every refund, any
 * bad debt written off, and payment links made. Built from the same rows the invoice total uses, so the last balance always equals what
 * the invoice shows as still due.
 */
export async function paymentTimeline(sql: Sql, t: TenantSession, documentId: string) {
  return inTenant(sql, t, 'payment.read', async (tx) => {
    const [d] = await tx`select id, number, doc_type, status, doc_date::text as doc_date, grand_total_paise, created_at from document where id = ${documentId}`;
    if (!d) throw new ValidationError('Invoice not found.');
    const total = BigInt(d.grand_total_paise as string);
    const allocs = await tx`
      select a.id, a.amount_paise, a.created_at, a.credit_note_id, c.number as credit_number, p.id as payment_id, p.method, p.gateway, p.received_on::text as received_on,
             coalesce((select sum(r.amount_paise) from payment_refund r where r.payment_id = p.id), 0) as refunded
        from payment_allocation a left join payment p on p.id = a.payment_id left join document c on c.id = a.credit_note_id
       where a.document_id = ${documentId} order by coalesce(p.received_on, a.created_at::date), a.created_at`;
    const refunds = await tx`
      select r.id, r.amount_paise, r.method, r.refunded_on::text as refunded_on, r.created_at, r.payment_id, r.note
        from payment_refund r where r.payment_id in (select payment_id from payment_allocation where document_id = ${documentId} and payment_id is not null)
       order by r.refunded_on, r.created_at`;
    const offs = await tx`select w.amount_paise, w.written_off_on::text as on from document_write_off w where w.document_id = ${documentId} and w.cancelled_at is null`;
    const links = await tx`select gateway, amount_paise, status, created_at::date::text as on from payment_link where document_id = ${documentId} order by created_at`;

    type Draft = Omit<TimelineEvent, 'balancePaise'> & { moves: bigint | null };
    const drafts: Draft[] = [{ at: d.doc_date as string, kind: 'issued', title: `${d.number ?? 'Invoice'} issued`, amountPaise: total.toString(), moves: null }];
    for (const a of allocs) {
      const amt = BigInt(a.amount_paise as string);
      if (a.credit_note_id) drafts.push({ at: (a.received_on ?? String(a.created_at).slice(0, 10)) as string, kind: 'credit_note', title: `Credit note ${a.credit_number}`, amountPaise: amt.toString(), moves: amt, allocationId: a.id as string });
      else drafts.push({
        at: a.received_on as string, kind: 'payment', title: `Payment received (${a.gateway ? `${a.method} via ${a.gateway}` : String(a.method).replace(/_/g, ' ')})`, amountPaise: amt.toString(), moves: amt,
        allocationId: a.id as string, paymentId: a.payment_id as string, refundable: !a.gateway && a.method !== 'client_money' && a.method !== 'tds',
      });
    }
    for (const r of refunds) drafts.push({ at: r.refunded_on as string, kind: 'refund', title: `Refund (${String(r.method).replace(/_/g, ' ')})${r.note ? `: ${r.note}` : ''}`, amountPaise: (-BigInt(r.amount_paise as string)).toString(), moves: null, paymentId: r.payment_id as string });
    for (const w of offs) drafts.push({ at: w.on as string, kind: 'write_off', title: 'Bad debt written off', amountPaise: BigInt(w.amount_paise as string).toString(), moves: BigInt(w.amount_paise as string) });
    for (const l of links) drafts.push({ at: l.on as string, kind: 'link', title: `Payment link made (${l.status})`, amountPaise: BigInt(l.amount_paise as string).toString(), moves: null });
    const order = { issued: 0, link: 1, payment: 2, credit_note: 2, write_off: 3, refund: 4 } as const;
    drafts.sort((x, y) => x.at.localeCompare(y.at) || order[x.kind] - order[y.kind]);
    let owed = total;
    const events: TimelineEvent[] = drafts.map((x) => {
      if (x.moves !== null) owed -= x.moves;
      const { moves, ...rest } = x;
      return { ...rest, balancePaise: x.kind === 'issued' || moves !== null ? owed.toString() : null };
    });
    return { documentId, totalPaise: total.toString(), duePaise: owed.toString(), state: owed <= 0n ? 'paid' : owed < total ? 'part_paid' : 'unpaid', events };
  });
}

/**
 * Gives money back against an invoice: takes it off the invoice (so the invoice owes it again) and records the refund of the cash.
 * Works on payments entered by hand. Gateway payments are refunded at the gateway, and credit notes are reversed as credit notes.
 */
export async function refundInvoicePayment(sql: Sql, t: TenantSession, i: { allocationId: string; amount: string; method: string; refundedOn?: string; note?: string | null }) {
  if (!(ADVANCE_METHODS as readonly string[]).includes(i.method)) throw new ValidationError('Choose how the money was returned.', 'method');
  let amount: bigint;
  try { amount = parseRupees(String(i.amount)); } catch { throw new ValidationError('Enter the amount in rupees.', 'amount'); }
  if (amount <= 0n) throw new ValidationError('The amount must be more than zero.', 'amount');
  const note = str(i.note, 'Note', { max: 300 });
  return inTenant(sql, t, 'payment.write', async (tx) => {
    const [a] = await tx`select id, payment_id, document_id, amount_paise, credit_note_id from payment_allocation where id = ${i.allocationId} for update`;
    if (!a) throw new ValidationError('Payment not found.');
    if (a.credit_note_id || !a.payment_id) throw new ValidationError('A credit note is reversed as a credit note, not refunded.');
    const [p] = await tx`select id, gateway, method from payment where id = ${a.payment_id} for update`;
    if (p!.gateway) throw new ValidationError('A payment taken through the gateway is refunded at the gateway.');
    if (p!.method === 'client_money' || p!.method === 'tds') throw new ValidationError('This payment cannot be refunded from here.');
    const applied = BigInt(a.amount_paise as string);
    if (amount > applied) throw new ValidationError(`Only Rs ${rupees(applied)} of this payment was applied to the invoice.`, 'amount');
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const on = i.refundedOn || todayIn(b!.timezone as string);
    if (!isDate(on)) throw new ValidationError('Enter the date as YYYY-MM-DD.', 'refundedOn');
    // Free the money from the invoice first: the invoice settles itself again, then the freed money goes back.
    if (amount === applied) await tx`delete from payment_allocation where id = ${a.id}`;
    else await tx`update payment_allocation set amount_paise = amount_paise - ${amount.toString()} where id = ${a.id}`;
    const [row] = await tx`insert into payment_refund (business_id, payment_id, amount_paise, method, refunded_on, note, created_by)
                           values (${t.businessId}, ${a.payment_id}, ${amount.toString()}, ${i.method}, ${on}, ${note}, ${t.userId}) returning id`;
    const [after] = await tx`select number, amount_settled_paise, payment_status from document where id = ${a.document_id}`;
    return { refundId: row!.id as string, paymentStatus: after!.payment_status as string, settledPaise: after!.amount_settled_paise as string };
  });
}
