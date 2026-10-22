import {
  allowedRatesOn, assertCreditWithinOriginal, checkHsn, computeDocument, CURRENCIES, dueDateFor, formatMoney, isPaymentTerm, isTaxError, parseExchangeRate, parseQuantity, parseRupees, resolvePlaceOfSupply, roundHalfUp,
  type DocType, type DocumentResult, type LineInput, type TurnoverBand,
} from '@kora/tax';
import type { Sql, Tx } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { ConflictError, isDate, str, todayIn, ValidationError } from './validation.js';
import { scheduleReminders } from './reminders.js';
import { queueEinvoiceIfRequired } from './einvoice.js';
import { emitEvent } from './webhooks.js';
import { copyCustom, resolveCustom } from './customfields.js';

export const DOC_TYPES: readonly DocType[] =
  ['tax_invoice', 'bill_of_supply', 'estimate', 'proforma', 'delivery_challan', 'credit_note', 'debit_note', 'sales_order'];
/** Documents that may be priced in another currency. A tax document is always in rupees. */
export const FOREIGN_OK: ReadonlySet<string> = new Set(['estimate', 'proforma', 'sales_order']);
const TAX_DOCS: ReadonlySet<string> = new Set(['tax_invoice', 'credit_note', 'debit_note']);
const SERIES_PREFIX: Record<DocType, string> = {
  tax_invoice: 'INV', bill_of_supply: 'BOS', estimate: 'EST', proforma: 'PRO', delivery_challan: 'DC', credit_note: 'CN', debit_note: 'DN', sales_order: 'SO',
};

/** Why a note is raised. Each kind of note offers only the reasons that make sense for it. */
export const NOTE_REASONS: Record<'credit_note' | 'debit_note', readonly string[]> = {
  credit_note: ['goods_returned', 'post_sale_discount', 'price_correction', 'service_deficiency', 'tax_rate_correction', 'other'],
  debit_note: ['additional_charge', 'price_correction', 'quantity_correction', 'tax_rate_correction', 'other'],
};

export interface LineIn {
  itemId?: string | null;
  name: string;
  hsnSac?: string | null;
  unit?: string;
  quantity: string;      // "1.5"
  rate: string;          // rupees, "1000.50"
  discount?: string;     // rupees
  taxRateBp: number;
  cessRateBp?: number;
  kind?: 'goods' | 'service';
  /** The rate (and discount) already include GST, as a shop's MRP does. */
  taxInclusive?: boolean;
}

export interface DocIn {
  docType: DocType;
  partyId?: string | null;
  docDate?: string;
  dueDate?: string | null;
  shipToState?: string | null;
  placeOfSupply?: string | null;
  reverseCharge?: boolean;
  lines: LineIn[];
  notes?: string | null;
  terms?: string | null;
  /** The buyer's order or PO number, printed on the document. */
  reference?: string | null;
  /** One line under the title, for example "Website redesign, phase 2". */
  subject?: string | null;
  /** One of PAYMENT_TERMS. A preset other than "custom" fills the due date when none is given. */
  paymentTerms?: string | null;
  /** Up to five label and value pairs printed under the document's header, for things like a vehicle number or a project code. */
  extra?: { label: string; value: string }[] | null;
  /** Who made the sale, as the person wants it printed. */
  salesperson?: string | null;
  tcsBp?: number;
  tdsBp?: number;
  originalDocumentId?: string | null;
  /** Why a credit or debit note was raised, one of NOTE_REASONS, and an optional sentence of detail. */
  /** A manual plus or minus on the total, in rupees ("-5" or "12.50"), not taxed. Shown as its own line under the label given. */
  adjustment?: string | null;
  adjustmentLabel?: string | null;
  /** Round the total to the nearest whole rupee. On unless set to false. A document in another currency is never rounded. */
  roundTotal?: boolean;
  /** A rupee document can also show its total in this currency, at the rate given, as a reference. Never changes the tax. */
  displayCurrency?: string | null;
  displayRate?: string | null;
  /** Answers to the business's custom document fields, by field id. */
  custom?: Record<string, string> | null;
  noteReason?: string | null;
  noteReasonDetail?: string | null;
  /** A revised quote points at the one it replaces. */
  previousVersionId?: string | null;
  version?: number;
  /** The document this one was made from (a quote turned into an order, an order into an invoice). */
  sourceDocumentId?: string | null;
  /** Estimates and proforma invoices only. A GST tax document is always in rupees. */
  currency?: string;
  /** Rupees per one unit of the currency, for example "83.25". Required when the currency is not INR. */
  exchangeRate?: string;
}

/** HSN rules until the CA-approved config exists: block above Rs 5 crore, warn below. */
const HSN_ON_SHORT: Record<TurnoverBand, 'reject' | 'warn'> = { under_5cr: 'warn', over_5cr: 'reject' };
const hsnPolicy = (band: TurnoverBand) => ({ minDigits: { under_5cr: 4, over_5cr: 6 }, onShort: HSN_ON_SHORT[band] });

const rs = (p: bigint | string) => { const n = BigInt(p); return `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`; };
/** Paise as signed rupee text, "-0.50" or "12.00", the form an adjustment is typed in. */
const signedRs = (p: bigint) => (p < 0n ? `-${rs(-p)}` : rs(p));
const milliStr = (m: bigint) => `${m / 1000n}.${(m % 1000n).toString().padStart(3, '0')}`;

/** Trigger and constraint messages are written for people; pass them through as validation errors. */
export function mapDbError(e: unknown): never {
  const code = (e as { code?: string }).code;
  if ((code === '23514' || code === '23000') && e instanceof Error) throw new ValidationError(e.message);
  throw e;
}

interface Built {
  biz: { registration_type: string; state_code: string; turnover_band: TurnoverBand; timezone: string };
  result: DocumentResult;
  placeOfSupply: string;
  docDate: string;
  currency: string;
  rateMicro: bigint;
  lines: { input: LineIn; hsn: string | null; unit: string; quantityMilli: bigint; rate: bigint; discount: bigint }[];
  warnings: string[];
}

async function build(tx: Tx, t: TenantSession, input: DocIn): Promise<Built> {
  if (!DOC_TYPES.includes(input.docType)) throw new ValidationError('Choose a document type.', 'docType');
  const [biz] = await tx`select registration_type, state_code, turnover_band, timezone from business where id = ${t.businessId}`;
  if (!biz) throw new ValidationError('Business not found.');
  const [party] = input.partyId ? await tx`select state_code, shipping_address from party where id = ${input.partyId}` : [];
  if (input.partyId && !party) throw new ValidationError('Customer not found.', 'partyId');
  if (['credit_note', 'debit_note', 'delivery_challan'].includes(input.docType) && !party) {
    throw new ValidationError('Choose a customer for this document.', 'partyId');
  }
  const currency = String(input.currency ?? 'INR').toUpperCase();
  if (!(CURRENCIES as readonly string[]).includes(currency)) throw new ValidationError('Choose one of the supported currencies.', 'currency');
  let rateMicro = 1_000_000n;
  if (currency !== 'INR') {
    if (!FOREIGN_OK.has(input.docType)) throw new ValidationError('A tax invoice is always in rupees. Use an estimate, a sales order or a proforma invoice to quote in another currency.', 'currency');
    try { rateMicro = parseExchangeRate(String(input.exchangeRate ?? '')); } catch (e) { throw new ValidationError((e as Error).message, 'exchangeRate'); }
  }
  const docDate = input.docDate ?? todayIn(biz.timezone as string);
  if (!isDate(docDate)) throw new ValidationError('Enter the date as YYYY-MM-DD.', 'docDate');
  if (input.dueDate && !isDate(input.dueDate)) throw new ValidationError('Enter the due date as YYYY-MM-DD.', 'dueDate');
  if (input.paymentTerms && !isPaymentTerm(input.paymentTerms)) throw new ValidationError('Choose one of the payment terms.', 'paymentTerms');
  if (!input.lines?.length) throw new ValidationError('Add at least one line.', 'lines');
  if (input.lines.length > 200) throw new ValidationError('A document can have at most 200 lines.', 'lines');

  const warnings: string[] = [];
  const built = input.lines.map((l, i) => {
    const name = str(l.name, `Line ${i + 1} description`, { required: true })!;
    const hsn = str(l.hsnSac, 'HSN or SAC', { max: 8 });
    if (hsn && !/^[0-9]{4,8}$/.test(hsn)) throw new ValidationError(`Line ${i + 1}: HSN or SAC is 4 to 8 digits.`, 'hsnSac');
    let quantityMilli: bigint, rate: bigint, discount: bigint;
    try {
      quantityMilli = parseQuantity(String(l.quantity));
      rate = parseRupees(String(l.rate));
      discount = l.discount ? parseRupees(String(l.discount)) : 0n;
    } catch (e) { throw new ValidationError(`Line ${i + 1}: ${(e as Error).message}`); }
    if (TAX_DOCS.has(input.docType)) {
      const h = checkHsn(hsn, biz.turnover_band as TurnoverBand, hsnPolicy(biz.turnover_band as TurnoverBand));
      if (!h.ok) {
        if (h.level === 'error') throw new ValidationError(`Line ${i + 1}: ${h.message}`, 'hsnSac');
        warnings.push(`Line ${i + 1}: ${h.message}`);
      }
    }
    return { input: { ...l, name }, hsn, unit: str(l.unit, 'Unit', { max: 10 }) ?? 'NOS', quantityMilli, rate, discount };
  });

  const allServices = input.lines.every((l) => l.kind === 'service');
  let placeOfSupply = input.placeOfSupply ?? '';
  // A quote in another currency is not a tax document, so a customer abroad (place 96) is allowed on it.
  if (!placeOfSupply && currency !== 'INR') placeOfSupply = (party?.state_code as string | undefined) ?? (biz.state_code as string);
  if (!placeOfSupply) {
    const billTo = (party?.state_code as string | undefined) ?? (biz.state_code as string);
    const shipTo = input.shipToState ?? ((party?.shipping_address as { stateCode?: string } | null)?.stateCode ?? null);
    try {
      placeOfSupply = resolvePlaceOfSupply({
        kind: allServices ? 'service' : 'goods', billToState: billTo, shipToState: shipTo,
        recipientRegisteredState: party?.state_code as string | undefined,
      });
    } catch (e) { if (isTaxError(e)) throw new ValidationError(e.message); throw e; }
  }

  const lineInputs: LineInput[] = built.map((b) => ({
    quantityMilli: b.quantityMilli, ratePaise: b.rate, discountPaise: b.discount,
    taxRateBp: b.input.taxRateBp, cessRateBp: b.input.cessRateBp ?? 0, taxInclusive: !!b.input.taxInclusive,
  }));
  let adjustmentPaise = 0n;
  if (input.adjustment && String(input.adjustment).trim() !== '') {
    const raw = String(input.adjustment).trim();
    const neg = raw.startsWith('-');
    try { adjustmentPaise = parseRupees(neg ? raw.slice(1) : raw.replace(/^\+/, '')); } catch (e) { throw new ValidationError(`Adjustment: ${(e as Error).message}`, 'adjustment'); }
    if (neg) adjustmentPaise = -adjustmentPaise;
  }
  // The slabs in force on the date of supply (12% and 28% ended on 22 September 2025). A credit or debit note may also carry a
  // rate that was right on the date of the invoice it corrects, so it accepts the slabs of either date.
  let allowedRateBp: ReadonlySet<number> | undefined;
  if ((input.docType === 'credit_note' || input.docType === 'debit_note') && input.originalDocumentId) {
    const [o] = await tx`select doc_date::text as doc_date from document where id = ${input.originalDocumentId}`;
    if (o) allowedRateBp = new Set([...allowedRatesOn(docDate), ...allowedRatesOn(o.doc_date as string)]);
  }
  let result: DocumentResult;
  try {
    result = computeDocument({
      supplyDate: docDate, ...(allowedRateBp ? { allowedRateBp } : {}),
      docType: input.docType, registrationType: biz.registration_type as never, supplierState: biz.state_code as string,
      placeOfSupply, reverseCharge: input.reverseCharge ?? false, lines: lineInputs, tcsBp: input.tcsBp ?? 0, tdsBp: input.tdsBp ?? 0,
      roundTotal: currency === 'INR' && input.roundTotal !== false, adjustmentPaise,
    });
  } catch (e) { if (isTaxError(e)) throw new ValidationError(e.message); throw e; }

  return { biz: biz as never, result, placeOfSupply, docDate, currency, rateMicro, lines: built, warnings };
}

async function creditHeadroom(tx: Tx, originalId: string, excludeId: string | null) {
  const [o] = await tx`select taxable_paise, status, doc_type from document where id = ${originalId}`;
  if (!o || o.status !== 'issued' || !['tax_invoice', 'bill_of_supply'].includes(o.doc_type as string)) {
    throw new ValidationError('Credit and debit notes must point at an issued invoice.', 'originalDocumentId');
  }
  const [c] = await tx`select coalesce(sum(taxable_paise), 0)::text as s from document
                        where original_document_id = ${originalId} and doc_type = 'credit_note' and status = 'issued'
                          and (${excludeId}::uuid is null or id <> ${excludeId})`;
  return { original: BigInt(o.taxable_paise as string), already: BigInt(c!.s as string) };
}

export async function persist(tx: Tx, t: TenantSession, id: string | null, input: DocIn, clientRef: string | null = null) {
  const b = await build(tx, t, input);
  const isNote = input.docType === 'credit_note' || input.docType === 'debit_note';
  if (isNote && input.noteReason && !NOTE_REASONS[input.docType as 'credit_note' | 'debit_note'].includes(input.noteReason)) throw new ValidationError('Choose one of the listed reasons for this note.', 'noteReason');
  if (!isNote && input.noteReason) throw new ValidationError('Only credit and debit notes carry a reason.', 'noteReason');
  if (isNote && !input.originalDocumentId) throw new ValidationError('Choose the invoice this note corrects.', 'originalDocumentId');
  if (!isNote && input.originalDocumentId) throw new ValidationError('Only credit and debit notes point at another invoice.');
  if (isNote) {
    const h = await creditHeadroom(tx, input.originalDocumentId!, id);
    if (input.docType === 'credit_note') {
      try { assertCreditWithinOriginal({ originalTaxablePaise: h.original, alreadyCreditedTaxablePaise: h.already, creditTaxablePaise: b.result.taxablePaise }); }
      catch (e) { if (isTaxError(e)) throw new ValidationError(e.message); throw e; }
    }
  }
  const r = b.result;
  const s = (x: bigint) => x.toString();
  const customValues = await resolveCustom(tx, 'document', input.custom);
  let displayCurrency: string | null = null, displayRate: string | null = null;
  if (input.displayCurrency) {
    displayCurrency = String(input.displayCurrency).toUpperCase();
    if (displayCurrency === 'INR' || !(CURRENCIES as readonly string[]).includes(displayCurrency)) throw new ValidationError('Choose a currency other than rupees to show as well.', 'displayCurrency');
    if (b.currency !== 'INR') throw new ValidationError('This document is already in another currency. Its rupee equivalent is printed automatically.', 'displayCurrency');
    try { displayRate = parseExchangeRate(String(input.displayRate ?? '')).toString(); } catch (e) { throw new ValidationError((e as Error).message, 'displayRate'); }
  }
  const fields = {
    doc_type: input.docType, party_id: input.partyId ?? null, place_of_supply: b.placeOfSupply,
    reverse_charge: input.reverseCharge ?? false, doc_date: b.docDate, due_date: input.dueDate ?? null,
    taxable: s(r.taxablePaise), cgst: s(r.cgstPaise), sgst: s(r.sgstPaise), igst: s(r.igstPaise), cess: s(r.cessPaise),
    tcs: s(r.tcsPaise), tds: s(r.tdsPaise), round_off: s(r.roundOffPaise), grand: s(r.grandTotalPaise),
    notes: str(input.notes, 'Notes', { max: 2000 }), terms: str(input.terms, 'Terms', { max: 2000 }),
    original: input.originalDocumentId ?? null, tcs_bp: input.tcsBp ?? 0, tds_bp: input.tdsBp ?? 0, currency: b.currency, rate: b.rateMicro.toString(),
    reference: str(input.reference, 'Reference', { max: 60 }), subject: str(input.subject, 'Subject', { max: 200 }), payment_terms: input.paymentTerms || null,
    extra: cleanExtra(input.extra), salesperson: str(input.salesperson, 'Salesperson', { max: 80 }),
    adjustment: s(r.adjustmentPaise), adjustment_label: input.adjustment && r.adjustmentPaise !== 0n ? (str(input.adjustmentLabel, 'Adjustment name', { max: 40 }) ?? 'Adjustment') : null, round_total: input.roundTotal !== false,
    custom_values: customValues === null ? null : tx.json(customValues as never), display_currency: displayCurrency, display_rate: displayRate,
    note_reason: input.noteReason ?? null, note_reason_detail: str(input.noteReasonDetail, 'Detail', { max: 300 }),
    previous_version_id: input.previousVersionId ?? null, version: input.version ?? 1, source_document_id: input.sourceDocumentId ?? null,
  };
  // A preset fills the due date when the person left it empty. An explicit date always wins.
  if (!fields.due_date && fields.payment_terms) fields.due_date = dueDateFor(b.docDate, fields.payment_terms);
  let docId = id;
  if (id) {
    const [cur] = await tx`select status from document where id = ${id} for update`;
    if (!cur) throw new ValidationError('Document not found.');
    if (cur.status !== 'draft') throw new ValidationError('Only a draft can be edited. Issue a credit or debit note to correct an issued document.');
    await tx`delete from document_line where document_id = ${id}`;
    await tx`update document set doc_type = ${fields.doc_type}, party_id = ${fields.party_id}, place_of_supply = ${fields.place_of_supply},
             reverse_charge = ${fields.reverse_charge}, doc_date = ${fields.doc_date}, due_date = ${fields.due_date},
             taxable_paise = ${fields.taxable}, cgst_paise = ${fields.cgst}, sgst_paise = ${fields.sgst}, igst_paise = ${fields.igst},
             cess_paise = ${fields.cess}, tcs_paise = ${fields.tcs}, tds_paise = ${fields.tds}, round_off_paise = ${fields.round_off},
             grand_total_paise = ${fields.grand}, notes = ${fields.notes}, terms = ${fields.terms}, original_document_id = ${fields.original},
             tcs_bp = ${fields.tcs_bp}, tds_bp = ${fields.tds_bp}, currency = ${fields.currency}, exchange_rate_micro = ${fields.rate},
             reference = ${fields.reference}, subject = ${fields.subject}, payment_terms = ${fields.payment_terms},
             extra = ${fields.extra === null ? null : tx.json(fields.extra as any)}, salesperson = ${fields.salesperson},
             adjustment_paise = ${fields.adjustment}, adjustment_label = ${fields.adjustment_label}, round_total = ${fields.round_total},
             custom_values = ${fields.custom_values}, display_currency = ${fields.display_currency}, display_rate_micro = ${fields.display_rate}, note_reason = coalesce(${fields.note_reason}, note_reason), note_reason_detail = coalesce(${fields.note_reason_detail}, note_reason_detail)
             where id = ${id}`;
    // previous_version_id, version and source_document_id are set once, when the draft is made, and never edited.
  } else {
    const [row] = await tx`
      insert into document (business_id, doc_type, party_id, place_of_supply, reverse_charge, doc_date, due_date, taxable_paise, cgst_paise,
                            sgst_paise, igst_paise, cess_paise, tcs_paise, tds_paise, round_off_paise, grand_total_paise, notes, terms,
                            original_document_id, created_by, client_ref, tcs_bp, tds_bp, currency, exchange_rate_micro, reference, subject, payment_terms, extra, salesperson,
                            previous_version_id, version, source_document_id, note_reason, note_reason_detail, custom_values, display_currency, display_rate_micro, adjustment_paise, adjustment_label, round_total)
      values (${t.businessId}, ${fields.doc_type}, ${fields.party_id}, ${fields.place_of_supply}, ${fields.reverse_charge}, ${fields.doc_date},
              ${fields.due_date}, ${fields.taxable}, ${fields.cgst}, ${fields.sgst}, ${fields.igst}, ${fields.cess}, ${fields.tcs}, ${fields.tds},
              ${fields.round_off}, ${fields.grand}, ${fields.notes}, ${fields.terms}, ${fields.original}, ${t.userId}, ${clientRef}, ${fields.tcs_bp}, ${fields.tds_bp}, ${fields.currency}, ${fields.rate}, ${fields.reference}, ${fields.subject}, ${fields.payment_terms}, ${fields.extra === null ? null : tx.json(fields.extra as any)}, ${fields.salesperson},
              ${fields.previous_version_id}, ${fields.version}, ${fields.source_document_id}, ${fields.note_reason}, ${fields.note_reason_detail}, ${fields.custom_values}, ${fields.display_currency}, ${fields.display_rate}, ${fields.adjustment}, ${fields.adjustment_label}, ${fields.round_total})
      returning id`;
    docId = row!.id as string;
  }
  for (let i = 0; i < b.lines.length; i++) {
    const l = b.lines[i]!, c = r.lines[i]!;
    await tx`insert into document_line (business_id, document_id, position, item_id, item_name, hsn_sac, unit, quantity, rate_paise,
               gross_paise, discount_paise, taxable_paise, tax_rate_bp, cess_rate_bp, cgst_paise, sgst_paise, igst_paise, cess_paise, line_total_paise, price_includes_tax)
             values (${t.businessId}, ${docId}, ${i + 1}, ${l.input.itemId ?? null}, ${l.input.name}, ${l.hsn}, ${l.unit}, ${milliStr(l.quantityMilli)},
               ${s(l.rate)}, ${s(c.grossPaise)}, ${s(c.discountPaise)}, ${s(c.taxablePaise)}, ${c.taxRateBp}, ${c.cessRateBp},
               ${s(c.cgstPaise)}, ${s(c.sgstPaise)}, ${s(c.igstPaise)}, ${s(c.cessPaise)}, ${s(c.lineTotalPaise)}, ${!!l.input.taxInclusive})`;
  }
  return { id: docId!, warnings: b.warnings };
}

/**
 * Creates a draft, or replaces the draft `id`. Totals are always computed here, never taken from the client.
 *
 * For devices that sync later: `clientRef` makes a retried create land on the same document instead of a second one,
 * and `baseRev` is the revision the device last saw. If the draft has moved on since, a ConflictError is thrown
 * so the person chooses, rather than one device silently overwriting the other.
 */
export async function saveDraft(sql: Sql, t: TenantSession, input: DocIn, id: string | null = null, opts: { clientRef?: string; baseRev?: number } = {}) {
  if (opts.clientRef !== undefined && !/^[A-Za-z0-9_-]{8,64}$/.test(opts.clientRef)) throw new ValidationError('Invalid client reference.');
  const once = () => inTenant(sql, t, 'document.write', async (tx) => {
    let target = id;
    if (!target && opts.clientRef) {
      const [e] = await tx`select id, status from document where client_ref = ${opts.clientRef}`;
      if (e) {
        if (e.status !== 'draft') {
          const [x] = await tx`select rev from document where id = ${e.id}`;
          return { id: e.id as string, warnings: [] as string[], rev: Number(x!.rev), alreadyIssued: true };
        }
        target = e.id as string;
      }
    }
    if (target && opts.baseRev !== undefined) {
      const [cur] = await tx`select rev, status from document where id = ${target} for update`;
      if (cur && cur.status === 'draft' && Number(cur.rev) !== opts.baseRev) throw new ConflictError(target, Number(cur.rev));
    }
    const r = await persist(tx, t, target, input, opts.clientRef ?? null).catch(mapDbError);
    const [x] = await tx`select rev from document where id = ${r.id}`;
    return { ...r, rev: Number(x!.rev), alreadyIssued: false };
  });
  // Two devices (or one device retrying) can race to create the same client reference. The unique index lets one
  // win; the loser looks it up again and updates that document instead.
  for (let attempt = 0; ; attempt++) {
    try { return await once(); }
    catch (e) { if (opts.clientRef && !id && (e as { code?: string }).code === '23505' && attempt < 3) continue; throw e; }
  }
}

/** Preview totals for the editor without saving anything. */
export async function previewTotals(sql: Sql, t: TenantSession, input: DocIn) {
  return inTenant(sql, t, 'document.read', async (tx) => {
    const b = await build(tx, t, input);
    const r = b.result;
    const s = (x: bigint) => x.toString();
    return {
      currency: b.currency, supply: r.supply, placeOfSupply: b.placeOfSupply, warnings: b.warnings, recommendedDocType: r.recommendedDocType,
      taxable: s(r.taxablePaise), cgst: s(r.cgstPaise), sgst: s(r.sgstPaise), igst: s(r.igstPaise), cess: s(r.cessPaise),
      tcs: s(r.tcsPaise), tds: s(r.tdsPaise), adjustment: s(r.adjustmentPaise), roundOff: s(r.roundOffPaise), grandTotal: s(r.grandTotalPaise), netReceivable: s(r.netReceivablePaise),
      lines: r.lines.map((l) => ({ taxable: s(l.taxablePaise), cgst: s(l.cgstPaise), sgst: s(l.sgstPaise), igst: s(l.igstPaise), cess: s(l.cessPaise), total: s(l.lineTotalPaise) })),
    };
  });
}

async function ensureSeries(tx: Tx, businessId: string, docType: DocType, docDate: string) {
  const [y, m] = docDate.split('-').map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  const short = `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
  const prefix = `${SERIES_PREFIX[docType]}/${short}/`;
  await tx`insert into number_series (business_id, doc_type, prefix, financial_year, pad_width)
           select ${businessId}, ${docType}, ${prefix}, fy_label(${docDate}::date), 4
            where not exists (select 1 from number_series where business_id = ${businessId} and doc_type = ${docType}
                                and financial_year = fy_label(${docDate}::date))
           on conflict do nothing`;
}

export async function getDocumentTx(tx: Tx, id: string) {
  const [d] = await tx`select d.*, p.name as party_name, p.gstin as party_gstin, o.number as original_number
                         from document d left join party p on p.id = d.party_id left join document o on o.id = d.original_document_id
                        where d.id = ${id}`;
  if (!d) return null;
  const lines = await tx`select * from document_line where document_id = ${id} order by position`;
  const deliveries = await tx`select id, channel, to_address, status, error_message, created_at from delivery where document_id = ${id} order by created_at desc`;
  const [writeOff] = await tx`select id, amount_paise::text as amount_paise, reason, written_off_on::text as written_off_on
                                from document_write_off where document_id = ${id} and cancelled_at is null`;
  let estimate: Record<string, unknown> | null = null;
  if (d.doc_type === 'estimate') {
    const [e] = await tx`select estimate_status(d.status, d.due_date, b.timezone, es.decision, es.converted_to_id) as status,
                                es.decision, es.decided_at, es.decision_comment, es.decided_by_name, es.decided_via, es.converted_to_id, c.number as converted_number, c.status as converted_status
                           from document d join business b on b.id = d.business_id
                           left join estimate_state es on es.document_id = d.id
                           left join document c on c.id = es.converted_to_id
                          where d.id = ${id}`;
    estimate = e ?? null;
  }
  const versions = await versionChain(tx, d as never);
  const [source] = d.source_document_id ? await tx`select id, number, doc_type from document where id = ${d.source_document_id}` : [];
  // What was made from this document: a quote turned into an order, an order into an invoice.
  const children = await tx`select id, number, doc_type, status from document where source_document_id = ${id} order by created_at`;
  return { document: d, lines, deliveries, estimate, writeOff: writeOff ?? null, versions, source: source ?? null, children };
}

/** Every version of a quote, oldest first, when the document has been revised or is a revision. Empty for a document with one version. */
async function versionChain(tx: Tx, d: { id: string; previous_version_id: string | null }) {
  let rootId = d.id;
  let prev = d.previous_version_id;
  for (let i = 0; prev && i < 100; i++) {
    rootId = prev;
    const [p] = await tx`select previous_version_id from document where id = ${prev}`;
    prev = (p?.previous_version_id as string | null) ?? null;
  }
  const chain: { id: string; number: string | null; version: number; status: string }[] = [];
  let cur: string | null = rootId;
  for (let i = 0; cur && i < 100; i++) {
    const [r] = (await tx`select id, number, version, status from document where id = ${cur}`) as Record<string, any>[];
    if (!r) break;
    chain.push({ id: r.id as string, number: r.number as string | null, version: Number(r.version), status: r.status as string });
    const [n] = (await tx`select id from document where previous_version_id = ${cur} order by version limit 1`) as { id: string }[];
    cur = n?.id ?? null;
  }
  return chain.length > 1 ? chain : [];
}

export async function getDocument(sql: Sql, t: TenantSession, id: string) {
  return inTenant(sql, t, 'document.read', (tx) => getDocumentTx(tx, id));
}

export async function listDocuments(sql: Sql, t: TenantSession, f: { type?: string; status?: string; q?: string; limit?: number; offset?: number } = {}) {
  return inTenant(sql, t, 'document.read', (tx) => tx`
    select d.id, d.doc_type, d.status, d.number, d.doc_date, d.due_date, d.grand_total_paise, d.amount_settled_paise, d.payment_status,
           d.einvoice_status, d.party_id, p.name as party_name, d.currency,
           case when d.doc_type = 'estimate' then estimate_status(d.status, d.due_date, b.timezone, es.decision, es.converted_to_id) end as estimate_status
      from document d left join party p on p.id = d.party_id
      join business b on b.id = d.business_id left join estimate_state es on es.document_id = d.id
     where (${f.type ?? null}::text is null or d.doc_type = ${f.type ?? ''})
       and (${f.status ?? null}::text is null or d.status = ${f.status ?? ''})
       and (${f.q ?? null}::text is null or d.number ilike ${'%' + (f.q ?? '') + '%'} or p.name ilike ${'%' + (f.q ?? '') + '%'})
     order by d.doc_date desc, d.created_at desc limit ${Math.min(f.limit ?? 50, 200)} offset ${f.offset ?? 0}`);
}

/**
 * Issues a draft. The database assigns the next number under a row lock and re-checks totals,
 * so concurrent issues from any code path stay gapless.
 */
export async function issueDocument(sql: Sql, t: TenantSession, id: string) {
  return inTenant(sql, t, 'document.issue', (tx) => issueTx(tx, t, id));
}

/** The issue steps, for callers that already hold the tenant transaction (the recurring runner). */
export async function issueTx(tx: Tx, t: TenantSession, id: string) {
  {
    const [d] = await tx`select id, status, doc_type, doc_date, original_document_id from document where id = ${id} for update`;
    if (!d) throw new ValidationError('Document not found.');
    if (d.status !== 'draft') throw new ValidationError('This document is already issued.');
    const [biz] = await tx`select turnover_band from business where id = ${t.businessId}`;
    if (TAX_DOCS.has(d.doc_type as string)) {
      const bad = await tx`select position from document_line where document_id = ${id} and hsn_sac is null order by position`;
      const band = biz!.turnover_band as TurnoverBand;
      if (bad.length && hsnPolicy(band).onShort === 'reject') {
        throw new ValidationError(`Line ${bad[0]!.position}: HSN or SAC is required.`, 'hsnSac');
      }
    }
    if (d.doc_type === 'credit_note') {
      const h = await creditHeadroom(tx, d.original_document_id as string, id);
      const [cur] = await tx`select taxable_paise from document where id = ${id}`;
      try { assertCreditWithinOriginal({ originalTaxablePaise: h.original, alreadyCreditedTaxablePaise: h.already, creditTaxablePaise: BigInt(cur!.taxable_paise as string) }); }
      catch (e) { if (isTaxError(e)) throw new ValidationError(e.message); throw e; }
    }
    await ensureSeries(tx, t.businessId, d.doc_type as DocType, d.doc_date as string);
    try {
      await tx`update document set status = 'issued' where id = ${id}`;
    } catch (e) { mapDbError(e); }
    // Issuing a revised quote withdraws the one it replaces, so only one version is ever open. The old number stays used.
    const [prevV] = await tx`select p.id from document p join document n on n.previous_version_id = p.id
                              where n.id = ${id} and p.status = 'issued' and p.doc_type = 'estimate'`;
    if (prevV) {
      await tx`update document set status = 'cancelled', cancel_reason = 'Replaced by a newer version of this quote' where id = ${prevV.id}`;
    }
    // Work that must exist once a document is issued is queued in this same transaction.
    const [issued] = await tx`select id, business_id, doc_type, due_date, einvoice_required from document where id = ${id}`;
    await scheduleReminders(tx, issued as never);
    await queueEinvoiceIfRequired(tx, issued as never);
    const [ev] = await tx`select d.number, d.doc_type, d.doc_date::text as doc_date, d.due_date::text as due_date, d.currency, d.grand_total_paise::text as total_paise, d.party_id, p.name as party_name
                            from document d left join party p on p.id = d.party_id where d.id = ${id}`;
    await emitEvent(tx, t.businessId, 'document.issued', { id, ...ev });
    return (await getDocumentTx(tx, id))!;
  }
}

export async function cancelDocument(sql: Sql, t: TenantSession, id: string, reason: string) {
  const why = str(reason, 'Reason', { required: true, max: 500 })!;
  return inTenant(sql, t, 'document.cancel', async (tx) => {
    try {
      const r = await tx`update document set status = 'cancelled', cancel_reason = ${why} where id = ${id} and status = 'issued' returning id`;
      if (r.length === 0) throw new ValidationError('Only an issued document can be cancelled.');
    } catch (e) { if (e instanceof ValidationError) throw e; mapDbError(e); }
    const [ev] = await tx`select number, doc_type from document where id = ${id}`;
    await emitEvent(tx, t.businessId, 'document.cancelled', { id, number: ev!.number, doc_type: ev!.doc_type, reason: why });
    return (await getDocumentTx(tx, id))!;
  });
}

/** Only a document that puts money on the books as receivable can be written off. */
const WRITE_OFF_DOCS: ReadonlySet<string> = new Set(['tax_invoice', 'bill_of_supply', 'debit_note']);

/**
 * Writes the unpaid remainder of an issued invoice off as a bad debt, so it stops showing as receivable.
 *
 * This is not a credit note and must never be built out of one. A credit note reverses the supply and the tax on it;
 * a write-off accepts that the supply happened, the tax on it was declared in GSTR-1 and paid through GSTR-3B, and
 * only the money will not come. GST gives no bad-debt relief, so nothing on the document moves: the taxable value,
 * every tax column and the grand total stay exactly as filed, and GSTR-1, GSTR-3B and the sales register are
 * unchanged. Only the receivable view, the ageing report and the customer's statement notice.
 *
 * The amount is always what is still owed on the day, never a figure from the client, and it is frozen on the row
 * so a later movement cannot rewrite it.
 */
export async function writeOffInvoice(sql: Sql, t: TenantSession, id: string, reason: string) {
  const why = str(reason, 'Reason', { required: true, max: 500 })!;
  return inTenant(sql, t, 'document.cancel', async (tx) => {
    const [d] = await tx`select status, doc_type, grand_total_paise, amount_settled_paise from document where id = ${id} for update`;
    if (!d) throw new ValidationError('Document not found.');
    if (!WRITE_OFF_DOCS.has(d.doc_type as string)) throw new ValidationError('Only an invoice, a bill of supply or a debit note can be written off.');
    if (d.status === 'draft') throw new ValidationError('Issue this document before you write it off. A draft owes nothing.');
    if (d.status !== 'issued') throw new ValidationError('Only an issued document can be written off. This one is cancelled.');
    const owed = BigInt(d.grand_total_paise as string) - BigInt(d.amount_settled_paise as string);
    if (owed <= 0n) throw new ValidationError('This invoice is paid in full, so there is nothing to write off.');
    const [live] = await tx`select id from document_write_off where document_id = ${id} and cancelled_at is null`;
    if (live) throw new ValidationError('This invoice is already written off. Cancel that write-off first.');
    const [biz] = await tx`select timezone from business where id = ${t.businessId}`;
    try {
      await tx`insert into document_write_off (business_id, document_id, amount_paise, reason, written_off_on, created_by)
               values (${t.businessId}, ${id}, ${owed.toString()}, ${why}, ${todayIn(biz!.timezone as string)}, ${t.userId})`;
    } catch (e) { mapDbError(e); }
    return (await getDocumentTx(tx, id))!;
  });
}

/** Reverses a write-off, because the money turned up after all or it was written off by mistake. The row stays, with the reason. */
export async function cancelWriteOff(sql: Sql, t: TenantSession, id: string, reason: string) {
  const why = str(reason, 'Reason', { required: true, max: 500 })!;
  return inTenant(sql, t, 'document.cancel', async (tx) => {
    try {
      const r = await tx`update document_write_off set cancelled_at = now(), cancel_reason = ${why}
                          where document_id = ${id} and cancelled_at is null returning id`;
      if (r.length === 0) throw new ValidationError('This invoice is not written off, so there is nothing to cancel.');
    } catch (e) { if (e instanceof ValidationError) throw e; mapDbError(e); }
    return (await getDocumentTx(tx, id))!;
  });
}

/**
 * Puts a cancelled document back to issued, under the same number, with the reason recorded beside the
 * cancellation reason. Refused when the e-invoice was cancelled on the GST portal: that IRN cannot be revived,
 * so the only honest answer is a fresh invoice.
 */
export async function reopenDocument(sql: Sql, t: TenantSession, id: string, reason: string) {
  const why = str(reason, 'Reason', { required: true, max: 500 })!;
  return inTenant(sql, t, 'document.cancel', async (tx) => {
    try {
      const r = await tx`update document set status = 'issued', reopen_reason = ${why} where id = ${id} and status = 'cancelled' returning id`;
      if (r.length === 0) throw new ValidationError('Only a cancelled document can be re-opened.');
    } catch (e) { if (e instanceof ValidationError) throw e; mapDbError(e); }
    return (await getDocumentTx(tx, id))!;
  });
}

export async function deleteDraft(sql: Sql, t: TenantSession, id: string): Promise<void> {
  await inTenant(sql, t, 'document.write', async (tx) => {
    try {
      const r = await tx`delete from document where id = ${id} and status = 'draft' returning id`;
      if (r.length === 0) throw new ValidationError('Only a draft can be deleted.');
    } catch (e) { if (e instanceof ValidationError) throw e; mapDbError(e); }
  });
}

/** Keeps the rows that have both a label and a value, trimmed, at most five. Anything past five is an error, not silently dropped. */
export function cleanExtra(rows: { label?: unknown; value?: unknown }[] | null | undefined): { label: string; value: string }[] | null {
  if (!rows || rows.length === 0) return null;
  const out: { label: string; value: string }[] = [];
  for (const r of rows) {
    const label = str(r?.label as string, 'Extra detail name', { max: 40 });
    const value = str(r?.value as string, 'Extra detail value', { max: 120 });
    if (!label && !value) continue;
    if (!label || !value) throw new ValidationError('Give each extra detail both a name and a value.', 'extra');
    out.push({ label, value });
  }
  if (out.length > 5) throw new ValidationError('A document can have at most five extra details.', 'extra');
  return out.length ? out : null;
}

/** Everything the renderer needs to draw a draft that is not saved yet. Same build as saving, nothing is written. */
export async function previewDocumentData(sql: Sql, t: TenantSession, input: DocIn) {
  return inTenant(sql, t, 'document.read', async (tx) => {
    const b = await build(tx, t, input);
    const r = b.result;
    const s = (x: bigint) => x.toString();
    const [supplier] = await tx`select legal_name, trade_name, gstin, state_code, address, phone, email, upi_vpa, bank_details from business where id = ${t.businessId}`;
    const [recipient] = input.partyId ? await tx`select name, gstin, billing_address, shipping_address, phone, email from party where id = ${input.partyId}` : [];
    const [original] = input.originalDocumentId ? await tx`select number from document where id = ${input.originalDocumentId}` : [];
    const doc = {
      doc_type: input.docType, status: 'draft', number: null, doc_date: b.docDate,
      due_date: input.dueDate || (input.paymentTerms ? dueDateFor(b.docDate, input.paymentTerms) : null),
      place_of_supply: b.placeOfSupply, reverse_charge: input.reverseCharge ?? false, currency: b.currency, exchange_rate_micro: b.rateMicro.toString(),
      taxable_paise: s(r.taxablePaise), cgst_paise: s(r.cgstPaise), sgst_paise: s(r.sgstPaise), igst_paise: s(r.igstPaise), cess_paise: s(r.cessPaise),
      tcs_paise: s(r.tcsPaise), tds_paise: s(r.tdsPaise), round_off_paise: s(r.roundOffPaise), adjustment_paise: s(r.adjustmentPaise), adjustment_label: r.adjustmentPaise !== 0n ? (str(input.adjustmentLabel, 'Adjustment name', { max: 40 }) ?? 'Adjustment') : null, grand_total_paise: s(r.grandTotalPaise),
      notes: str(input.notes, 'Notes', { max: 2000 }), terms: str(input.terms, 'Terms', { max: 2000 }), reference: str(input.reference, 'Reference', { max: 60 }),
      subject: str(input.subject, 'Subject', { max: 200 }), extra: cleanExtra(input.extra), salesperson: str(input.salesperson, 'Salesperson', { max: 80 }),
      original_number: original?.number ?? null, custom_values: await resolveCustom(tx, 'document', input.custom),
      display_currency: input.displayCurrency ? String(input.displayCurrency).toUpperCase() : null,
      display_rate_micro: input.displayCurrency && input.displayRate ? (() => { try { return parseExchangeRate(String(input.displayRate)).toString(); } catch { return null; } })() : null,
    };
    const lines = b.lines.map((l, i) => {
      const c = r.lines[i]!;
      return { item_name: l.input.name, hsn_sac: l.hsn, unit: l.unit, quantity: milliStr(l.quantityMilli), rate_paise: s(l.rate), discount_paise: s(c.discountPaise),
        taxable_paise: s(c.taxablePaise), tax_rate_bp: c.taxRateBp, cgst_paise: s(c.cgstPaise), sgst_paise: s(c.sgstPaise), igst_paise: s(c.igstPaise),
        cess_paise: s(c.cessPaise), line_total_paise: s(c.lineTotalPaise), price_includes_tax: !!l.input.taxInclusive };
    });
    return { doc, lines, supplier: supplier ?? {}, recipient: recipient ?? null };
  });
}

/**
 * Maps stored lines back to editor input, for drafts made from an existing document.
 *
 * `rateMicro` is the quoted rate (millionths of a rupee per unit) when the lines are in another currency, and they are then converted
 * to rupees. The taxable value of each line is converted once, from the quote's own taxable value, and rounded half up to the paisa,
 * so the invoice is worth exactly what the quote was at that rate. Converting the unit rate and then multiplying by the quantity would
 * lose or gain paise (1,000 units at USD 0.01 and 83.25 is Rs 832.50, not 1,000 x Rs 0.83). When the unit rate does not convert to a
 * whole paisa the line is collapsed to one unit of the converted amount, and the original quantity and price go into its description.
 *
 * A tax-inclusive line stores its discount without tax, but is typed in with the tax included, so the discount is worked back
 * from the line total rather than copied. That keeps a copy, a credit note or a conversion worth exactly what the original was.
 */
export function linesToInput(lines: Record<string, unknown>[], rateMicro: bigint = 1_000_000n, currency?: string): LineIn[] {
  return lines.map((l) => {
    const incl = !!l.price_includes_tax;
    const rateF = BigInt(l.rate_paise as string);
    const qtyMilli = parseQuantity(String(l.quantity));
    const grossF = roundHalfUp(qtyMilli * rateF, 1000n);
    const discF = incl ? grossF - BigInt(l.line_total_paise as string) : BigInt(l.discount_paise as string);
    const base = {
      itemId: l.item_id as string | null, name: l.item_name as string, hsnSac: l.hsn_sac as string | null, unit: l.unit as string,
      taxRateBp: l.tax_rate_bp as number, cessRateBp: l.cess_rate_bp as number, taxInclusive: incl,
    };
    if (rateMicro === 1_000_000n) return { ...base, quantity: String(l.quantity), rate: rs(rateF), discount: rs(discF) };

    const conv = (x: bigint) => roundHalfUp(x * rateMicro, 1_000_000n);
    const gross = conv(grossF), value = conv(grossF - discF);        // the line before and after its discount, in rupees
    if ((rateF * rateMicro) % 1_000_000n === 0n) {
      const rate = (rateF * rateMicro) / 1_000_000n;
      if (roundHalfUp(qtyMilli * rate, 1000n) === gross) return { ...base, quantity: String(l.quantity), rate: rs(rate), discount: rs(gross - value) };
    }
    const qty = milliStr(qtyMilli).replace(/\.?0+$/, '');
    const what = `${qty} ${String(l.unit ?? '').trim() || 'units'} at ${formatMoney(rateF, currency ?? 'INR')}`;
    return { ...base, name: `${String(l.item_name).slice(0, 150)} (${what})`, quantity: '1', unit: 'NOS', rate: rs(gross), discount: rs(gross - value) };
  });
}

export interface NoteLinePick {
  /** The line's position on the original invoice, counting from 1. */
  position: number;
  quantity?: string;
  rate?: string;
}

/**
 * A draft credit or debit note. With no `lines` it copies every line of the invoice, ready to edit. With `lines` it carries only the
 * lines picked, at the quantity and rate given. A credit can never be for more than was invoiced: more units or a higher rate than the
 * original is refused here, and the total against the whole invoice is checked again when the note is saved and issued.
 */
export async function startNote(sql: Sql, t: TenantSession, originalId: string, kind: 'credit_note' | 'debit_note',
  opts: { reason?: string | null; detail?: string | null; lines?: NoteLinePick[] } = {}) {
  const src = await inTenant(sql, t, 'document.read', (tx) => getDocumentTx(tx, originalId));
  if (!src || src.document.status !== 'issued') throw new ValidationError('Only an issued invoice can be corrected with a note.');
  if (!['tax_invoice', 'bill_of_supply'].includes(src.document.doc_type as string)) throw new ValidationError('Credit and debit notes correct an invoice or a bill of supply.');
  let lines = linesToInput(src.lines);
  if (opts.lines) {
    if (opts.lines.length === 0) throw new ValidationError('Pick at least one line.', 'lines');
    const seen = new Set<number>();
    lines = opts.lines.map((pick) => {
      const pos = Number(pick.position);
      const orig = src.lines.find((l) => Number(l.position) === pos);
      if (!orig || seen.has(pos)) throw new ValidationError('That line is not on the invoice.', 'lines');
      seen.add(pos);
      const base = linesToInput([orig])[0]!;
      const qty = pick.quantity?.trim() ? pick.quantity.trim() : base.quantity;
      const rate = pick.rate?.trim() ? pick.rate.trim() : base.rate;
      let qMilli: bigint, oMilli: bigint, rPaise: bigint, oRate: bigint;
      try { qMilli = parseQuantity(qty); oMilli = parseQuantity(base.quantity); rPaise = parseRupees(rate); oRate = parseRupees(base.rate); }
      catch (e) { throw new ValidationError(`${base.name}: ${(e as Error).message}`, 'lines'); }
      if (kind === 'credit_note' && qMilli > oMilli) throw new ValidationError(`${base.name}: you invoiced ${base.quantity}, so you cannot credit ${qty}.`, 'lines');
      if (kind === 'credit_note' && rPaise > oRate) throw new ValidationError(`${base.name}: you invoiced at ${base.rate}, so you cannot credit at ${rate}. Use a debit note to charge more.`, 'lines');
      // The line's discount follows the share of the quantity being credited, so a half return takes back half the discount.
      const origDisc = parseRupees(base.discount ?? '0');
      const disc = rPaise === oRate && oMilli > 0n ? roundHalfUp(origDisc * qMilli, oMilli) : 0n;
      return { ...base, quantity: qty, rate, discount: disc > 0n ? rs(disc) : '' };
    });
  }
  const input: DocIn = {
    docType: kind, partyId: src.document.party_id as string | null, originalDocumentId: originalId,
    placeOfSupply: src.document.place_of_supply as string, reverseCharge: src.document.reverse_charge as boolean,
    noteReason: opts.reason ?? null, noteReasonDetail: opts.detail ?? null, lines,
  };
  return saveDraft(sql, t, input);
}

/** What the guided note screen needs: the invoice's lines, how much has already been credited, and the reasons on offer. */
export async function noteContext(sql: Sql, t: TenantSession, originalId: string) {
  return inTenant(sql, t, 'document.read', async (tx) => {
    const src = await getDocumentTx(tx, originalId);
    if (!src) throw new ValidationError('Document not found.');
    const [c] = await tx`select coalesce(sum(taxable_paise), 0)::text as s from document where original_document_id = ${originalId} and doc_type = 'credit_note' and status = 'issued'`;
    const notes = await tx`select id, number, doc_type, status, grand_total_paise::text as grand_total_paise from document where original_document_id = ${originalId} order by created_at`;
    return {
      number: src.document.number as string | null, status: src.document.status as string, docType: src.document.doc_type as string,
      invoicedTaxablePaise: String(src.document.taxable_paise), creditedTaxablePaise: c!.s as string,
      lines: src.lines.map((l) => ({ position: Number(l.position), name: l.item_name as string, quantity: String(l.quantity), unit: l.unit as string, ratePaise: String(l.rate_paise), taxRateBp: Number(l.tax_rate_bp) })),
      notes, reasons: NOTE_REASONS,
    };
  });
}

/**
 * A new draft that copies an existing document of the same kind: the customer, the lines, the notes and the terms.
 * The date is today and the number is given only when it is issued. Credit and debit notes are not copied, because
 * each one answers a particular invoice.
 */
export async function duplicateDocument(sql: Sql, t: TenantSession, sourceId: string) {
  const src = await inTenant(sql, t, 'document.read', (tx) => getDocumentTx(tx, sourceId));
  if (!src) throw new ValidationError('Document not found.');
  const d = src.document;
  if (d.doc_type === 'credit_note' || d.doc_type === 'debit_note') throw new ValidationError('A note answers one invoice. Start a new note from the invoice instead.');
  const rateMicro = BigInt(String(d.exchange_rate_micro ?? 1_000_000));
  const foreign = !!d.currency && d.currency !== 'INR';
  const custom = await inTenant(sql, t, 'document.read', (tx) => copyCustom(tx, d.custom_values));
  const input: DocIn = {
    custom, roundTotal: d.round_total !== false,
    ...(BigInt(String(d.adjustment_paise ?? 0)) !== 0n ? { adjustment: signedRs(BigInt(String(d.adjustment_paise))), adjustmentLabel: d.adjustment_label as string | null } : {}),
    ...(d.display_currency ? { displayCurrency: d.display_currency as string, displayRate: `${BigInt(String(d.display_rate_micro)) / 1_000_000n}.${(BigInt(String(d.display_rate_micro)) % 1_000_000n).toString().padStart(6, '0')}` } : {}),
    docType: d.doc_type as DocType, partyId: d.party_id as string | null, placeOfSupply: d.place_of_supply as string, reverseCharge: d.reverse_charge as boolean,
    notes: d.notes as string | null, terms: d.terms as string | null, reference: d.reference as string | null, subject: d.subject as string | null,
    paymentTerms: d.payment_terms as string | null, extra: d.extra as { label: string; value: string }[] | null, salesperson: d.salesperson as string | null, tcsBp: Number(d.tcs_bp ?? 0), tdsBp: Number(d.tds_bp ?? 0),
    ...(foreign ? { currency: d.currency as string, exchangeRate: `${rateMicro / 1_000_000n}.${(rateMicro % 1_000_000n).toString().padStart(6, '0')}` } : {}),
    lines: linesToInput(src.lines),
  };
  return saveDraft(sql, t, input);
}
