/**
 * Payment terms a person picks on a document, and the whole-bill discount that is spread over its lines.
 * Pure functions: the editor, the server and the tests all use these.
 */
import { roundHalfUp } from './money.js';

export interface PaymentTerm { key: string; label: string; days: number | null }

/** `days: null` means the term is not a plain count of days (end of month, or the person types the date). */
export const PAYMENT_TERMS: readonly PaymentTerm[] = [
  { key: 'receipt', label: 'Due on receipt', days: 0 },
  { key: 'net15', label: 'Net 15', days: 15 },
  { key: 'net30', label: 'Net 30', days: 30 },
  { key: 'net45', label: 'Net 45', days: 45 },
  { key: 'net60', label: 'Net 60', days: 60 },
  { key: 'eom', label: 'End of this month', days: null },
  { key: 'custom', label: 'Choose a date', days: null },
] as const;

export const isPaymentTerm = (k: unknown): k is string => typeof k === 'string' && PAYMENT_TERMS.some((t) => t.key === k);

/** The due date (YYYY-MM-DD) for a document dated `docDate`, or null when the term leaves the date to the person. */
export function dueDateFor(docDate: string, term: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(docDate)) return null;
  const t = PAYMENT_TERMS.find((x) => x.key === term);
  if (!t || term === 'custom') return null;
  const [y, m, d] = docDate.split('-').map(Number) as [number, number, number];
  if (term === 'eom') return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const at = new Date(Date.UTC(y, m - 1, d + (t.days ?? 0)));
  return at.toISOString().slice(0, 10);
}

/**
 * Spreads a discount on the whole bill over the lines in proportion to what each line is worth, to the paisa.
 * `grossPaise` is what each line is worth before this discount. The shares always add up to exactly the discount asked for
 * (capped at the bill's value), and no share is larger than its own line, so tax stays correct line by line.
 * The largest-remainder method decides who gets the odd paise, with the earlier line winning a tie.
 */
export function allocateDiscount(grossPaise: readonly bigint[], totalPaise: bigint): bigint[] {
  const sum = grossPaise.reduce((a, g) => a + (g > 0n ? g : 0n), 0n);
  const want = totalPaise < 0n ? 0n : totalPaise > sum ? sum : totalPaise;
  if (sum === 0n || want === 0n) return grossPaise.map(() => 0n);
  const base = grossPaise.map((g) => (g > 0n ? (want * g) / sum : 0n));
  let left = want - base.reduce((a, b) => a + b, 0n);
  const order = grossPaise
    .map((g, i) => ({ i, rem: g > 0n ? (want * g) % sum : -1n }))
    .sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const o of order) { if (left === 0n) break; if (o.rem >= 0n) { base[o.i]! += 1n; left -= 1n; } }
  return base;
}

/** A percentage of a bill, in basis points (1000 = 10%), rounded half up to the paisa. */
export const percentOf = (paise: bigint, bp: number): bigint => roundHalfUp(paise * BigInt(bp), 10000n);
