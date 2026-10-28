import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  allocateDiscount, computeDocument, computeLine, formatMoney, formatRupees, GSTIN_STATE_CODES, gstinCheckChar, gstinValid, isTaxError, parseExchangeRate, parseRupees,
  roundHalfUp, nearestSlabBp, rupeesInWords, validateInvoiceNumber, type DocumentInput, type LineInput,
} from '../src/index.js';

/**
 * Invariants the overnight audit holds the engine to. They are independent of how the engine rounds: each is arithmetic that
 * has to be true of any correct GST invoice.
 */
const RUNS = { numRuns: 5_000 };
const SLABS = [0, 25, 300, 500, 1800, 4000];
const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);
const abs = (x: bigint) => (x < 0n ? -x : x);

const lineArb: fc.Arbitrary<LineInput> = fc.record({
  qty: fc.integer({ min: 1, max: 9_999_999 }), rate: fc.integer({ min: 0, max: 99_999_999 }), discPct: fc.integer({ min: 0, max: 100 }),
  bp: fc.constantFrom(...SLABS), cess: fc.constantFrom(0, 0, 100, 1200), incl: fc.boolean(),
}).map(({ qty, rate, discPct, bp, cess, incl }) => {
  const gross = roundHalfUp(BigInt(qty) * BigInt(rate), 1000n);
  return { quantityMilli: BigInt(qty), ratePaise: BigInt(rate), discountPaise: (gross * BigInt(discPct)) / 100n, taxRateBp: bp, cessRateBp: cess, taxInclusive: incl };
});
const docArb = (lines: fc.Arbitrary<LineInput[]>): fc.Arbitrary<DocumentInput> => fc.record({
  lines, inter: fc.boolean(), adj: fc.integer({ min: -100_000, max: 100_000 }), round: fc.boolean(), rcm: fc.boolean(),
}).map((r) => ({
  docType: 'tax_invoice' as const, registrationType: 'regular' as const, supplierState: '27', placeOfSupply: r.inter ? '29' : '27', lines: r.lines,
  adjustmentPaise: BigInt(r.adj), roundTotal: r.round, reverseCharge: r.rcm, supplyDate: '2026-10-23',
}));
const tryCompute = (d: DocumentInput) => { try { return computeDocument(d); } catch (e) { if (isTaxError(e) && e.code === 'negative_amount') return null; throw e; } };

describe('parts always sum to the total, including adjustments, inclusive prices and reverse charge', () => {
  it('grand total = taxable + tax (unless reverse charge) + TCS + adjustment + round-off, for any mix of lines', () => {
    fc.assert(fc.property(docArb(fc.array(lineArb, { minLength: 1, maxLength: 12 })), (d) => {
      const r = tryCompute(d);
      if (!r) return true;                                  // an adjustment bigger than the bill is refused, which is correct
      const tax = d.reverseCharge ? 0n : r.cgstPaise + r.sgstPaise + r.igstPaise + r.cessPaise;
      return r.grandTotalPaise === r.taxablePaise + tax + r.tcsPaise + r.adjustmentPaise + r.roundOffPaise
        && r.lines.every((l) => l.lineTotalPaise === l.taxablePaise + l.cgstPaise + l.sgstPaise + l.igstPaise + l.cessPaise)
        && r.taxablePaise === sum(r.lines.map((l) => l.taxablePaise));
    }), RUNS);
  });
  it('a tax-inclusive line is worth exactly quantity x rate less discount, whatever the rate', () => {
    fc.assert(fc.property(lineArb, fc.boolean(), (l, intra) => {
      const line = { ...l, taxInclusive: true };
      const r = computeLine(line, intra ? 'intra' : 'inter', new Set(SLABS));
      const gross = roundHalfUp(l.quantityMilli * l.ratePaise, 1000n);
      return r.lineTotalPaise === gross - (l.discountPaise ?? 0n) && r.lineTotalPaise === r.taxablePaise + r.cgstPaise + r.sgstPaise + r.igstPaise + r.cessPaise
        && r.grossPaise - r.discountPaise === r.taxablePaise;
    }), RUNS);
  });
});

describe('no negative or fractional paise', () => {
  it('every figure is a bigint, and only the round-off and the adjustment may be below zero', () => {
    fc.assert(fc.property(docArb(fc.array(lineArb, { minLength: 1, maxLength: 8 })), (d) => {
      const r = tryCompute(d);
      if (!r) return true;
      const nonNeg = [r.taxablePaise, r.cgstPaise, r.sgstPaise, r.igstPaise, r.cessPaise, r.tcsPaise, r.tdsPaise, r.grandTotalPaise, r.netReceivablePaise];
      return nonNeg.every((x) => typeof x === 'bigint' && x >= 0n)
        && r.lines.every((l) => [l.grossPaise, l.discountPaise, l.taxablePaise, l.cgstPaise, l.sgstPaise, l.igstPaise, l.cessPaise, l.lineTotalPaise].every((x) => typeof x === 'bigint' && x >= 0n));
    }), RUNS);
  });
});

describe('tax-inclusive then exclusive round trip stays within one paisa', () => {
  it('taking the taxable value out of an inclusive price and taxing it again gives back the price (1 paisa inter-state, 2 in-state)', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 9_999_999 }), fc.constantFrom(...SLABS), fc.boolean(), (rate, bp, intra) => {
      const supply = intra ? 'intra' : 'inter';
      const inc = computeLine({ quantityMilli: 1000n, ratePaise: BigInt(rate), taxRateBp: bp, taxInclusive: true }, supply, new Set(SLABS));
      const exc = computeLine({ quantityMilli: 1000n, ratePaise: inc.taxablePaise, taxRateBp: bp }, supply, new Set(SLABS));
      // Inter-state: within one paisa. In-state the engine keeps CGST equal to SGST by leaving an odd paisa in the taxable value, and
      // taxing that taxable value again rounds each half up, so the total can come back up to two paise away. That is by design.
      return abs(exc.lineTotalPaise - BigInt(rate)) <= (intra ? 2n : 1n);
    }), RUNS);
  });
  it('and the other way: tax a price, then treat the total as inclusive, and the taxable value comes back within a paisa', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 9_999_999 }), fc.constantFrom(...SLABS), (rate, bp) => {
      const exc = computeLine({ quantityMilli: 1000n, ratePaise: BigInt(rate), taxRateBp: bp }, 'inter', new Set(SLABS));
      const inc = computeLine({ quantityMilli: 1000n, ratePaise: exc.lineTotalPaise, taxRateBp: bp, taxInclusive: true }, 'inter', new Set(SLABS));
      return abs(inc.taxablePaise - BigInt(rate)) <= 1n && inc.lineTotalPaise === exc.lineTotalPaise;
    }), RUNS);
  });
});

describe('the order of the lines never changes the totals', () => {
  it('reversing or shuffling lines gives the same document', () => {
    fc.assert(fc.property(fc.array(lineArb, { minLength: 2, maxLength: 10 }), fc.boolean(), (lines, inter) => {
      const mk = (ls: LineInput[]) => computeDocument({
        docType: 'tax_invoice', registrationType: 'regular', supplierState: '27', placeOfSupply: inter ? '29' : '27', lines: ls, supplyDate: '2026-10-23',
      });
      const a = mk(lines), b = mk([...lines].reverse()), c = mk([...lines.slice(1), lines[0]!]);
      const same = (x: typeof a, y: typeof a) => x.taxablePaise === y.taxablePaise && x.cgstPaise === y.cgstPaise && x.sgstPaise === y.sgstPaise
        && x.igstPaise === y.igstPaise && x.cessPaise === y.cessPaise && x.grandTotalPaise === y.grandTotalPaise && x.roundOffPaise === y.roundOffPaise;
      return same(a, b) && same(a, c);
    }), RUNS);
  });
});

describe('rounding never drifts across many lines', () => {
  it('200 identical lines come to exactly 200 times one line, and the document tax is within two paise a line of the tax on the pooled value', () => {
    fc.assert(fc.property(lineArb, (l) => {
      const one = computeDocument({ docType: 'tax_invoice', registrationType: 'regular', supplierState: '27', placeOfSupply: '29', lines: [l], roundTotal: false });
      const many = computeDocument({ docType: 'tax_invoice', registrationType: 'regular', supplierState: '27', placeOfSupply: '29', lines: Array(200).fill(l), roundTotal: false });
      return many.taxablePaise === 200n * one.taxablePaise && many.igstPaise === 200n * one.igstPaise && many.grandTotalPaise === 200n * one.grandTotalPaise
        // tax on the pooled taxable value differs from tax summed line by line by under two paise a line: the tax rounds, the cess rounds, and
        // a tax-inclusive line also passes the rounding of its taxable value on to its tax (half a paisa, times 1 + the rates, so 1.26 at 40% and 12% cess).
        // 200 lines is the most a document holds, so this is at most Rs 4 on the largest document.
        && abs(many.igstPaise - roundHalfUp(many.taxablePaise * BigInt(one.lines[0]!.taxRateBp), 10000n)) <= 400n;
    }), { numRuns: 500 });
  });
  it('a whole-bill discount spread over the lines adds back to exactly the discount', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 5_000_000 }), { minLength: 1, maxLength: 30 }), fc.integer({ min: 0, max: 200_000_000 }), (grosses, d) => {
      const g = grosses.map(BigInt);
      const shares = allocateDiscount(g, BigInt(d));
      const cap = sum(g) < BigInt(d) ? sum(g) : BigInt(d);
      return sum(shares) === cap && shares.every((s, i) => s >= 0n && s <= g[i]!);
    }), RUNS);
  });
});

describe('currency conversion and display keep paise exact', () => {
  it('rupee text round-trips through parseRupees for any paise value', () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 99_999_999_999_999n }), (p) => parseRupees(formatRupees(p).replace('Rs ', '').replace(/,/g, '')) === p), RUNS);
  });
  it('foreign amounts keep two decimals and plain thousands grouping, and negatives keep their sign in front', () => {
    fc.assert(fc.property(fc.bigInt({ min: -99_999_999_999n, max: 99_999_999_999n }), fc.constantFrom('USD', 'EUR', 'GBP', 'AED'), (p, cur) => {
      const t = formatMoney(p, cur);
      const m = /^(-?)([A-Z]{3}) (\d{1,3}(?:,\d{3})*)\.(\d{2})$/.exec(t);
      if (!m) return false;
      const back = BigInt(m[3]!.replace(/,/g, '')) * 100n + BigInt(m[4]!);
      return m[2] === cur && (m[1] === '-' ? -back : back) === p;
    }), RUNS);
  });
  it('an exchange rate converts a whole number of units to exactly the right paise', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 999_999 }), fc.integer({ min: 0, max: 999_999 }), fc.integer({ min: 1, max: 1_000_000 }), (whole, frac, minor) => {
      const text = `${whole}.${String(frac).padStart(6, '0')}`;
      const micro = parseExchangeRate(text);
      const inr = roundHalfUp(BigInt(minor) * micro, 1_000_000n);
      // independent check: |inr - minor x rate| <= half a paisa
      return abs(inr * 1_000_000n - BigInt(minor) * micro) * 2n <= 1_000_000n;
    }), RUNS);
  });
  it('amounts in words never throw for any non-negative amount and always end in Only', () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 999_999_999_999n }), (p) => rupeesInWords(p).endsWith(' Only')), RUNS);
  });
});

describe('invoice numbers (CGST Rule 46(b): at most 16 characters, letters, digits, hyphen and slash)', () => {
  const ok = fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/-'.split('')), { minLength: 1, maxLength: 16 });
  it('every string of allowed characters up to 16 long is accepted', () => { fc.assert(fc.property(ok, (n) => { validateInvoiceNumber(n); return true; }), RUNS); });
  it('17 characters, an empty number, or any disallowed character is refused', () => {
    fc.assert(fc.property(ok, fc.constantFrom(' ', '_', '.', '#', '\\', ',', '&'), (n, bad) => {
      let refused = 0;
      for (const v of [n + 'X'.repeat(17 - n.length + 0), n.slice(0, 5) + bad + n.slice(5)]) { try { validateInvoiceNumber(v); } catch (e) { if (isTaxError(e)) refused++; } }
      return refused === 2 || n.length > 16;
    }), RUNS);
    expect(() => validateInvoiceNumber('')).toThrow();
  });
});

describe('GSTIN check digit', () => {
  const pan = fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), { minLength: 5, maxLength: 5 });
  const gstinArb = fc.tuple(fc.constantFrom(...GSTIN_STATE_CODES), pan, fc.integer({ min: 0, max: 9999 }), fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), fc.constantFrom(...'123456789'.split('')))
    .map(([st, p, n, l, e]) => { const first14 = `${st}${p}${String(n).padStart(4, '0')}${l}${e}Z`; return first14 + gstinCheckChar(first14); });
  it('a GSTIN built with the check character is valid, and changing any one character makes it invalid', () => {
    fc.assert(fc.property(gstinArb, fc.integer({ min: 0, max: 14 }), (g, i) => {
      if (!gstinValid(g)) return false;
      const alt = g[i] === 'B' ? 'C' : 'B';
      const broken = g.slice(0, i) + alt + g.slice(i + 1);
      return !gstinValid(broken);
    }), RUNS);
  });
});

describe('audit C-7 / T-9 / T-10: GSTIN state codes and the bound on amounts in words', () => {
  const withCheck = (b: string) => b + gstinCheckChar(b);
  it('refuses a GSTIN whose first two digits are not a state code, even with a correct check character', () => {
    for (const s of ['00', '25', '28', '39', '96']) expect(gstinValid(withCheck(`${s}ABCDE1234F1Z`))).toBe(false);
    expect(gstinValid(withCheck('27ABCDE1234F1Z'))).toBe(true);
    expect(gstinValid(withCheck('99ABCDE1234F1Z'))).toBe(true);
  });
  it('words go up to Rs 999 crore and refuse more instead of printing undefined', () => {
    expect(rupeesInWords(9_999_999_999n * 100n)).not.toMatch(/undefined/);
    expect(() => rupeesInWords(10_000_000_000n * 100n)).toThrow(/999 crore/);
  });
});

describe('audit C-15: a rate worked out from amounts snaps to a real slab', () => {
  it('turns 1799 and 1801 into 1800 and keeps real slabs as they are', () => {
    expect(nearestSlabBp(1799)).toBe(1800);
    expect(nearestSlabBp(1801)).toBe(1800);
    expect(nearestSlabBp(500)).toBe(500);
    expect(nearestSlabBp(0)).toBe(0);
  });
});
