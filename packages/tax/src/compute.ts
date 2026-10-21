import { roundHalfUp, TaxError, type Paise } from './money.js';
import { DEFAULT_ALLOWED_RATE_BP } from './rules.js';

export type DocType =
  | 'tax_invoice' | 'bill_of_supply' | 'estimate' | 'proforma' | 'delivery_challan' | 'credit_note' | 'debit_note' | 'sales_order';
export type RegistrationType = 'unregistered' | 'regular' | 'composition' | 'sez' | 'isd';

export interface LineInput {
  /** Quantity in thousandths: 1.5 units is 1500n. Use parseQuantity() for user input. */
  quantityMilli: bigint;
  ratePaise: Paise;
  discountPaise?: Paise;
  taxRateBp: number;
  /** Ad valorem cess, in basis points of a percent. */
  cessRateBp?: number;
  /** Per-unit cess is not supported in v1. Passing it is an error, never silently ignored. */
  cessSpecificPaisePerUnit?: Paise;
  /**
   * The rate (and any discount) already includes GST and cess, as a shop's MRP does. The line total then comes out as exactly
   * quantity times rate less discount, and the tax is what is inside it. Taxable value is rounded half up from the total, and
   * when the two halves of an in-state tax would differ by a paisa the extra paisa is left in the taxable value, so CGST equals SGST.
   */
  taxInclusive?: boolean;
}

export interface DocumentInput {
  docType: DocType;
  registrationType: RegistrationType;
  supplierState: string;
  placeOfSupply: string;
  reverseCharge?: boolean;
  lines: LineInput[];
  /** TCS rate in basis points of a percent, supplied by the user. */
  tcsBp?: number;
  /** TDS the customer will deduct, in basis points of a percent of the taxable value. */
  tdsBp?: number;
  allowedRateBp?: ReadonlySet<number>;
  /** Round the total to the nearest whole rupee (the default). Documents in other currencies are not rounded. */
  roundTotal?: boolean;
}

export interface LineResult {
  grossPaise: Paise; discountPaise: Paise; taxablePaise: Paise;
  taxRateBp: number; cessRateBp: number;
  cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise; cessPaise: Paise;
  lineTotalPaise: Paise;
}

export interface DocumentResult {
  supply: 'intra' | 'inter';
  lines: LineResult[];
  taxablePaise: Paise; cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise; cessPaise: Paise;
  tcsPaise: Paise; tdsPaise: Paise; roundOffPaise: Paise;
  /** Amount due on the document: tax is excluded under reverse charge. */
  grandTotalPaise: Paise;
  /** What the customer is expected to pay after deducting TDS. */
  netReceivablePaise: Paise;
  /** 'bill_of_supply' when every line is at 0% on a tax invoice; otherwise the requested type. */
  recommendedDocType: DocType;
}

const TAX_DOCS: ReadonlySet<DocType> = new Set(['tax_invoice', 'credit_note', 'debit_note']);
const neg = (code: 'negative_amount', m: string) => new TaxError(code, m);

export function computeLine(l: LineInput, supply: 'intra' | 'inter', allowed: ReadonlySet<number>, ignoreRate = false): LineResult {
  if (l.cessSpecificPaisePerUnit !== undefined && l.cessSpecificPaisePerUnit !== 0n) {
    throw new TaxError('specific_cess_unsupported', 'Per-unit cess is not supported yet. Ask support before issuing this invoice.');
  }
  if (l.quantityMilli <= 0n) throw new TaxError('bad_quantity', 'Quantity must be greater than zero.');
  if (l.ratePaise < 0n) throw neg('negative_amount', 'A rate cannot be negative.');
  const discount = l.discountPaise ?? 0n;
  if (discount < 0n) throw neg('negative_amount', 'A discount cannot be negative.');
  const rateBp = ignoreRate ? 0 : l.taxRateBp;
  if (!ignoreRate && !allowed.has(rateBp)) {
    throw new TaxError('rate_not_allowed', `A tax rate of ${rateBp / 100}% is not in the allowed list.`);
  }
  const cessBp = ignoreRate ? 0 : (l.cessRateBp ?? 0);
  if (cessBp < 0 || !Number.isInteger(cessBp)) throw neg('negative_amount', 'A cess rate cannot be negative.');

  const gross = roundHalfUp(l.quantityMilli * l.ratePaise, 1000n);
  if (discount > gross) throw new TaxError('discount_exceeds_gross', 'A discount cannot be more than the amount before discount.');

  if (l.taxInclusive) {
    const denom = 10000n + BigInt(rateBp) + BigInt(cessBp);
    const total = gross - discount;                                           // what the customer pays for this line
    let taxable = roundHalfUp(total * 10000n, denom);
    let tax = total - taxable;
    const cess = roundHalfUp(taxable * BigInt(cessBp), 10000n);
    let gst = tax - cess;
    if (gst < 0n) { gst = 0n; tax = cess; taxable = total - cess; }
    if (supply === 'intra' && gst % 2n === 1n) { taxable += 1n; gst -= 1n; }     // keep CGST equal to SGST
    const exBefore = roundHalfUp(gross * 10000n, denom);                       // the amount before discount, without tax
    const exDiscount = exBefore - taxable;
    return {
      grossPaise: taxable + (exDiscount > 0n ? exDiscount : 0n), discountPaise: exDiscount > 0n ? exDiscount : 0n, taxablePaise: taxable, taxRateBp: rateBp, cessRateBp: cessBp,
      cgstPaise: supply === 'intra' ? gst / 2n : 0n, sgstPaise: supply === 'intra' ? gst / 2n : 0n, igstPaise: supply === 'intra' ? 0n : gst, cessPaise: cess,
      lineTotalPaise: total,
    };
  }

  const taxable = gross - discount;
  const r = BigInt(rateBp);
  let cgst = 0n, sgst = 0n, igst = 0n;
  if (supply === 'intra') { cgst = sgst = roundHalfUp(taxable * r, 20000n); }
  else { igst = roundHalfUp(taxable * r, 10000n); }
  const cess = roundHalfUp(taxable * BigInt(cessBp), 10000n);
  return {
    grossPaise: gross, discountPaise: discount, taxablePaise: taxable, taxRateBp: rateBp, cessRateBp: cessBp,
    cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst, cessPaise: cess,
    lineTotalPaise: taxable + cgst + sgst + igst + cess,
  };
}

/**
 * The one place tax is computed. Pure: no clock, no I/O, no floating point.
 * Tax is rounded per line and then summed, never recomputed from the document total.
 */
export function computeDocument(d: DocumentInput): DocumentResult {
  if (d.lines.length === 0) throw new TaxError('no_lines', 'Add at least one line.');
  const allowed = d.allowedRateBp ?? DEFAULT_ALLOWED_RATE_BP;
  const composition = d.registrationType === 'composition';

  if (TAX_DOCS.has(d.docType)) {
    if (composition) throw new TaxError('composition_tax_invoice', 'A composition dealer issues a bill of supply, not a tax invoice.');
    if (d.registrationType === 'unregistered') throw new TaxError('unregistered_tax_invoice', 'Only a registered business can issue a tax invoice.');
  }
  if (d.docType === 'bill_of_supply' && !composition && d.lines.some((l) => l.taxRateBp !== 0 || (l.cessRateBp ?? 0) !== 0)) {
    throw new TaxError('bill_of_supply_with_tax', 'A bill of supply cannot charge tax. Use a tax invoice.');
  }

  const supply = d.supplierState === d.placeOfSupply ? 'intra' : 'inter';
  const ignoreRate = d.docType === 'bill_of_supply' && composition;
  const lines = d.lines.map((l) => computeLine(l, supply, allowed, ignoreRate));

  const sum = (f: (l: LineResult) => bigint) => lines.reduce((a, l) => a + f(l), 0n);
  const taxable = sum((l) => l.taxablePaise);
  const cgst = sum((l) => l.cgstPaise), sgst = sum((l) => l.sgstPaise), igst = sum((l) => l.igstPaise);
  const cess = sum((l) => l.cessPaise);
  const charged = d.reverseCharge ? 0n : cgst + sgst + igst + cess;

  const tcsBp = d.tcsBp ?? 0;
  if (tcsBp < 0 || tcsBp > 10000 || !Number.isInteger(tcsBp)) throw neg('negative_amount', 'A TCS rate must be between 0 and 100%.');
  const tcs = roundHalfUp((taxable + charged) * BigInt(tcsBp), 10000n);

  const tdsBp = d.tdsBp ?? 0;
  if (tdsBp < 0 || tdsBp > 10000 || !Number.isInteger(tdsBp)) throw neg('negative_amount', 'A TDS rate must be between 0 and 100%.');
  const tds = roundHalfUp(taxable * BigInt(tdsBp), 10000n);

  const before = taxable + charged + tcs;
  // Round to the nearest rupee, but never turn a small amount into zero: under Rs 1 the total stays exact.
  const roundOff = d.roundTotal === false || before < 100n ? 0n : roundHalfUp(before, 100n) * 100n - before;
  const grand = before + roundOff;

  const allZero = lines.every((l) => l.taxRateBp === 0 && l.cessRateBp === 0);
  return {
    supply, lines, taxablePaise: taxable, cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst, cessPaise: cess,
    tcsPaise: tcs, tdsPaise: tds, roundOffPaise: roundOff, grandTotalPaise: grand, netReceivablePaise: grand - tds,
    recommendedDocType: d.docType === 'tax_invoice' && allZero ? 'bill_of_supply' : d.docType,
  };
}

/** A credit note may not take back more taxable value than the original invoice still holds. */
export function assertCreditWithinOriginal(a: {
  originalTaxablePaise: Paise; alreadyCreditedTaxablePaise: Paise; creditTaxablePaise: Paise;
}): void {
  if (a.alreadyCreditedTaxablePaise + a.creditTaxablePaise > a.originalTaxablePaise) {
    throw new TaxError('credit_exceeds_original', 'The credit note is more than what is left on the original invoice.');
  }
}
