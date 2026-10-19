import { describe, expect, it } from 'vitest';
import {
  assertCreditWithinOriginal, assertGstinMatchesState, checkHsn, computeDocument, formatRupees, gstinValid,
  isTaxError, parseQuantity, parseRupees, rupeesInWords, resolvePlaceOfSupply, validateInvoiceNumber,
  type DocumentInput, type LineInput,
} from '../src/index.js';

// Expected numbers below come from replica/tax-cases.md, worked by hand. They are not produced by the code.
const L = (qty: number, rate: bigint, bp: number, extra: Partial<LineInput> = {}): LineInput =>
  ({ quantityMilli: BigInt(qty) * 1000n, ratePaise: rate, taxRateBp: bp, ...extra });
const doc = (lines: LineInput[], over: Partial<DocumentInput> = {}): DocumentInput => ({
  docType: 'tax_invoice', registrationType: 'regular', supplierState: '27', placeOfSupply: '27', lines, ...over,
});
const code = (fn: () => unknown) => { try { fn(); } catch (e) { if (isTaxError(e)) return e.code; throw e; } return 'no error'; };

describe('intra and inter state', () => {
  it('TC01 intra-state, one line', () => {
    const r = computeDocument(doc([L(1, 100000n, 1800)]));
    expect(r).toMatchObject({ supply: 'intra', taxablePaise: 100000n, cgstPaise: 9000n, sgstPaise: 9000n, igstPaise: 0n, grandTotalPaise: 118000n });
  });
  it('TC02 inter-state, same line', () => {
    const r = computeDocument(doc([L(1, 100000n, 1800)], { placeOfSupply: '29' }));
    expect(r).toMatchObject({ supply: 'inter', cgstPaise: 0n, sgstPaise: 0n, igstPaise: 18000n, grandTotalPaise: 118000n });
  });
  const mixed = [L(1, 50000n, 500), L(1, 200000n, 1200), L(1, 75000n, 1800)];
  it('TC03 mixed rates, intra', () => {
    const r = computeDocument(doc(mixed));
    expect(r.lines.map((l) => l.cgstPaise)).toEqual([1250n, 12000n, 6750n]);
    expect(r).toMatchObject({ taxablePaise: 325000n, cgstPaise: 20000n, sgstPaise: 20000n, grandTotalPaise: 365000n });
  });
  it('TC04 mixed rates, inter', () => {
    const r = computeDocument(doc(mixed, { placeOfSupply: '29' }));
    expect(r.lines.map((l) => l.igstPaise)).toEqual([2500n, 24000n, 13500n]);
    expect(r).toMatchObject({ igstPaise: 40000n, grandTotalPaise: 365000n });
  });
});

describe('discounts and rounding', () => {
  it('TC05 discount before tax, with round-off', () => {
    const r = computeDocument(doc([L(3, 33333n, 1800, { discountPaise: 10000n })]));
    expect(r.lines[0]).toMatchObject({ grossPaise: 99999n, taxablePaise: 89999n, cgstPaise: 8100n, sgstPaise: 8100n });
    expect(r).toMatchObject({ roundOffPaise: 1n, grandTotalPaise: 106200n });
  });
  it('TC06 half a paisa rounds up', () => {
    const intra = computeDocument(doc([{ quantityMilli: 1000n, ratePaise: 50n, taxRateBp: 1800 }]));
    expect(intra).toMatchObject({ cgstPaise: 5n, sgstPaise: 5n, roundOffPaise: 0n, grandTotalPaise: 60n }); // under Rs 1: not rounded
    const inter = computeDocument(doc([{ quantityMilli: 1000n, ratePaise: 50n, taxRateBp: 1800 }], { placeOfSupply: '29' }));
    expect(inter.igstPaise).toBe(9n);
  });
  it('TC31 an invoice under Rs 1 is never rounded to zero, so TDS cannot make the receivable negative', () => {
    const r = computeDocument(doc([{ quantityMilli: 4500n, ratePaise: 1n, taxRateBp: 0 }], { tdsBp: 1000 }));
    expect(r).toMatchObject({ taxablePaise: 5n, roundOffPaise: 0n, grandTotalPaise: 5n, tdsPaise: 1n, netReceivablePaise: 4n });
    const edge = computeDocument(doc([{ quantityMilli: 1000n, ratePaise: 99n, taxRateBp: 0 }]));
    expect(edge.grandTotalPaise).toBe(99n);
    const at1 = computeDocument(doc([{ quantityMilli: 1000n, ratePaise: 100n, taxRateBp: 0 }]));
    expect(at1.grandTotalPaise).toBe(100n);
  });
  it('rates above 100% are refused for TDS and TCS', () => {
    expect(code(() => computeDocument(doc([L(1, 1000n, 0)], { tdsBp: 10001 })))).toBe('negative_amount');
    expect(code(() => computeDocument(doc([L(1, 1000n, 0)], { tcsBp: 10001 })))).toBe('negative_amount');
  });
  it('TC09 tax is rounded per line, then summed', () => {
    const r = computeDocument(doc([L(1, 33333n, 500), L(1, 33333n, 500), L(1, 33333n, 500)]));
    expect(r.lines.map((l) => l.cgstPaise)).toEqual([833n, 833n, 833n]);
    expect(r).toMatchObject({ cgstPaise: 2499n, sgstPaise: 2499n, taxablePaise: 99999n, roundOffPaise: 3n, grandTotalPaise: 105000n });
  });
  it('TC21 quantity in thousandths', () => {
    const r = computeDocument(doc([{ quantityMilli: parseQuantity('0.250'), ratePaise: 100000n, taxRateBp: 0 }]));
    expect(r.lines[0]!.grossPaise).toBe(25000n);
  });
  it('TC22 very large values do not overflow and still add up', () => {
    const r = computeDocument(doc([{ quantityMilli: 1000n, ratePaise: 999999999999n, taxRateBp: 2800 }]));
    expect(r.cgstPaise).toBe(140000000000n); // 139,999,999,999.86 rounds up
    expect(r.taxablePaise + r.cgstPaise + r.sgstPaise + r.roundOffPaise).toBe(r.grandTotalPaise);
  });
});

describe('cess', () => {
  it('TC07 ad valorem cess, intra', () => {
    const r = computeDocument(doc([L(1, 100000n, 2800, { cessRateBp: 1200 })]));
    expect(r).toMatchObject({ cgstPaise: 14000n, sgstPaise: 14000n, cessPaise: 12000n, grandTotalPaise: 140000n });
  });
  it('TC08 cess, inter', () => {
    const r = computeDocument(doc([L(1, 100000n, 2800, { cessRateBp: 1200 })], { placeOfSupply: '29' }));
    expect(r).toMatchObject({ igstPaise: 28000n, cessPaise: 12000n, grandTotalPaise: 140000n });
  });
  it('TC29 per-unit cess is refused, not ignored', () => {
    expect(code(() => computeDocument(doc([L(1, 100000n, 2800, { cessSpecificPaisePerUnit: 500n })])))).toBe('specific_cess_unsupported');
  });
});

describe('place of supply', () => {
  it('TC10 goods go by the ship-to state', () => {
    const pos = resolvePlaceOfSupply({ kind: 'goods', billToState: '29', shipToState: '27' });
    expect(computeDocument(doc([L(1, 100000n, 1800)], { placeOfSupply: pos })).supply).toBe('intra');
  });
  it('TC11 bill-to in the same state but ship-to elsewhere is inter-state', () => {
    const pos = resolvePlaceOfSupply({ kind: 'goods', billToState: '27', shipToState: '29' });
    expect(computeDocument(doc([L(1, 100000n, 1800)], { placeOfSupply: pos })).supply).toBe('inter');
  });
  it('TC12 services go by the recipient registered state', () => {
    const pos = resolvePlaceOfSupply({ kind: 'service', billToState: '27', recipientRegisteredState: '29' });
    expect(pos).toBe('29');
    expect(computeDocument(doc([L(1, 100000n, 1800)], { placeOfSupply: pos })).igstPaise).toBe(18000n);
  });
  it('exports are refused until v1.5', () => {
    expect(code(() => resolvePlaceOfSupply({ kind: 'goods', billToState: '96' }))).toBe('unsupported_place_of_supply');
  });
});

describe('reverse charge, exempt, composition', () => {
  it('TC13 reverse charge shows tax but leaves it out of the amount due', () => {
    const r = computeDocument(doc([L(1, 100000n, 1800)], { placeOfSupply: '29', reverseCharge: true }));
    expect(r).toMatchObject({ igstPaise: 18000n, grandTotalPaise: 100000n });
  });
  it('TC14 all lines exempt: the library recommends a bill of supply', () => {
    const r = computeDocument(doc([L(1, 100000n, 0)]));
    expect(r).toMatchObject({ recommendedDocType: 'bill_of_supply', cgstPaise: 0n, grandTotalPaise: 100000n });
  });
  it('TC15 mixed exempt and taxable stays a tax invoice', () => {
    const r = computeDocument(doc([L(1, 100000n, 0), L(1, 100000n, 1800)]));
    expect(r.recommendedDocType).toBe('tax_invoice');
    expect(r.lines[0]!.cgstPaise).toBe(0n);
  });
  it('TC16 composition dealer: tax invoice refused, bill of supply carries no tax', () => {
    expect(code(() => computeDocument(doc([L(1, 100000n, 1800)], { registrationType: 'composition' })))).toBe('composition_tax_invoice');
    const r = computeDocument(doc([L(1, 100000n, 1800)], { registrationType: 'composition', docType: 'bill_of_supply' }));
    expect(r).toMatchObject({ cgstPaise: 0n, sgstPaise: 0n, igstPaise: 0n, grandTotalPaise: 100000n });
  });
  it('a bill of supply that charges tax is refused for a regular dealer', () => {
    expect(code(() => computeDocument(doc([L(1, 100000n, 1800)], { docType: 'bill_of_supply' })))).toBe('bill_of_supply_with_tax');
  });
  it('an unregistered business cannot issue a tax invoice', () => {
    expect(code(() => computeDocument(doc([L(1, 100000n, 0)], { registrationType: 'unregistered' })))).toBe('unregistered_tax_invoice');
  });
});

describe('credit notes, TDS, TCS', () => {
  it('TC17 partial credit note', () => {
    const original = computeDocument(doc([L(1, 100000n, 1800)]));
    const credit = computeDocument(doc([L(1, 50000n, 1800)], { docType: 'credit_note' }));
    expect(credit).toMatchObject({ cgstPaise: 4500n, sgstPaise: 4500n, grandTotalPaise: 59000n });
    expect(original.grandTotalPaise - credit.grandTotalPaise).toBe(59000n);
  });
  it('TC18 a credit cannot exceed what is left on the original', () => {
    expect(code(() => assertCreditWithinOriginal({ originalTaxablePaise: 100000n, alreadyCreditedTaxablePaise: 60000n, creditTaxablePaise: 50000n }))).toBe('credit_exceeds_original');
    expect(code(() => assertCreditWithinOriginal({ originalTaxablePaise: 100000n, alreadyCreditedTaxablePaise: 50000n, creditTaxablePaise: 50000n }))).toBe('no error');
  });
  it('TC19 TDS does not change the total but reduces what the customer pays', () => {
    const r = computeDocument(doc([L(1, 100000n, 1800)], { tdsBp: 1000 }));
    expect(r).toMatchObject({ grandTotalPaise: 118000n, tdsPaise: 10000n, netReceivablePaise: 108000n });
  });
  it('TC20 TCS on taxable plus GST, then round-off', () => {
    const r = computeDocument(doc([L(1, 100000n, 1800)], { tcsBp: 10 }));
    expect(r).toMatchObject({ tcsPaise: 118n, roundOffPaise: -18n, grandTotalPaise: 118100n });
  });
});

describe('rejections', () => {
  it('TC23 zero or negative quantity', () => {
    expect(code(() => computeDocument(doc([{ quantityMilli: 0n, ratePaise: 100n, taxRateBp: 0 }])))).toBe('bad_quantity');
    expect(code(() => computeDocument(doc([{ quantityMilli: -1000n, ratePaise: 100n, taxRateBp: 0 }])))).toBe('bad_quantity');
    expect(code(() => parseQuantity('0'))).toBe('bad_quantity');
    expect(code(() => parseQuantity('-1'))).toBe('bad_quantity');
    expect(code(() => parseQuantity('1.2345'))).toBe('bad_quantity');
  });
  it('TC24 discount above gross', () => {
    expect(code(() => computeDocument(doc([L(1, 1000n, 0, { discountPaise: 1001n })])))).toBe('discount_exceeds_gross');
  });
  it('TC25 rate not in the allowed list, and a custom list is honoured', () => {
    expect(code(() => computeDocument(doc([L(1, 1000n, 1700)])))).toBe('rate_not_allowed');
    expect(code(() => computeDocument(doc([L(1, 1000n, 1700)], { allowedRateBp: new Set([1700]) })))).toBe('no error');
  });
  it('no lines, negative rate and negative discount', () => {
    expect(code(() => computeDocument(doc([])))).toBe('no_lines');
    expect(code(() => computeDocument(doc([L(1, -1n, 0)])))).toBe('negative_amount');
    expect(code(() => computeDocument(doc([L(1, 100n, 0, { discountPaise: -1n })])))).toBe('negative_amount');
  });
});

describe('identifiers and rules', () => {
  it('TC26 known GSTINs', () => {
    expect(gstinValid('27AAPFU0939F1ZV')).toBe(true);
    expect(gstinValid('27AAPFU0939F1ZW')).toBe(false);
    expect(gstinValid('27aapfu0939f1zv')).toBe(false);
    expect(gstinValid('27AAPFU0939F1Z')).toBe(false);
  });
  it('TC27 GSTIN state must match the address state', () => {
    expect(code(() => assertGstinMatchesState('27AAPFU0939F1ZV', '29'))).toBe('gstin_state_mismatch');
    expect(code(() => assertGstinMatchesState('27AAPFU0939F1ZV', '27'))).toBe('no error');
    expect(code(() => assertGstinMatchesState('27AAPFU0939F1ZX', '27'))).toBe('gstin_invalid');
  });
  it('TC28 invoice number: max 16 characters, safe characters only', () => {
    expect(code(() => validateInvoiceNumber('INV/2026-27/00001'))).toBe('number_too_long');
    expect(code(() => validateInvoiceNumber('INV/2026-27/001'))).toBe('no error');
    expect(code(() => validateInvoiceNumber('INV 001'))).toBe('number_bad_characters');
  });
  it('TC30 HSN length follows the policy', () => {
    expect(checkHsn('8471', 'under_5cr')).toEqual({ ok: true });
    expect(checkHsn('8471', 'over_5cr')).toMatchObject({ ok: false, level: 'error' });
    expect(checkHsn('8471', 'over_5cr', { minDigits: { under_5cr: 4, over_5cr: 6 }, onShort: 'warn' })).toMatchObject({ ok: false, level: 'warn' });
    expect(checkHsn(null, 'under_5cr')).toMatchObject({ ok: false });
    expect(checkHsn('847130', 'over_5cr')).toEqual({ ok: true });
  });
  it('formats rupees with lakh and crore grouping', () => {
    expect(formatRupees(118000n)).toBe('Rs 1,180.00');
    expect(formatRupees(123456789n)).toBe('Rs 12,34,567.89');
    expect(formatRupees(5n)).toBe('Rs 0.05');
    expect(formatRupees(-1500000000n)).toBe('-Rs 1,50,00,000.00');
  });
});

describe('rupee parsing and words', () => {
  it('parses rupee strings exactly', () => {
    expect(parseRupees('1000')).toBe(100000n);
    expect(parseRupees('1,000.5')).toBe(100050n);
    expect(parseRupees('0.07')).toBe(7n);
    expect(code(() => parseRupees('1.234'))).toBe('negative_amount');
    expect(code(() => parseRupees('-5'))).toBe('negative_amount');
    expect(code(() => parseRupees('abc'))).toBe('negative_amount');
  });
  it('writes amounts in words with lakh and crore', () => {
    expect(rupeesInWords(118000n)).toBe('Rupees One Thousand One Hundred Eighty Only');
    expect(rupeesInWords(100n)).toBe('Rupees One Only');
    expect(rupeesInWords(12345678n)).toBe('Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Eight Paise Only');
    expect(rupeesInWords(150000000n)).toBe('Rupees Fifteen Lakh Only');
    expect(rupeesInWords(1000000000n)).toBe('Rupees One Crore Only');
    expect(rupeesInWords(7n)).toBe('Paise Seven Only');
    expect(rupeesInWords(0n)).toBe('Rupees Zero Only');
  });
});
