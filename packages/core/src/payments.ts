import { emitEvent } from './webhooks.js';
import { parseRupees } from '@kora/tax';
import { SYSTEM_USER, setTenant, type Sql } from '@kora/db';
import type { GatewayEvent, PaymentGateway } from '@kora/adapters';
import { inTenant, type TenantSession } from './tenancy.js';
import { isDate, str, todayIn, ValidationError } from './validation.js';

export const PAYMENT_METHODS = ['cash', 'upi', 'card', 'netbanking', 'bank_transfer', 'cheque', 'tds', 'client_money', 'other'] as const;
const RECEIVABLE_TYPES = ['tax_invoice', 'bill_of_supply', 'debit_note'];

/** Records money received against one issued invoice. The amount cannot exceed what is outstanding. */
export async function recordPayment(
  sql: Sql, t: TenantSession,
  i: { documentId: string; amount: string; method: string; receivedOn?: string; note?: string | null },
) {
  if (!PAYMENT_METHODS.includes(i.method as never)) throw new ValidationError('Choose how the money was received.', 'method');
  let amount: bigint;
  try { amount = parseRupees(String(i.amount)); } catch { throw new ValidationError('Enter the amount in rupees.', 'amount'); }
  if (amount <= 0n) throw new ValidationError('The amount must be more than zero.', 'amount');
  const note = str(i.note, 'Note', { max: 300 });

  return inTenant(sql, t, 'payment.write', async (tx) => {
    const [d] = await tx`select id, party_id, status, doc_type, grand_total_paise, amount_settled_paise from document where id = ${i.documentId} for update`;
    if (!d) throw new ValidationError('Invoice not found.');
    if (d.status !== 'issued' || !RECEIVABLE_TYPES.includes(d.doc_type as string)) throw new ValidationError('Payments can only be recorded against an issued invoice.');
    const outstanding = BigInt(d.grand_total_paise as string) - BigInt(d.amount_settled_paise as string);
    if (outstanding <= 0n) throw new ValidationError('This invoice is already paid.');
    if (amount > outstanding) throw new ValidationError(`The amount is more than the ${(outstanding / 100n).toString()}.${(outstanding % 100n).toString().padStart(2, '0')} still due.`, 'amount');
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const on = i.receivedOn || todayIn(b!.timezone as string);
    if (!isDate(on)) throw new ValidationError('Enter the date as YYYY-MM-DD.', 'receivedOn');
    const [p] = await tx`insert into payment (business_id, party_id, amount_paise, method, received_on, note)
                         values (${t.businessId}, ${d.party_id}, ${amount.toString()}, ${i.method}, ${on}, ${note}) returning id`;
    await tx`insert into payment_allocation (business_id, payment_id, document_id, amount_paise)
             values (${t.businessId}, ${p!.id}, ${i.documentId}, ${amount.toString()})`;
    const [after] = await tx`select amount_settled_paise, payment_status from document where id = ${i.documentId}`;
    const [num] = await tx`select number from document where id = ${i.documentId}`;
    await emitEvent(tx, t.businessId, 'payment.received', { payment_id: p!.id, document_id: i.documentId, number: num!.number, amount_paise: amount.toString(), method: i.method, status: after!.payment_status });
    return { paymentId: p!.id as string, paymentStatus: after!.payment_status as string, settledPaise: after!.amount_settled_paise as string };
  });
}

export async function listPayments(sql: Sql, t: TenantSession, documentId: string) {
  return inTenant(sql, t, 'payment.read', (tx) => tx`
    select a.id as allocation_id, a.amount_paise as allocated_paise, a.created_at, p.id as payment_id, p.amount_paise as payment_paise,
           p.method, p.received_on, p.gateway, p.gateway_payment_id, p.note, a.credit_note_id, c.number as credit_note_number
      from payment_allocation a
      left join payment p on p.id = a.payment_id
      left join document c on c.id = a.credit_note_id
     where a.document_id = ${documentId} order by a.created_at`);
}

/** Money that arrived but could not be applied (an overpayment, or a payment for a cancelled invoice). */
export async function listUnallocated(sql: Sql, t: TenantSession) {
  return inTenant(sql, t, 'payment.read', (tx) => tx`
    select p.id, p.amount_paise, p.method, p.received_on, p.gateway, pa.name as party_name,
           (p.amount_paise - coalesce(sum(a.amount_paise), 0))::text as unallocated_paise
      from payment p left join payment_allocation a on a.payment_id = p.id left join party pa on pa.id = p.party_id
     group by p.id, pa.name having p.amount_paise > coalesce(sum(a.amount_paise), 0) order by p.received_on desc`);
}

/** Removes a manual payment entered by mistake. Gateway payments are refunded at the gateway instead. */
export async function voidPayment(sql: Sql, t: TenantSession, paymentId: string): Promise<void> {
  await inTenant(sql, t, 'document.cancel', async (tx) => {
    const [p] = await tx`select id, gateway, method from payment where id = ${paymentId} for update`;
    if (!p) throw new ValidationError('Payment not found.');
    if (p.gateway) throw new ValidationError('A payment taken through the gateway is refunded at the gateway, not removed here.');
    if (p.method === 'client_money') throw new ValidationError('This payment was made from money held for the client. The client money ledger is never edited, so it cannot be removed here.');
    await tx`delete from payment_allocation where payment_id = ${paymentId}`;
    await tx`delete from payment where id = ${paymentId}`;
  });
}

/** Creates (or reuses) a hosted payment link for what is still due on an invoice. */
export async function createPaymentLink(sql: Sql, t: TenantSession, gateway: PaymentGateway, documentId: string) {
  const ctx = await inTenant(sql, t, 'payment.write', async (tx) => {
    const [d] = await tx`select d.id, d.number, d.status, d.doc_type, d.grand_total_paise, d.amount_settled_paise, p.name, p.phone, p.email
                           from document d left join party p on p.id = d.party_id where d.id = ${documentId}`;
    if (!d) throw new ValidationError('Invoice not found.');
    if (d.status !== 'issued' || !RECEIVABLE_TYPES.includes(d.doc_type as string)) throw new ValidationError('A payment link needs an issued invoice.');
    const outstanding = BigInt(d.grand_total_paise as string) - BigInt(d.amount_settled_paise as string);
    if (outstanding <= 0n) throw new ValidationError('This invoice is already paid.');
    const [existing] = await tx`select id, url, amount_paise from payment_link where document_id = ${documentId} and gateway = ${gateway.name}
                                  and status = 'created' and amount_paise = ${outstanding.toString()} order by created_at desc limit 1`;
    return { d, outstanding, existing };
  });
  if (ctx.existing) return { id: ctx.existing.id as string, url: ctx.existing.url as string, amountPaise: ctx.existing.amount_paise as string, reused: true };
  const link = await gateway.createPaymentLink({
    amountPaise: ctx.outstanding, referenceId: documentId, description: `Invoice ${ctx.d.number}`,
    customer: { name: ctx.d.name as string | null, phone: ctx.d.phone as string | null, email: ctx.d.email as string | null },
  });
  const id = await inTenant(sql, t, 'payment.write', async (tx) => {
    const [r] = await tx`insert into payment_link (business_id, document_id, gateway, gateway_link_id, url, amount_paise)
                         values (${t.businessId}, ${documentId}, ${gateway.name}, ${link.gatewayLinkId}, ${link.url}, ${ctx.outstanding.toString()}) returning id`;
    return r!.id as string;
  });
  return { id, url: link.url, amountPaise: ctx.outstanding.toString(), reused: false };
}

export async function getPaymentLinks(sql: Sql, t: TenantSession, documentId: string) {
  return inTenant(sql, t, 'payment.read', (tx) => tx`select id, gateway, url, amount_paise, status, created_at from payment_link where document_id = ${documentId} order by created_at desc`);
}

export interface GatewayResult {
  duplicate: boolean;
  reason?: 'ignored' | 'unknown_link';
  applied?: { paymentId: string; allocatedPaise: string; unallocatedPaise: string };
}

/**
 * Applies a verified gateway event. Safe to call twice with the same event: the event id is unique, so a
 * duplicate delivery changes nothing. The event row and the payment commit together, so a failure rolls both
 * back and the gateway's retry starts clean.
 */
export async function applyGatewayEvent(sql: Sql, gateway: string, evt: GatewayEvent, raw: unknown): Promise<GatewayResult> {
  return sql.begin(async (tx) => {
    const ins = await tx`insert into webhook_event (gateway, event_id, payload) values (${gateway}, ${evt.eventId}, ${tx.json(raw as any)})
                         on conflict (gateway, event_id) do nothing returning id`;
    if (ins.length === 0) return { duplicate: true } as GatewayResult;
    const eventRow = ins[0]!.id as string;
    const done = () => tx`update webhook_event set processed_at = now() where id = ${eventRow}`;

    if (evt.kind === 'ignored') { await done(); return { duplicate: false, reason: 'ignored' } as GatewayResult; }
    const [link] = await tx`select * from lookup_payment_link(${gateway}, ${evt.gatewayLinkId})`;
    if (!link) { await done(); return { duplicate: false, reason: 'unknown_link' } as GatewayResult; }

    await setTenant(tx, { businessId: link.business_id as string, userId: SYSTEM_USER });
    const [d] = await tx`select id, party_id, status, grand_total_paise, amount_settled_paise from document where id = ${link.document_id} for update`;
    const [b] = await tx`select timezone from business where id = ${link.business_id}`;
    const amount = evt.amountPaise;
    const outstanding = d!.status === 'issued' ? BigInt(d!.grand_total_paise as string) - BigInt(d!.amount_settled_paise as string) : 0n;
    const allocate = amount < outstanding ? amount : outstanding;

    const [p] = await tx`insert into payment (business_id, party_id, amount_paise, method, gateway, gateway_event_id, gateway_payment_id, received_on)
                         values (${link.business_id}, ${d!.party_id}, ${amount.toString()}, ${evt.method}, ${gateway}, ${evt.eventId}, ${evt.gatewayPaymentId},
                                 ${todayIn(b!.timezone as string)}) returning id`;
    if (allocate > 0n) {
      await tx`insert into payment_allocation (business_id, payment_id, document_id, amount_paise)
               values (${link.business_id}, ${p!.id}, ${link.document_id}, ${allocate.toString()})`;
    }
    await tx`update payment_link set status = 'paid' where id = ${link.link_id}`;
    const [after] = await tx`select number, payment_status from document where id = ${link.document_id}`;
    await emitEvent(tx, link.business_id as string, 'payment.received', { payment_id: p!.id, document_id: link.document_id, number: after!.number, amount_paise: amount.toString(), method: evt.method, gateway, status: after!.payment_status });
    await done();
    return { duplicate: false, applied: { paymentId: p!.id as string, allocatedPaise: allocate.toString(), unallocatedPaise: (amount - allocate).toString() } } as GatewayResult;
  }) as Promise<GatewayResult>;
}
