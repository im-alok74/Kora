import type { Sql } from '@kora/db';
import { deleteDraft, issueDocument, saveDraft, type LineIn } from './documents.js';
import { PAYMENT_METHODS, recordPayment } from './payments.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { ValidationError } from './validation.js';

/**
 * A sale at the counter in one step: make the bill, issue it, and record the money, so the till never leaves a half-finished document.
 * A registered business issues a tax invoice. A composition dealer or an unregistered seller issues a bill of supply, which cannot
 * charge tax, so the lines carry no GST for them. If anything fails before the bill is issued, the draft is removed again.
 */
export async function completeSale(sql: Sql, t: TenantSession, i: { lines: LineIn[]; partyId?: string | null; method?: string; note?: string | null }) {
  if (!Array.isArray(i.lines) || i.lines.length === 0) throw new ValidationError('Add something to the bill first.', 'lines');
  if (i.lines.length > 100) throw new ValidationError('A till bill can have at most 100 lines.', 'lines');
  const method = i.method ?? 'cash';
  if (!(PAYMENT_METHODS as readonly string[]).includes(method) || method === 'tds') throw new ValidationError('Choose how the customer paid.', 'method');
  const [biz] = await inTenant(sql, t, 'document.read', (tx) => tx`select registration_type from business where id = ${t.businessId}`);
  const taxed = biz!.registration_type === 'regular' || biz!.registration_type === 'sez' || biz!.registration_type === 'isd';
  const docType = taxed ? 'tax_invoice' as const : 'bill_of_supply' as const;
  const lines = taxed ? i.lines : i.lines.map((l) => ({ ...l, taxRateBp: 0, cessRateBp: 0, taxInclusive: false }));
  const draft = await saveDraft(sql, t, { docType, partyId: i.partyId ?? null, lines, notes: i.note ?? null });
  let issued;
  try {
    issued = await issueDocument(sql, t, draft.id);
  } catch (e) {
    await deleteDraft(sql, t, draft.id).catch(() => {});
    throw e;
  }
  const [d] = await inTenant(sql, t, 'document.read', (tx) => tx`select number, grand_total_paise::text as total from document where id = ${draft.id}`);
  let paid = false, paymentError: string | null = null;
  try {
    await recordPayment(sql, t, { documentId: draft.id, amount: `${BigInt(d!.total as string) / 100n}.${(BigInt(d!.total as string) % 100n).toString().padStart(2, '0')}`, method });
    paid = true;
  } catch (e) { paymentError = e instanceof Error ? e.message : String(e); }
  void issued;
  return { id: draft.id, number: d!.number as string, totalPaise: d!.total as string, docType, paid, paymentError };
}
