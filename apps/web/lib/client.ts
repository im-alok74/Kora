'use client';
import { tenantHeaders } from './offlineScope';
import { allowedRatesOn, formatRupees } from '@kora/tax';

export class ApiError extends Error {
  constructor(message: string, public status: number, public field?: string) { super(message); }
}

/** All writes are JSON. Errors carry the message the server wrote for people. */
export async function api<T = any>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const r = await fetch(url, {
    method, headers: { ...tenantHeaders(), ...(method === 'GET' ? {} : { 'content-type': 'application/json' }) },
    body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(opts.body ?? {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(data.error ?? 'Something went wrong. Try again.', r.status, data.field);
  return data as T;
}

export const rupees = (p: string | bigint | null | undefined) => formatRupees(BigInt(p ?? 0));

export const TAX_RATES: { bp: number; label: string }[] = [
  { bp: 0, label: '0%' }, { bp: 25, label: '0.25%' }, { bp: 300, label: '3%' }, { bp: 500, label: '5%' },
  { bp: 1200, label: '12%' }, { bp: 1800, label: '18%' }, { bp: 2800, label: '28%' }, { bp: 4000, label: '40%' },
];

/**
 * The rates to offer for a supply on `date` (YYYY-MM-DD, today when empty): 12% and 28% ended on 22 September 2025 and 40% began then.
 * A rate already on a line stays in the list, marked, so an old item or draft never silently shows a different rate.
 */
export function taxRatesFor(date?: string, keep?: number): { bp: number; label: string }[] {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date! : new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const on = allowedRatesOn(d);
  return TAX_RATES.filter((r) => on.has(r.bp) || r.bp === keep).map((r) => (on.has(r.bp) ? r : { ...r, label: `${r.label} (not valid on this date)` }));
}

export const DOC_LABEL: Record<string, string> = {
  tax_invoice: 'Tax invoice', bill_of_supply: 'Bill of supply', estimate: 'Estimate', proforma: 'Proforma invoice',
  delivery_challan: 'Delivery challan', credit_note: 'Credit note', debit_note: 'Debit note', sales_order: 'Sales order',
};

/** What a credit or debit note's reason key means, in words a person would use. */
export const NOTE_REASON_TEXT: Record<string, string> = {
  goods_returned: 'Goods returned by the customer', post_sale_discount: 'Discount given after the sale', price_correction: 'Price was wrong',
  quantity_correction: 'Quantity was wrong', service_deficiency: 'Service was short or not up to the mark', tax_rate_correction: 'Tax rate was wrong',
  additional_charge: 'Extra charge to add', other: 'Something else',
};

/** Paise (a string from the API, or a bigint) as rupee text with two decimals, "12345" -> "123.45". No floating point is involved. */
export function paiseToRupeeText(p: string | bigint | number): string {
  const v = BigInt(p), neg = v < 0n, a = neg ? -v : v;
  return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`;
}
