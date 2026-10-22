import { parseRupees } from '@kora/tax';
import type { Sql } from '@kora/db';
import { saveDraft, type LineIn } from './documents.js';
import { EXPENSE_CATEGORIES, saveExpense } from './expenses.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { str, ValidationError } from './validation.js';

const rs = (p: bigint) => `${p / 100n}.${(p % 100n).toString().padStart(2, '0')}`;

/** Categories to offer: Kora's suggestions plus any the business has used itself. */
export async function listExpenseCategories(sql: Sql, t: TenantSession): Promise<string[]> {
  const rows = await inTenant(sql, t, 'expense.read', (tx) => tx`select category, count(*)::int as n from expense group by category order by n desc, category`);
  return [...new Set([...rows.map((r) => r.category as string), ...EXPENSE_CATEGORIES])];
}

/** Marks an expense as billable to a customer, or clears it. Cannot change once it is on an invoice draft. */
export async function setBillable(sql: Sql, t: TenantSession, expenseId: string, partyId: string | null): Promise<void> {
  await inTenant(sql, t, 'expense.write', async (tx) => {
    const [e] = await tx`select billed_document_id from expense where id = ${expenseId} for update`;
    if (!e) throw new ValidationError('Expense not found.');
    if (e.billed_document_id) throw new ValidationError('This expense is already on an invoice. Delete that draft first to change it.');
    if (partyId) {
      const [p] = await tx`select kind from party where id = ${partyId}`;
      if (!p || p.kind === 'vendor') throw new ValidationError('Choose a customer.', 'partyId');
    }
    await tx`update expense set bill_to_party_id = ${partyId} where id = ${expenseId}`;
  });
}

/**
 * A mileage claim: kilometres at a rate per kilometre, saved as an expense in the Mileage category. Travel is not a supply of goods,
 * so there is no GST in it. Distance has one decimal place.
 */
export async function saveMileage(sql: Sql, t: TenantSession, i: { date?: string; from?: string; to?: string; km: string; ratePerKm: string; notes?: string | null; billToPartyId?: string | null }) {
  const km = Number(String(i.km ?? '').trim());
  if (!Number.isFinite(km) || km <= 0 || km > 100000) throw new ValidationError('Enter the distance in kilometres.', 'km');
  const tenth = Math.round(km * 10);
  let rate: bigint;
  try { rate = parseRupees(String(i.ratePerKm ?? '')); } catch { throw new ValidationError('Enter the rate per kilometre in rupees.', 'ratePerKm'); }
  if (rate <= 0n || rate > 100000n) throw new ValidationError('Enter the rate per kilometre in rupees.', 'ratePerKm');
  const amount = (BigInt(tenth) * rate + 5n) / 10n;
  const route = [str(i.from, 'From', { max: 80 }), str(i.to, 'To', { max: 80 })].filter(Boolean).join(' to ');
  const notes = [route, `${(tenth / 10).toFixed(1)} km at Rs ${rs(rate)} per km`, str(i.notes, 'Notes', { max: 500 })].filter(Boolean).join('. ');
  const { id } = await saveExpense(sql, t, { date: i.date, category: 'Mileage', amount: rs(amount), paidVia: 'cash', notes });
  await inTenant(sql, t, 'expense.write', async (tx) => {
    await tx`update expense set distance_tenth_km = ${tenth}, rate_per_km_paise = ${rate.toString()} where id = ${id}`;
  });
  if (i.billToPartyId) await setBillable(sql, t, id, i.billToPartyId);
  return { id, amountPaise: amount.toString() };
}

export async function listBillable(sql: Sql, t: TenantSession, partyId?: string) {
  return inTenant(sql, t, 'expense.read', (tx) => tx`
    select e.id, e.expense_date::text as expense_date, e.vendor, e.category, e.amount_paise::text as amount_paise, e.notes, e.bill_to_party_id, p.name as customer
      from expense e join party p on p.id = e.bill_to_party_id
     where e.billed_document_id is null and (${partyId ?? null}::uuid is null or e.bill_to_party_id = ${partyId ?? null}::uuid)
     order by e.expense_date, e.created_at`);
}

/**
 * Puts billable expenses of one customer on a new DRAFT invoice, one line each, at the amount that was paid. It stays a draft so a person
 * reviews it. The GST rate on the lines defaults to 0 because a pure reimbursement and a cost that is part of your own supply are taxed
 * differently: your CA decides, and the rate can be changed on the draft.
 */
export async function invoiceBillableExpenses(sql: Sql, t: TenantSession, i: { partyId: string; expenseIds: string[]; taxRateBp?: number }) {
  const ids = [...new Set(i.expenseIds ?? [])];
  if (ids.length === 0) throw new ValidationError('Choose at least one expense.', 'expenseIds');
  if (ids.length > 100) throw new ValidationError('Choose at most 100 expenses at a time.', 'expenseIds');
  const rows = await inTenant(sql, t, 'expense.read', (tx) => tx`
    select id, expense_date::text as d, vendor, category, amount_paise::text as a, notes from expense
     where id in ${tx(ids)} and bill_to_party_id = ${i.partyId} and billed_document_id is null order by expense_date, created_at`);
  if (rows.length !== ids.length) throw new ValidationError('One of those expenses is not billable to this customer, or is already on an invoice.', 'expenseIds');
  const lines: LineIn[] = rows.map((r) => ({
    name: `Reimbursement: ${r.vendor ? `${r.vendor}, ` : ''}${r.category} (${r.d})`.slice(0, 200), hsnSac: null, quantity: '1', rate: rs(BigInt(r.a as string)),
    taxRateBp: i.taxRateBp ?? 0, kind: 'service',
  }));
  const draft = await saveDraft(sql, t, { docType: 'tax_invoice', partyId: i.partyId, lines, notes: 'Expenses paid on your behalf.' });
  await inTenant(sql, t, 'expense.write', (tx) => tx`update expense set billed_document_id = ${draft.id} where id in ${tx(ids)}`);
  return { documentId: draft.id, count: rows.length };
}
