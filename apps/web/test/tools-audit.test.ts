import { describe, expect, it } from 'vitest';
import { computeDocument, parseRupees } from '@kora/tax';
import { calcGst } from '../lib/gstCalc';

// Worked by hand, not by the code under test. The free calculator must give what an invoice would.
const TABLE: [amount: string, bp: number, mode: 'exclusive' | 'inclusive', supply: 'intra' | 'inter', base: bigint, cgst: bigint, sgst: bigint, igst: bigint, total: bigint][] = [
  ['1000', 500, 'exclusive', 'intra', 100000n, 2500n, 2500n, 0n, 105000n],
  ['999.99', 1800, 'exclusive', 'inter', 99999n, 0n, 0n, 18000n, 117999n],       // 17,999.82 paise of tax rounds to 18,000
  ['1000', 25, 'exclusive', 'intra', 100000n, 125n, 125n, 0n, 100250n],           // the special 0.25% rate
  ['500000', 300, 'exclusive', 'inter', 50000000n, 0n, 0n, 1500000n, 51500000n],  // 3% on gold
  ['1000', 4000, 'exclusive', 'inter', 100000n, 0n, 0n, 40000n, 140000n],         // the 40% slab
  ['1050', 500, 'inclusive', 'intra', 100000n, 2500n, 2500n, 0n, 105000n],
  ['100', 1800, 'inclusive', 'intra', 8476n, 762n, 762n, 0n, 10000n],             // the odd paisa stays in the base so CGST equals SGST
  ['100', 1800, 'inclusive', 'inter', 8475n, 0n, 0n, 1525n, 10000n],
  ['0', 1800, 'exclusive', 'intra', 0n, 0n, 0n, 0n, 0n],
];

describe('the free GST calculator agrees with hand-worked figures and with an invoice', () => {
  for (const [amount, bp, mode, supply, base, cgst, sgst, igst, total] of TABLE) {
    it(`${amount} at ${bp / 100}% ${mode}, ${supply}`, () => {
      expect(calcGst(amount, bp, mode, supply)).toEqual({ base, cgst, sgst, igst, tax: cgst + sgst + igst, total });
    });
  }
  it('gives the same numbers as a one-line invoice for every slab, amount and supply', () => {
    for (const bp of [0, 25, 300, 500, 1800, 4000, 1200, 2800]) {
      for (const amount of ['0.01', '1', '9.99', '99.99', '1234.56', '99999.99', '1234567.89']) {
        for (const mode of ['exclusive', 'inclusive'] as const) {
          for (const supply of ['intra', 'inter'] as const) {
            const c = calcGst(amount, bp, mode, supply);
            const r = computeDocument({
              docType: 'tax_invoice', registrationType: 'regular', supplierState: '27', placeOfSupply: supply === 'intra' ? '27' : '29', roundTotal: false,
              lines: [{ quantityMilli: 1000n, ratePaise: parseRupees(amount), taxRateBp: bp, taxInclusive: mode === 'inclusive' }],
            });
            expect(c.total).toBe(r.grandTotalPaise);
            expect(c.base + c.tax).toBe(c.total);
            if (mode === 'inclusive') expect(c.total).toBe(parseRupees(amount));
            else expect(c.base).toBe(parseRupees(amount));
          }
        }
      }
    }
  });
});
