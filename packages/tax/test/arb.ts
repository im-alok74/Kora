import fc from 'fast-check';
import { DEFAULT_ALLOWED_RATE_BP, type DocumentInput, type LineInput } from '../src/index.js';

const RATES = [...DEFAULT_ALLOWED_RATE_BP];

/** A random but valid line: discount never exceeds the gross amount. */
export const lineArb: fc.Arbitrary<LineInput> = fc.record({
  qty: fc.integer({ min: 1, max: 5_000_000 }),
  rate: fc.integer({ min: 0, max: 50_000_000 }),
  discountPct: fc.integer({ min: 0, max: 100 }),
  bp: fc.constantFrom(...RATES),
  cess: fc.constantFrom(0, 0, 0, 100, 1200, 2000),
}).map(({ qty, rate, discountPct, bp, cess }) => {
  const gross = (BigInt(qty) * BigInt(rate) + 500n) / 1000n;
  return { quantityMilli: BigInt(qty), ratePaise: BigInt(rate), discountPaise: (gross * BigInt(discountPct)) / 100n, taxRateBp: bp, cessRateBp: cess };
});

export const docArb: fc.Arbitrary<DocumentInput> = fc.record({
  lines: fc.array(lineArb, { minLength: 1, maxLength: 8 }),
  inter: fc.boolean(),
  rcm: fc.boolean(),
  tcs: fc.constantFrom(0, 0, 10, 100),
  tds: fc.constantFrom(0, 0, 100, 1000, 2000),
}).map((r) => ({
  docType: 'tax_invoice' as const, registrationType: 'regular' as const, supplierState: '27',
  placeOfSupply: r.inter ? '29' : '27', reverseCharge: r.rcm, lines: r.lines, tcsBp: r.tcs, tdsBp: r.tds,
}));

