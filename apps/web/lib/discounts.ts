import { allocateDiscount, parseQuantity, parseRupees, percentOf, roundHalfUp } from '@kora/tax';

/** What the editor needs from a line to work out discounts. Text, exactly as typed. */
export interface DiscountLine { quantity: string; rate: string; discount: string }

const rupeesText = (p: bigint) => `${p / 100n}.${(p % 100n).toString().padStart(2, '0')}`;

/** "10%" or "12.5%" as basis points, or null when the text is not a percentage. */
export function percentBp(text: string): number | null {
  const m = /^\s*(\d{1,3}(?:\.\d{1,2})?)\s*%\s*$/.exec(text);
  if (!m) return null;
  const bp = Math.round(parseFloat(m[1]!) * 100);
  return bp <= 10000 ? bp : null;
}

/** The line's worth before discount, in paise, or null when quantity or rate cannot be read yet. */
function grossOf(l: DiscountLine): bigint | null {
  try { return roundHalfUp(parseQuantity(l.quantity || '0') * parseRupees(l.rate || '0'), 1000n); } catch { return null; }
}

/**
 * Returns the discount to send for each line, as rupee text. A line's own discount may be an amount ("50") or a
 * percentage ("10%"). A discount on the whole bill (also an amount or a percentage) is then spread over the lines in
 * proportion to what each is worth, to the paisa, so the tax is worked out line by line as the law expects.
 * Anything that cannot be read yet is passed through as typed, and the server says what is wrong.
 */
export function effectiveDiscounts(lines: DiscountLine[], billText: string): string[] {
  const gross = lines.map(grossOf);
  const own = lines.map((l, i) => {
    const g = gross[i];
    const t = (l.discount ?? '').trim();
    if (t === '') return 0n;
    const bp = percentBp(t);
    if (bp !== null) return g == null ? null : percentOf(g, bp);
    try { return parseRupees(t); } catch { return null; }
  });
  const passThrough = lines.map((l) => l.discount ?? '');
  if (gross.some((g) => g === null) || own.some((d) => d === null)) return passThrough;

  const net = lines.map((_, i) => { const n = gross[i]! - own[i]!; return n > 0n ? n : 0n; });
  const bill = billText.trim();
  let share = lines.map(() => 0n);
  if (bill !== '') {
    const bp = percentBp(bill);
    let total: bigint;
    try { total = bp !== null ? percentOf(net.reduce((a, b) => a + b, 0n), bp) : parseRupees(bill); } catch { return passThrough; }
    share = allocateDiscount(net, total);
  }
  return lines.map((l, i) => {
    const d = own[i]! + share[i]!;
    return d === 0n && (l.discount ?? '').trim() === '' ? '' : rupeesText(d);
  });
}

/** The tax rate a freight or handling line should carry: the highest rate among the other lines. */
export const shippingRateBp = (rates: number[]): number => (rates.length ? Math.max(...rates) : 1800);
