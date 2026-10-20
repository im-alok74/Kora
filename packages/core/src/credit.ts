import { parseRupees } from '@kora/tax';
import type { Sql } from '@kora/db';
import { emitEvent } from './webhooks.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { isDate, str, todayIn, ValidationError } from './validation.js';

/** How an advance arrives or a refund leaves. Tax deducted at source and client money are not advances. */
export const ADVANCE_METHODS = ['cash', 'upi', 'card', 'netbanking', 'bank_transfer', 'cheque', 'other'] as const;
const RECEIVABLE = ['tax_invoice', 'bill_of_supply', 'debit_note'];

const rupees = (paise: bigint) => `${paise / 100n}.${(paise % 100n).toString().padStart(2, '0')}`;
function money(text: unknown, what = 'The amount'): bigint {
  let v: bigint;
  try { v = parseRupees(String(text ?? '')); } catch { throw new ValidationError(`${what}: enter an amount in rupees.`, 'amount'); }
  if (v <= 0n) throw new ValidationError(`${what} must be more than zero.`, 'amount');
  return v;
}

/**
 * Money received from a customer before there is an invoice for it, held on the customer until it is applied.
 * Under GST an advance for services is taxed when it is received; talk to your CA about whether a receipt voucher is due.
 */
export async function recordAdvance(sql: Sql, t: TenantSession, i: { partyId: string; amount: string; method: string; receivedOn?: string; note?: string | null }) {
  if (!(ADVANCE_METHODS as readonly string[]).includes(i.method)) throw new ValidationError('Choose how the money was received.', 'method');
  const amount = money(i.amount);
  const note = str(i.note, 'Note', { max: 300 });
  return inTenant(sql, t, 'payment.write', async (tx) => {
    const [p] = await tx`select id, kind from party where id = ${i.partyId}`;
    if (!p) throw new ValidationError('Customer not found.', 'partyId');
    if (p.kind === 'vendor') throw new ValidationError('An advance is money from a customer.', 'partyId');
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const on = i.receivedOn || todayIn(b!.timezone as string);
    if (!isDate(on)) throw new ValidationError('Enter the date as YYYY-MM-DD.', 'receivedOn');
    const [row] = await tx`insert into payment (business_id, party_id, amount_paise, method, received_on, note)
                           values (${t.businessId}, ${i.partyId}, ${amount.toString()}, ${i.method}, ${on}, ${note ?? 'Advance'}) returning id`;
    await emitEvent(tx, t.businessId, 'payment.received', { payment_id: row!.id, document_id: null, amount_paise: amount.toString(), method: i.method, status: 'advance' });
    return { paymentId: row!.id as string };
  });
}

/** What is held for a customer, and the payments it is made of (oldest first). */
export async function partyCredit(sql: Sql, t: TenantSession, partyId: string) {
  return inTenant(sql, t, 'payment.read', async (tx) => {
    const rows = await tx`
      select p.id, p.amount_paise, p.method, p.received_on, p.note,
             (p.amount_paise - coalesce((select sum(a.amount_paise) from payment_allocation a where a.payment_id = p.id), 0)
                             - coalesce((select sum(r.amount_paise) from payment_refund r where r.payment_id = p.id), 0))::text as available_paise
        from payment p where p.party_id = ${partyId} and p.method <> 'tds' and p.method <> 'client_money'
       order by p.received_on, p.created_at`;
    const held = rows.filter((r) => BigInt(r.available_paise as string) > 0n);
    return { totalPaise: held.reduce((a, r) => a + BigInt(r.available_paise as string), 0n).toString(), payments: held };
  });
}

/**
 * Applies money held for the invoice's customer to the invoice, oldest first, up to what is still due (or `amount` when given).
 * Returns how much was applied. Nothing is applied when the customer holds nothing.
 */
export async function applyCredit(sql: Sql, t: TenantSession, i: { documentId: string; amount?: string }) {
  const cap = i.amount ? money(i.amount) : null;
  return inTenant(sql, t, 'payment.write', async (tx) => {
    const [d] = await tx`select id, party_id, status, doc_type, grand_total_paise, amount_settled_paise, number from document where id = ${i.documentId} for update`;
    if (!d) throw new ValidationError('Invoice not found.');
    if (d.status !== 'issued' || !RECEIVABLE.includes(d.doc_type as string)) throw new ValidationError('Credit can only be applied to an issued invoice.');
    if (!d.party_id) throw new ValidationError('This invoice has no customer, so there is no credit to apply.');
    let due = BigInt(d.grand_total_paise as string) - BigInt(d.amount_settled_paise as string);
    if (due <= 0n) throw new ValidationError('This invoice is already paid.');
    if (cap !== null && cap < due) due = cap;
    const pays = await tx`
      select p.id, (p.amount_paise - coalesce((select sum(a.amount_paise) from payment_allocation a where a.payment_id = p.id), 0)
                                   - coalesce((select sum(r.amount_paise) from payment_refund r where r.payment_id = p.id), 0))::text as available
        from payment p where p.party_id = ${d.party_id} and p.method <> 'tds' and p.method <> 'client_money' order by p.received_on, p.created_at for update`;
    let applied = 0n;
    for (const p of pays) {
      const avail = BigInt(p.available as string);
      if (avail <= 0n || due === 0n) continue;
      const use = avail < due ? avail : due;
      await tx`insert into payment_allocation (business_id, payment_id, document_id, amount_paise) values (${t.businessId}, ${p.id}, ${i.documentId}, ${use.toString()})`;
      applied += use; due -= use;
    }
    if (applied === 0n) throw new ValidationError('This customer has no money held to apply.');
    const [after] = await tx`select amount_settled_paise, payment_status from document where id = ${i.documentId}`;
    await emitEvent(tx, t.businessId, 'payment.received', { document_id: i.documentId, number: d.number, amount_paise: applied.toString(), method: 'credit', status: after!.payment_status });
    return { appliedPaise: applied.toString(), paymentStatus: after!.payment_status as string, applied: rupees(applied) };
  });
}

/** Gives back money held for a customer that has not been applied to any invoice. */
export async function refundCredit(sql: Sql, t: TenantSession, paymentId: string, i: { amount: string; method: string; refundedOn?: string; note?: string | null }) {
  if (!(ADVANCE_METHODS as readonly string[]).includes(i.method)) throw new ValidationError('Choose how the money was returned.', 'method');
  const amount = money(i.amount);
  const note = str(i.note, 'Note', { max: 300 });
  return inTenant(sql, t, 'payment.write', async (tx) => {
    const [p] = await tx`select id, gateway from payment where id = ${paymentId} for update`;
    if (!p) throw new ValidationError('Payment not found.');
    if (p.gateway) throw new ValidationError('A payment taken through the gateway is refunded at the gateway.');
    const [x] = await tx`select (p.amount_paise - coalesce((select sum(a.amount_paise) from payment_allocation a where a.payment_id = p.id), 0)
                                                - coalesce((select sum(r.amount_paise) from payment_refund r where r.payment_id = p.id), 0))::text as available
                           from payment p where p.id = ${paymentId}`;
    const avail = BigInt(x!.available as string);
    if (amount > avail) throw new ValidationError(avail === 0n ? 'All of this payment has been applied to invoices, so there is nothing to refund.' : `Only ${rupees(avail)} is held and can be refunded.`, 'amount');
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const on = i.refundedOn || todayIn(b!.timezone as string);
    if (!isDate(on)) throw new ValidationError('Enter the date as YYYY-MM-DD.', 'refundedOn');
    const [row] = await tx`insert into payment_refund (business_id, payment_id, amount_paise, method, refunded_on, note, created_by)
                           values (${t.businessId}, ${paymentId}, ${amount.toString()}, ${i.method}, ${on}, ${note}, ${t.userId}) returning id`;
    return { refundId: row!.id as string };
  });
}

/** Everything a receipt for one payment shows: who paid, how much, and which invoices it settled. */
export async function paymentReceiptData(sql: Sql, t: TenantSession, paymentId: string) {
  return inTenant(sql, t, 'payment.read', async (tx) => {
    const [p] = await tx`select id, party_id, amount_paise::text as amount_paise, method, received_on::text as received_on, note from payment where id = ${paymentId}`;
    if (!p) return null;
    const allocations = await tx`
      select d.number, d.doc_type, d.grand_total_paise::text as grand_total_paise, d.amount_settled_paise::text as settled_paise, a.amount_paise::text as allocated_paise
        from payment_allocation a join document d on d.id = a.document_id where a.payment_id = ${paymentId} order by a.created_at`;
    const [supplier] = await tx`select legal_name, trade_name, gstin, address, phone from business where id = ${t.businessId}`;
    const [recipient] = p.party_id ? await tx`select name, gstin from party where id = ${p.party_id}` : [];
    return { payment: p, allocations, supplier: supplier ?? {}, recipient: recipient ?? null };
  });
}
