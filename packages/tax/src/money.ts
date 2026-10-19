/** All money is bigint paise. There is no floating point anywhere in this package. */
export type Paise = bigint;

export class TaxError extends Error {
  constructor(public code: TaxErrorCode, message: string) {
    super(message);
    this.name = 'TaxError';
  }
}
/** Name-based so it still matches if a bundler loads this module twice. */
export const isTaxError = (e: unknown): e is TaxError => e instanceof Error && e.name === 'TaxError';

export type TaxErrorCode =
  | 'negative_amount' | 'bad_quantity' | 'discount_exceeds_gross' | 'rate_not_allowed'
  | 'specific_cess_unsupported' | 'no_lines' | 'composition_tax_invoice' | 'unregistered_tax_invoice'
  | 'bill_of_supply_with_tax' | 'unsupported_place_of_supply' | 'credit_exceeds_original'
  | 'gstin_state_mismatch' | 'gstin_invalid' | 'number_too_long' | 'number_bad_characters' | 'hsn_too_short';

/** Round half up for non-negative integers: round(n / d). */
export function roundHalfUp(n: bigint, d: bigint): bigint {
  if (n < 0n || d <= 0n) throw new TaxError('negative_amount', 'Amounts cannot be negative.');
  return (2n * n + d) / (2n * d);
}

/** "0.250" -> 250n thousandths. At most 3 decimal places, must be positive. */
export function parseQuantity(s: string): bigint {
  const m = /^(\d{1,12})(?:\.(\d{1,3}))?$/.exec(s.trim());
  if (!m) throw new TaxError('bad_quantity', 'Quantity must be a positive number with up to 3 decimals.');
  const milli = BigInt(m[1]!) * 1000n + BigInt((m[2] ?? '').padEnd(3, '0') || '0');
  if (milli <= 0n) throw new TaxError('bad_quantity', 'Quantity must be greater than zero.');
  return milli;
}

/** 1234567 paise -> "Rs 12,345.67" with Indian digit grouping (lakh, crore). */
export function formatRupees(p: Paise, opts: { symbol?: string } = {}): string {
  const neg = p < 0n;
  const abs = neg ? -p : p;
  const rupees = (abs / 100n).toString();
  const paise = (abs % 100n).toString().padStart(2, '0');
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
  return `${neg ? '-' : ''}${opts.symbol ?? 'Rs '}${grouped}.${paise}`;
}

/** "1000", "1000.5" or "1,000.50" -> paise. At most 2 decimals, non-negative. */
export function parseRupees(s: string): Paise {
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s.trim().replace(/,/g, ''));
  if (!m) throw new TaxError('negative_amount', 'Enter an amount in rupees with up to 2 decimals.');
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function below100(n: number): string { return n < 20 ? ONES[n]! : TENS[Math.floor(n / 10)]! + (n % 10 ? ' ' + ONES[n % 10] : ''); }
function below1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? ONES[h] + ' Hundred' : '', r ? below100(r) : ''].filter(Boolean).join(' ');
}

/** 118000 paise -> "Rupees One Thousand One Hundred Eighty Only" with lakh and crore. */
export function rupeesInWords(p: Paise): string {
  if (p < 0n) throw new TaxError('negative_amount', 'Amount cannot be negative.');
  let rupees = p / 100n;
  const paise = Number(p % 100n);
  if (rupees === 0n && paise === 0) return 'Rupees Zero Only';
  const parts: string[] = [];
  const crore = rupees / 10000000n; rupees %= 10000000n;
  const lakh = Number(rupees / 100000n); rupees %= 100000n;
  const thousand = Number(rupees / 1000n); const rest = Number(rupees % 1000n);
  if (crore > 0n) parts.push(rupeesInWordsCrore(crore) + ' Crore');
  if (lakh) parts.push(below100(lakh) + ' Lakh');
  if (thousand) parts.push(below100(thousand) + ' Thousand');
  if (rest) parts.push(below1000(rest));
  let out = parts.length ? 'Rupees ' + parts.join(' ') : '';
  if (paise) out += (out ? ' and ' : 'Paise ') + below100(paise) + (out ? ' Paise' : '');
  return out + ' Only';
}
function rupeesInWordsCrore(c: bigint): string {
  // Crores above 99 are spoken in hundreds of crores.
  const n = Number(c);
  return n < 100 ? below100(n) : below1000(n);
}
