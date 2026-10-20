import { describe, expect, it } from 'vitest';
import { allocateDiscount, dueDateFor, isPaymentTerm, percentOf } from '../src/index.js';

describe('payment terms', () => {
  it('counts days from the document date, across month and year ends', () => {
    expect(dueDateFor('2026-10-20', 'receipt')).toBe('2026-10-20');
    expect(dueDateFor('2026-10-20', 'net15')).toBe('2026-11-04');
    expect(dueDateFor('2026-12-20', 'net30')).toBe('2027-01-19');
    expect(dueDateFor('2028-01-30', 'net30')).toBe('2028-02-29');          // a leap year
    expect(dueDateFor('2026-10-20', 'net60')).toBe('2026-12-19');
  });
  it('end of month is the last day of the document month, leap February included', () => {
    expect(dueDateFor('2026-10-02', 'eom')).toBe('2026-10-31');
    expect(dueDateFor('2026-02-10', 'eom')).toBe('2026-02-28');
    expect(dueDateFor('2028-02-10', 'eom')).toBe('2028-02-29');
    expect(dueDateFor('2026-12-31', 'eom')).toBe('2026-12-31');
  });
  it('leaves the date to the person for a custom term and refuses bad input', () => {
    expect(dueDateFor('2026-10-20', 'custom')).toBeNull();
    expect(dueDateFor('2026-10-20', 'nonsense')).toBeNull();
    expect(dueDateFor('20-10-2026', 'net30')).toBeNull();
    expect(isPaymentTerm('net30')).toBe(true);
    expect(isPaymentTerm('net31')).toBe(false);
  });
});

describe('a discount on the whole bill', () => {
  const sum = (a: bigint[]) => a.reduce((x, y) => x + y, 0n);
  it('adds up to exactly the discount, in proportion to the lines', () => {
    expect(allocateDiscount([10000n, 30000n], 4000n)).toEqual([1000n, 3000n]);
    const a = allocateDiscount([10000n, 10000n, 10000n], 100n);               // 100 does not split three ways
    expect(sum(a)).toBe(100n);
    expect(a).toEqual([34n, 33n, 33n]);                                      // the odd paisa goes to the earlier line
  });
  it('never gives a line more than it is worth and never more than the bill', () => {
    expect(allocateDiscount([500n, 100n], 10_000n)).toEqual([500n, 100n]);
    expect(allocateDiscount([500n, 0n, 100n], 300n).every((x, i) => x <= [500n, 0n, 100n][i]!)).toBe(true);
    expect(allocateDiscount([500n, 0n], 100n)).toEqual([100n, 0n]);           // a zero line takes nothing
    expect(allocateDiscount([100n, 200n], -5n)).toEqual([0n, 0n]);
    expect(allocateDiscount([], 100n)).toEqual([]);
    expect(allocateDiscount([0n, 0n], 100n)).toEqual([0n, 0n]);
  });
  it('is exact for random bills', () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let k = 0; k < 500; k++) {
      const lines = Array.from({ length: 1 + rnd(8) }, () => BigInt(rnd(500_000)));
      const total = BigInt(rnd(1_000_000));
      const out = allocateDiscount(lines, total);
      const cap = sum(lines);
      expect(sum(out)).toBe(total > cap ? cap : total);
      out.forEach((x, i) => { expect(x >= 0n && x <= lines[i]!).toBe(true); });
    }
  });
  it('turns a percentage into paise, rounding half up', () => {
    expect(percentOf(100000n, 1000)).toBe(10000n);
    expect(percentOf(1999n, 500)).toBe(100n);                                // 99.95 rounds up
    expect(percentOf(0n, 1000)).toBe(0n);
  });
});
