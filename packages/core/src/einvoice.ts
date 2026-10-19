import { gstinValid, STATE_NAMES } from '@kora/tax';
import { isGspError, type CancelReason, type GspClient, type IrnResult } from '@kora/adapters';
import { SYSTEM_USER, withTenant, type Sql, type Tx } from '@kora/db';
import { enqueue, type JobRow } from './jobs.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { str, ValidationError } from './validation.js';

type Row = Record<string, any>;

export interface EinvoiceProblem { field: string; message: string; fix: string }

/** The invoice cannot be turned into an e-invoice as it stands. Each problem says what to change. */
export class EinvoiceInvalidError extends Error {
  constructor(public problems: EinvoiceProblem[]) {
    super(problems.map((p) => p.message).join(' '));
    this.name = 'EinvoiceInvalidError';
  }
}
export const isEinvoiceInvalid = (e: unknown): e is EinvoiceInvalidError => e instanceof Error && e.name === 'EinvoiceInvalidError';

const TYPE: Record<string, 'INV' | 'CRN' | 'DBN'> = { tax_invoice: 'INV', credit_note: 'CRN', debit_note: 'DBN' };
const DOC_NO = /^[A-Z1-9][A-Z0-9/-]{0,15}$/;
const UQC: Record<string, string> = { NOS: 'NOS', PCS: 'PCS', UNIT: 'UNT', UNITS: 'UNT', KG: 'KGS', KGS: 'KGS', GM: 'GMS', GMS: 'GMS', LTR: 'LTR', L: 'LTR', ML: 'MLT',
  MTR: 'MTR', M: 'MTR', BOX: 'BOX', SET: 'SET', PAIR: 'PRS', PRS: 'PRS', DOZ: 'DOZ', TON: 'TON', SQM: 'SQM', SQF: 'SQF', PACK: 'PAC', PAC: 'PAC', BAG: 'BAG', ROLL: 'ROL' };

/** Paise to a rupee number. Handles negatives (a negative round-off) without mangling the sign. */
export const rupees = (p: unknown): number => {
  const n = BigInt(String(p ?? 0));
  const abs = n < 0n ? -n : n;
  return Number(`${n < 0n ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`);
};
const ddmmyyyy = (d: string) => { const [y, m, day] = d.slice(0, 10).split('-'); return `${day}/${m}/${y}`; };

/**
 * Turns an issued document into the IRP e-invoice JSON. It only reads the numbers Kora already stored, never
 * recomputes tax, and before it returns it proves the document total equals the sum of the item totals, which
 * is the rule the portal enforces and the one rounding differences break.
 */
export function buildIrpPayload(i: { doc: Row; lines: Row[]; supplier: Row; recipient: Row | null; originalNumber?: string | null; originalDate?: string | null }): Record<string, unknown> {
  const { doc: d, lines, supplier: s, recipient: r } = i;
  const problems: EinvoiceProblem[] = [];
  const add = (field: string, message: string, fix: string) => problems.push({ field, message, fix });

  const typ = TYPE[d.doc_type as string];
  if (!typ) add('doc_type', `A ${String(d.doc_type).replace('_', ' ')} is not registered as an e-invoice.`, 'Only tax invoices, credit notes and debit notes are e-invoiced.');
  if (d.reverse_charge) add('reverse_charge', 'E-invoices for reverse-charge supplies are not supported yet.', 'Issue this one without e-invoicing and tell your CA, or contact support.');
  if (!DOC_NO.test(String(d.number ?? ''))) add('number', `The number ${d.number} uses lowercase letters or other characters the portal does not accept.`, 'Change the series prefix in settings to capital letters, digits, / and - only.');
  if (!r) add('recipient', 'There is no buyer on this invoice.', 'E-invoices are for sales to registered businesses. Choose a customer with a GSTIN.');
  if (!s.gstin || !gstinValid(String(s.gstin))) add('seller.gstin', 'Your business GSTIN is missing or not valid.', 'Fix it in Settings, then resubmit.');

  const party = (who: 'seller' | 'buyer', x: Row | null): { a: Row; name: string } => {
    if (!x) return { a: {}, name: '' };
    const a = (x.address ?? x.billing_address ?? {}) as Row;
    const name = String(who === 'seller' ? (x.legal_name ?? '') : (x.name ?? ''));
    const label = who === 'seller' ? 'Your business' : 'The buyer';
    const where = who === 'seller' ? 'Settings, under Business details' : 'the customer details on this invoice';
    if (!name) add(`${who}.name`, `${label} needs a legal name.`, `Add it in ${where}.`);
    if (!a.line1) add(`${who}.address`, `${label} needs an address.`, `Add address line 1 in ${where}.`);
    if (!a.city) add(`${who}.city`, `${label} needs a city.`, `Add the city in ${where}.`);
    if (!/^[1-9]\d{5}$/.test(String(a.pincode ?? ''))) add(`${who}.pincode`, `${label} needs a valid 6-digit pincode.`, `Add the pincode in ${where}.`);
    if (who === 'buyer' && (!x.gstin || !gstinValid(String(x.gstin)))) add('buyer.gstin', 'The buyer GSTIN is missing or not valid.', 'Correct the GSTIN with your customer, then resubmit.');
    return { a, name };
  };
  const sp = party('seller', s);
  const bp = party('buyer', r);

  const items = lines.map((l) => {
    if (!l.hsn_sac || !/^\d{4,8}$/.test(String(l.hsn_sac))) add(`line${l.position}.hsn`, `Line ${l.position} has no valid HSN or SAC.`, 'Credit or replace the invoice with an HSN or SAC on every line.');
    const unit = UQC[String(l.unit ?? '').toUpperCase()] ?? 'OTH';
    const item: Record<string, unknown> = {
      SlNo: String(l.position), PrdDesc: String(l.item_name).slice(0, 300), IsServc: String(l.hsn_sac ?? '').startsWith('99') ? 'Y' : 'N', HsnCd: l.hsn_sac,
      Qty: Number(l.quantity), Unit: unit, UnitPrice: l.price_includes_tax ? Math.round((Number(l.gross_paise) / Number(l.quantity)) * 10) / 1000 : rupees(l.rate_paise), TotAmt: rupees(l.gross_paise), Discount: rupees(l.discount_paise),
      AssAmt: rupees(l.taxable_paise), GstRt: l.tax_rate_bp / 100, IgstAmt: rupees(l.igst_paise), CgstAmt: rupees(l.cgst_paise), SgstAmt: rupees(l.sgst_paise),
      CesRt: l.cess_rate_bp / 100, CesAmt: rupees(l.cess_paise), TotItemVal: rupees(l.line_total_paise),
    };
    return item;
  });

  // The proof: item totals plus charges plus round-off must equal the invoice value, to the paisa.
  const itemTotal = lines.reduce((a, l) => a + BigInt(String(l.line_total_paise)), 0n);
  if (itemTotal + BigInt(String(d.tcs_paise)) + BigInt(String(d.round_off_paise)) !== BigInt(String(d.grand_total_paise))) {
    add('totals', 'The invoice total does not equal the sum of its lines.', 'This should never happen. Contact support with this invoice number.');
  }
  if (problems.length) throw new EinvoiceInvalidError(problems);

  const payload: Record<string, unknown> = {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: typ, No: d.number, Dt: ddmmyyyy(String(d.doc_date)) },
    SellerDtls: {
      Gstin: s.gstin, LglNm: sp.name, ...(s.trade_name ? { TrdNm: s.trade_name } : {}), Addr1: String(sp.a.line1).slice(0, 100),
      ...(sp.a.line2 ? { Addr2: String(sp.a.line2).slice(0, 100) } : {}), Loc: sp.a.city, Pin: Number(sp.a.pincode), Stcd: s.state_code,
      ...(s.phone && /^\d{6,12}$/.test(String(s.phone)) ? { Ph: String(s.phone) } : {}), ...(s.email ? { Em: s.email } : {}),
    },
    BuyerDtls: {
      Gstin: r!.gstin, LglNm: bp.name, Pos: d.place_of_supply, Addr1: String(bp.a.line1).slice(0, 100),
      ...(bp.a.line2 ? { Addr2: String(bp.a.line2).slice(0, 100) } : {}), Loc: bp.a.city, Pin: Number(bp.a.pincode), Stcd: r!.state_code,
    },
    ItemList: items,
    ValDtls: {
      AssVal: rupees(d.taxable_paise), CgstVal: rupees(d.cgst_paise), SgstVal: rupees(d.sgst_paise), IgstVal: rupees(d.igst_paise), CesVal: rupees(d.cess_paise),
      Discount: 0, OthChrg: rupees(d.tcs_paise), RndOffAmt: rupees(d.round_off_paise), TotInvVal: rupees(d.grand_total_paise),
    },
  };
  if (typ !== 'INV' && i.originalNumber) payload.PrecDocDtls = [{ InvNo: i.originalNumber, InvDt: ddmmyyyy(String(i.originalDate ?? d.doc_date)) }];
  return payload;
}

/** What the portal said, in words a shop owner can act on. Codes here are the mock partner's; map the real partner's before launch. */
export function explainGspError(code: string, message: string): { title: string; fix: string } {
  const known: Record<string, { title: string; fix: string }> = {
    '3029': { title: "The buyer's GSTIN is not active on the GST portal.", fix: 'Ask the customer for their current GSTIN. If it changed, correct it here and resubmit.' },
    '3002': { title: "The buyer's GSTIN is not valid.", fix: 'Check the GSTIN with your customer and correct it.' },
    '3001': { title: 'Your GSTIN is not valid.', fix: 'Fix it in Settings.' },
    '3003': { title: 'A name is missing.', fix: 'Add the legal name of the seller or buyer.' },
    '3004': { title: 'An address line is missing.', fix: 'Add the address of the seller or buyer.' },
    '3005': { title: 'A city is missing.', fix: 'Add the city of the seller or buyer.' },
    '3006': { title: 'A pincode is missing or wrong.', fix: 'Pincodes are 6 digits.' },
    '3008': { title: 'A state code does not match the GSTIN.', fix: 'The first two digits of a GSTIN are the state. Check both.' },
    '4002': { title: 'An HSN or SAC code is not valid.', fix: 'HSN or SAC is 4 to 8 digits.' },
    '5001': { title: 'The invoice values do not add up.', fix: 'This is a fault on our side. Contact support with the invoice number.' },
    '5003': { title: 'The invoice total does not match its lines.', fix: 'This is a fault on our side. Contact support with the invoice number.' },
    '2150': { title: 'This invoice number is already registered.', fix: 'It was registered earlier. We will fetch the details.' },
    '2142': { title: 'The 24-hour cancellation window has passed.', fix: 'Issue a credit note instead.' },
  };
  return known[code] ?? { title: message || 'The GST portal rejected this invoice.', fix: 'Check the details and resubmit, or contact support.' };
}

const E_STATUSES = ['pending', 'registering'];

/** Called in the issue transaction. Creates the e-invoice record and queues registration, or does nothing if not required. */
export async function queueEinvoiceIfRequired(tx: Tx, doc: { id: string; business_id: string; einvoice_required: boolean }): Promise<void> {
  if (!doc.einvoice_required) return;
  const [e] = await tx`insert into einvoice (business_id, document_id, status) values (${doc.business_id}, ${doc.id}, 'pending') returning id`;
  await enqueue(tx, 'einvoice.register', { documentId: doc.id, einvoiceId: e!.id }, { businessId: doc.business_id, dedupeKey: `einvoice:${e!.id}` });
}

async function loadForRegistration(tx: Tx, documentId: string) {
  const [d] = await tx`select d.*, o.number as original_number, o.doc_date as original_date from document d left join document o on o.id = d.original_document_id where d.id = ${documentId}`;
  const lines = await tx`select * from document_line where document_id = ${documentId} order by position`;
  return { d, lines };
}

const markDoc = (tx: Tx, id: string, status: string) => tx`update document set einvoice_status = ${status} where id = ${id}`;

/** Worker side of 'einvoice.register'. Safe to run again after a crash: the portal's duplicate answer gives back the same IRN. */
export async function processEinvoiceJob(sql: Sql, deps: { gsp: GspClient }, job: JobRow): Promise<void> {
  const p = job.payload as { documentId: string; einvoiceId: string };
  const ctx = { businessId: job.business_id!, userId: SYSTEM_USER };
  const final = job.attempts >= job.max_attempts;

  const prep = await withTenant(sql, ctx, async (tx) => {
    const [e] = await tx`select id, status from einvoice where id = ${p.einvoiceId} for update`;
    if (!e || !E_STATUSES.includes(e.status as string)) return null;
    const { d, lines } = await loadForRegistration(tx, p.documentId);
    const reject = async (code: string, message: string, status = 'rejected') => {
      await tx`update einvoice set status = ${status}, error_code = ${code}, error_message = ${message} where id = ${p.einvoiceId}`;
      await markDoc(tx, p.documentId, 'rejected');
      return null;
    };
    if (!d || d.status !== 'issued') return reject('KORA_STATE', 'The invoice is no longer issued.', 'failed');
    let payload: Record<string, unknown>;
    try {
      payload = buildIrpPayload({ doc: d, lines, supplier: d.supplier_snapshot, recipient: d.recipient_snapshot,
        originalNumber: d.original_number as string | null, originalDate: d.original_date as string | null });
    } catch (e2) {
      if (isEinvoiceInvalid(e2)) return reject('KORA_PRECHECK', JSON.stringify(e2.problems));
      throw e2;
    }
    await tx`update einvoice set status = 'registering', attempts = attempts + 1, request_payload = ${tx.json(payload as any)}, error_code = null, error_message = null where id = ${p.einvoiceId}`;
    await markDoc(tx, p.documentId, 'registering');
    return { payload, sellerGstin: d.supplier_snapshot.gstin as string, typ: TYPE[d.doc_type as string]!, no: d.number as string, dt: ddmmyyyy(String(d.doc_date)) };
  });
  if (!prep) return;

  let res: IrnResult | null = null;
  try {
    res = await deps.gsp.generateIrn(prep.payload);
  } catch (e) {
    if (!isGspError(e)) throw e;
    if (e.kind === 'duplicate') {
      res = e.existing ?? (await deps.gsp.getIrnByDocument({ sellerGstin: prep.sellerGstin, docType: prep.typ, docNo: prep.no, docDate: prep.dt }));
    }
    if (!res) {
      const permanent = e.kind === 'validation' || e.kind === 'duplicate';
      const detail = e.details.length ? JSON.stringify(e.details) : null;
      await withTenant(sql, ctx, async (tx) => {
        if (permanent) {
          await tx`update einvoice set status = 'rejected', error_code = ${e.code}, error_message = ${detail ?? e.message} where id = ${p.einvoiceId}`;
          await markDoc(tx, p.documentId, 'rejected');
        } else if (final) {
          await tx`update einvoice set status = 'failed', error_code = ${e.code}, error_message = ${'The GST portal did not respond after repeated tries. ' + e.message} where id = ${p.einvoiceId}`;
          await markDoc(tx, p.documentId, 'rejected');
        } else {
          await tx`update einvoice set error_code = ${e.code}, error_message = ${e.message} where id = ${p.einvoiceId}`;
        }
      });
      if (permanent) return;          // a rejection is an answer, not a failure of the job
      throw e;                        // transient: the queue retries with backoff
    }
  }

  await withTenant(sql, ctx, async (tx) => {
    const deadline = new Date(new Date(res!.ackDate).getTime() + 24 * 3600_000);
    await tx`update einvoice set status = 'registered', irn = ${res!.irn}, ack_no = ${res!.ackNo}, ack_date = ${res!.ackDate}, signed_invoice = ${res!.signedInvoice},
             signed_qr = ${res!.signedQr}, cancel_deadline = ${deadline}, error_code = null, error_message = null where id = ${p.einvoiceId}`;
    await markDoc(tx, p.documentId, 'registered');
  });
}

export async function getEinvoice(sql: Sql, t: TenantSession, documentId: string) {
  const rows = await inTenant(sql, t, 'document.read', (tx) => tx`
    select id, status, irn, ack_no, ack_date, signed_qr, error_code, error_message, attempts, cancel_deadline, created_at
      from einvoice where document_id = ${documentId} order by created_at desc`);
  const cur = rows[0] ?? null;
  const readable = (r: Row) => {
    if (!r || !r.error_message) return r;
    let problems: EinvoiceProblem[] | { code: string; message: string }[] | null = null;
    try { const j = JSON.parse(r.error_message as string); if (Array.isArray(j)) problems = j; } catch { /* plain text */ }
    if (r.error_code === 'KORA_PRECHECK' && problems) return { ...r, problems: problems as EinvoiceProblem[] };
    if (problems) return { ...r, problems: (problems as { code: string; message: string }[]).map((p) => ({ field: p.code, message: explainGspError(p.code, p.message).title, fix: explainGspError(p.code, p.message).fix })) };
    const x = explainGspError(String(r.error_code), String(r.error_message));
    return { ...r, problems: [{ field: String(r.error_code), message: x.title, fix: x.fix }] };
  };
  return { current: cur ? readable(cur) : null, history: rows.slice(1).map(readable) };
}

/** Starts a fresh attempt after a rejection or a portal outage. */
export async function resubmitEinvoice(sql: Sql, t: TenantSession, documentId: string) {
  return inTenant(sql, t, 'einvoice.submit', async (tx) => {
    const [d] = await tx`select id, business_id, status, einvoice_status, einvoice_required from document where id = ${documentId} for update`;
    if (!d || d.status !== 'issued') throw new ValidationError('Only an issued invoice can be e-invoiced.');
    if (d.einvoice_status !== 'rejected') throw new ValidationError('This invoice has nothing to resubmit.');
    const [e] = await tx`insert into einvoice (business_id, document_id, status) values (${t.businessId}, ${documentId}, 'pending') returning id`;
    await markDoc(tx, documentId, 'pending');
    await enqueue(tx, 'einvoice.register', { documentId, einvoiceId: e!.id }, { businessId: t.businessId, dedupeKey: `einvoice:${e!.id}` });
    return { einvoiceId: e!.id as string };
  });
}

/**
 * Fixes the buyer's details on an issued invoice that has no IRN yet (a rejected or waiting e-invoice).
 * The state cannot change, because that would change the tax.
 */
export async function correctBuyer(
  sql: Sql, t: TenantSession, documentId: string,
  c: { gstin?: string; name?: string; line1?: string; line2?: string; city?: string; pincode?: string },
) {
  return inTenant(sql, t, 'einvoice.submit', async (tx) => {
    const [d] = await tx`select id, status, einvoice_status, recipient_snapshot from document where id = ${documentId} for update`;
    if (!d || d.status !== 'issued') throw new ValidationError('Only an issued invoice can be corrected.');
    if (!['rejected', 'pending'].includes(d.einvoice_status as string)) throw new ValidationError('The buyer can only be corrected before the invoice is registered.');
    const snap = { ...(d.recipient_snapshot as Row) };
    const gstin = str(c.gstin, 'GSTIN', { max: 15 })?.toUpperCase();
    if (gstin) {
      if (!gstinValid(gstin)) throw new ValidationError('That GSTIN is not valid.', 'gstin');
      if (gstin.slice(0, 2) !== snap.state_code) throw new ValidationError(`The GSTIN must be from ${STATE_NAMES[snap.state_code as string] ?? 'the same state'}. A different state changes the tax, so issue a new invoice instead.`, 'gstin');
      snap.gstin = gstin;
    }
    const name = str(c.name, 'Name', { max: 100 });
    if (name) snap.name = name;
    const a = { ...((snap.billing_address ?? {}) as Row) };
    for (const [k, v] of [['line1', c.line1], ['line2', c.line2], ['city', c.city], ['pincode', c.pincode]] as const) {
      const x = str(v, k, { max: 100 });
      if (x) a[k] = x;
    }
    if (a.pincode && !/^[1-9]\d{5}$/.test(String(a.pincode))) throw new ValidationError('A pincode is 6 digits.', 'pincode');
    snap.billing_address = a;
    try {
      await tx`update document set recipient_snapshot = ${tx.json(snap as any)} where id = ${documentId}`;
    } catch (e) {
      if ((e as { code?: string }).code === '23000' && e instanceof Error) throw new ValidationError(e.message);
      throw e;
    }
    return { recipient: snap };
  });
}

const REASONS: Record<string, string> = { '1': 'Duplicate', '2': 'Data entry mistake', '3': 'Order cancelled', '4': 'Other' };

/** Cancels the IRN and the invoice. Only inside the portal's 24-hour window; after that, the answer is a credit note. */
export async function cancelEinvoice(sql: Sql, t: TenantSession, gsp: GspClient, documentId: string, a: { reason: string; remark: string }, now = new Date()) {
  if (!REASONS[a.reason]) throw new ValidationError('Choose a reason.', 'reason');
  const remark = str(a.remark, 'Remark', { required: true, max: 100 })!;
  const e = await inTenant(sql, t, 'document.cancel', async (tx) => {
    const [row] = await tx`select e.id, e.irn, e.cancel_deadline, d.status from einvoice e join document d on d.id = e.document_id
                            where e.document_id = ${documentId} and e.status = 'registered'`;
    if (!row) throw new ValidationError('This invoice has no registered e-invoice to cancel.');
    if (new Date(row.cancel_deadline as string) <= now) throw new ValidationError('The 24-hour window to cancel an e-invoice has passed. Issue a credit note instead.');
    return row;
  });
  try {
    await gsp.cancelIrn({ irn: e.irn as string, reason: a.reason as CancelReason, remark });
  } catch (err) {
    if (isGspError(err)) {
      const x = explainGspError(err.code, err.message);
      throw new ValidationError(err.kind === 'transient' ? 'The GST portal is not available. Try again in a few minutes.' : `${x.title} ${x.fix}`);
    }
    throw err;
  }
  await inTenant(sql, t, 'document.cancel', async (tx) => {
    await tx`update einvoice set status = 'cancelled' where id = ${e.id}`;
    await markDoc(tx, documentId, 'cancelled');
    await tx`update document set status = 'cancelled', cancel_reason = ${`E-invoice cancelled: ${REASONS[a.reason]}. ${remark}`} where id = ${documentId} and status = 'issued'`;
  });
}
