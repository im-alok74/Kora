import { describe, expect, it } from 'vitest';
import { computeDocument, computeLine, DEFAULT_ALLOWED_RATE_BP } from '../src/index.js';

const line = (rateRupees: number, bp: number, o: Record<string, unknown> = {}) => ({ quantityMilli: 1000n, ratePaise: BigInt(Math.round(rateRupees * 100)), taxRateBp: bp, taxInclusive: true, ...o });
const doc = (lines: ReturnType<typeof line>[], supplierState = '27', placeOfSupply = '27') =>
  computeDocument({ docType: 'tax_invoice', registrationType: 'regular', supplierState, placeOfSupply, lines });

describe('prices that include GST', () => {
  it('Rs 118 at 18% is Rs 100 plus 9 and 9, and the total is exactly 118', () => {
    const r = doc([line(118, 1800)]);
    expect(r.lines[0]).toMatchObject({ taxablePaise: 10000n, cgstPaise: 900n, sgstPaise: 900n, lineTotalPaise: 11800n });
    expect(r.grandTotalPaise).toBe(11800n);
  });
  it('a price with an awkward split still totals exactly what the customer was quoted, with CGST equal to SGST', () => {
    for (const [mrp, bp] of [[99, 1800], [49, 500], [1, 1800], [0.99, 1200], [250.5, 2800], [1999, 1800], [7, 300]] as const) {
      const r = doc([line(mrp, bp)]);
      const l = r.lines[0]!;
      expect(l.lineTotalPaise, `${mrp} @ ${bp}`).toBe(BigInt(Math.round(mrp * 100)));
      expect(l.cgstPaise).toBe(l.sgstPaise);
      expect(l.taxablePaise + l.cgstPaise + l.sgstPaise).toBe(l.lineTotalPaise);
      // the taxable value is within a paisa of the exact figure
      const exact = (mrp * 100 * 10000) / (10000 + bp);
      expect(Math.abs(Number(l.taxablePaise) - exact)).toBeLessThanOrEqual(1.5);
    }
  });
  it('across states the whole tax is IGST', () => {
    const r = doc([line(118, 1800)], '27', '29');
    expect(r.lines[0]).toMatchObject({ taxablePaise: 10000n, cgstPaise: 0n, sgstPaise: 0n, igstPaise: 1800n, lineTotalPaise: 11800n });
  });
  it('quantity multiplies the inclusive price, and a discount comes off the inclusive total', () => {
    const r = doc([line(59, 1800, { quantityMilli: 3000n })]);
    expect(r.lines[0]!.lineTotalPaise).toBe(17700n);
    const d = doc([line(118, 1800, { discountPaise: 1800n })]);
    expect(d.lines[0]!.lineTotalPaise).toBe(10000n);
    expect(d.lines[0]!.taxablePaise + d.lines[0]!.cgstPaise + d.lines[0]!.sgstPaise).toBe(10000n);
    expect(d.lines[0]!.grossPaise - d.lines[0]!.discountPaise).toBe(d.lines[0]!.taxablePaise);    // the database checks this
  });
  it('splits out cess, and zero-rated lines pass through untouched', () => {
    const c = computeLine({ quantityMilli: 1000n, ratePaise: 11800n + 1000n, taxRateBp: 1800, cessRateBp: 1000, taxInclusive: true }, 'inter', DEFAULT_ALLOWED_RATE_BP);
    expect(c.lineTotalPaise).toBe(12800n);
    expect(c.cessPaise).toBe(c.taxablePaise / 10n);
    expect(c.taxablePaise + c.igstPaise + c.cessPaise).toBe(12800n);
    const z = doc([line(50, 0)]);
    expect(z.lines[0]).toMatchObject({ taxablePaise: 5000n, cgstPaise: 0n, lineTotalPaise: 5000n });
  });
  it('mixes with ordinary lines on one invoice, and the document rounds as usual', () => {
    const r = doc([line(118, 1800), { quantityMilli: 1000n, ratePaise: 10001n, taxRateBp: 1800 } as never]);
    expect(r.lines[1]!.taxablePaise).toBe(10001n);
    expect(r.grandTotalPaise).toBe(23600n);                    // 118.00 + 118.01 = 236.01, rounded to the rupee
    expect(r.taxablePaise).toBe(10000n + 10001n);
  });
  it('is unchanged for ordinary lines', () => {
    const a = doc([{ quantityMilli: 1000n, ratePaise: 10000n, taxRateBp: 1800, taxInclusive: false } as never]);
    expect(a.lines[0]).toMatchObject({ taxablePaise: 10000n, cgstPaise: 900n, lineTotalPaise: 11800n });
  });
});
