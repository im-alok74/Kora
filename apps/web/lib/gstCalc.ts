import { computeDocument, parseRupees } from '@kora/tax';

export type GstCalc = { base: bigint; cgst: bigint; sgst: bigint; igst: bigint; tax: bigint; total: bigint };

/**
 * One amount, one rate. "exclusive": the amount is before GST. "inclusive": the amount already has GST in it.
 * Uses the same tax library as invoices, so the answer matches what Kora would put on an invoice.
 */
export function calcGst(amountRupees: string, rateBp: number, mode: 'exclusive' | 'inclusive', supply: 'intra' | 'inter'): GstCalc {
  const amount = parseRupees(amountRupees);
  const r = computeDocument({
    docType: 'tax_invoice', registrationType: 'regular', supplierState: '27', placeOfSupply: supply === 'intra' ? '27' : '29', roundTotal: false,
    lines: [{ quantityMilli: 1000n, ratePaise: amount, taxRateBp: rateBp, taxInclusive: mode === 'inclusive' }],
  });
  const tax = r.cgstPaise + r.sgstPaise + r.igstPaise;
  return { base: r.taxablePaise, cgst: r.cgstPaise, sgst: r.sgstPaise, igst: r.igstPaise, tax, total: r.grandTotalPaise };
}
