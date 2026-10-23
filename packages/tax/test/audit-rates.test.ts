import { describe, expect, it } from 'vitest';
import { allowedRatesOn, computeDocument, isTaxError, RATE_REFORM_DATE, type DocumentInput, type LineInput } from '../src/index.js';

// Source: Notification 9/2025-Central Tax (Rate) and 9/2025-Integrated Tax (Rate), both dated 17 September 2025, in force from
// 22 September 2025: the 12% and 28% slabs are gone, 40% is new. 0%, 0.25%, 3%, 5% and 18% carry on.
const L = (bp: number): LineInput => ({ quantityMilli: 1000n, ratePaise: 100000n, taxRateBp: bp });
const doc = (bp: number, supplyDate?: string): DocumentInput => ({
  docType: 'tax_invoice', registrationType: 'regular', supplierState: '27', placeOfSupply: '27', lines: [L(bp)], ...(supplyDate ? { supplyDate } : {}),
});
const code = (fn: () => unknown) => { try { fn(); } catch (e) { if (isTaxError(e)) return e.code; throw e; } return 'no error'; };

describe('rate slabs depend on the date of supply', () => {
  it('the reform date is 22 September 2025', () => expect(RATE_REFORM_DATE).toBe('2025-09-22'));
  it('before 22 September 2025: 0, 0.25, 3, 5, 12, 18, 28 are allowed; 40 is not', () => {
    expect([...allowedRatesOn('2025-09-21')].sort((a, b) => a - b)).toEqual([0, 25, 300, 500, 1200, 1800, 2800]);
  });
  it('from 22 September 2025: 0, 0.25, 3, 5, 18, 40 are allowed; 12 and 28 are not', () => {
    expect([...allowedRatesOn('2025-09-22')].sort((a, b) => a - b)).toEqual([0, 25, 300, 500, 1800, 4000]);
    expect([...allowedRatesOn('2026-10-23')].sort((a, b) => a - b)).toEqual([0, 25, 300, 500, 1800, 4000]);
  });
  it('an invoice dated after the reform cannot carry 12% or 28%', () => {
    expect(code(() => computeDocument(doc(1200, '2025-09-22')))).toBe('rate_not_allowed');
    expect(code(() => computeDocument(doc(2800, '2026-04-01')))).toBe('rate_not_allowed');
  });
  it('an invoice dated before the reform still can (a late-entered or corrected old invoice)', () => {
    expect(computeDocument(doc(1200, '2025-09-21')).cgstPaise).toBe(6000n);
    expect(computeDocument(doc(2800, '2025-04-01')).igstPaise).toBe(0n);
  });
  it('40% is refused before the reform and accepted after it', () => {
    expect(code(() => computeDocument(doc(4000, '2025-09-21')))).toBe('rate_not_allowed');
    expect(computeDocument(doc(4000, '2025-09-22')).cgstPaise).toBe(20000n);
  });
  it('the special 0.25% and 3% rates are allowed on both sides of the date', () => {
    for (const d of ['2025-01-01', '2026-10-23']) {
      expect(computeDocument(doc(25, d)).cgstPaise).toBe(125n);
      expect(computeDocument(doc(300, d)).cgstPaise).toBe(1500n);
    }
  });
  it('with no date the old behaviour holds: every slab that ever existed is accepted', () => {
    expect(code(() => computeDocument(doc(1200)))).toBe('no error');
  });
  it('rejects a malformed date rather than guessing', () => {
    expect(code(() => allowedRatesOn('22-09-2025'))).toBe('bad_date');
  });
});
