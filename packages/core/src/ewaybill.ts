import { ewayUnit, isGspError, validateEwayPayload, EWAY_THRESHOLD_PAISE, type EwayCancelReason, type EwayPayload, type EwayProblem, type GspClient } from '@kora/adapters';
import type { Sql } from '@kora/db';
import { getDocumentTx } from './documents.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { str, ValidationError } from './validation.js';

type Row = Record<string, any>;

/** Where the goods are going and how. The distance is the one on the portal's own calculator, in whole kilometres. */
export interface Transport {
  mode?: '1' | '2' | '3' | '4';            // road, rail, air, ship
  distanceKm: number | string;
  vehicleNo?: string | null;
  transporterId?: string | null;           // the transporter's GSTIN, when a transporter adds the vehicle later
  transporterName?: string | null;
  transDocNo?: string | null;              // lorry receipt, railway receipt, airway bill or bill of lading
  transDocDate?: string | null;            // YYYY-MM-DD
}

const DOC_TYPES: Record<string, { code: EwayPayload['docType']; sub: number }> = {
  tax_invoice: { code: 'INV', sub: 1 }, bill_of_supply: { code: 'BIL', sub: 1 }, delivery_challan: { code: 'CHL', sub: 8 },
};
const rupees = (p: unknown) => { const n = BigInt(String(p ?? 0)); const a = n < 0n ? -n : n; return Number(`${n < 0n ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`); };
const ddmmyyyy = (d: string) => { const [y, m, day] = d.slice(0, 10).split('-'); return `${day}/${m}/${y}`; };
const isGoods = (l: Row) => !String(l.hsn_sac ?? '').startsWith('99');

/** Whether the document needs an e-way bill, and what to tell the person. Goods worth more than Rs 50,000 in one consignment do. */
export function ewayAdvice(doc: Row, lines: Row[]): { applies: boolean; supported: boolean; message: string } {
  if (!DOC_TYPES[doc.doc_type as string]) return { applies: false, supported: false, message: 'An e-way bill is made for a tax invoice, a bill of supply or a delivery challan.' };
  const goods = lines.filter(isGoods);
  if (goods.length === 0) return { applies: false, supported: true, message: 'Services do not need an e-way bill.' };
  const value = goods.reduce((a, l) => a + BigInt(l.line_total_paise as string), 0n);
  return value > EWAY_THRESHOLD_PAISE
    ? { applies: true, supported: true, message: 'These goods are worth more than Rs 50,000, so an e-way bill is needed before they move. Some states set a lower limit for movement inside the state.' }
    : { applies: false, supported: true, message: 'These goods are worth Rs 50,000 or less, so an e-way bill is not required, unless your state asks for one. You can still make one.' };
}

/** The portal's JSON for this document and journey, and every problem that would stop it. Reads only what Kora already stored. */
export function buildEwayPayload(i: { doc: Row; lines: Row[]; supplier: Row; recipient: Row | null; transport: Transport }): { payload: EwayPayload | null; problems: EwayProblem[] } {
  const { doc: d, supplier: s, recipient: r, transport: tr } = i;
  const t = DOC_TYPES[d.doc_type as string];
  if (!t) return { payload: null, problems: [{ code: '300', message: 'An e-way bill is made for a tax invoice, a bill of supply or a delivery challan.' }] };
  const goods = i.lines.filter(isGoods);
  if (goods.length === 0) return { payload: null, problems: [{ code: '301', message: 'Every line is a service, and services do not need an e-way bill.' }] };
  const sa = (s.address ?? {}) as Row;
  const ba = (r?.billing_address ?? {}) as Row;
  const ship = (r?.shipping_address && Object.keys(r.shipping_address).length ? r.shipping_address : null) as Row | null;
  const to = ship ?? ba;
  const intra = String(s.state_code) === String(d.place_of_supply);
  const sum = (k: string) => goods.reduce((a, l) => a + BigInt(String(l[k] ?? 0)), 0n);
  const mode = tr.mode ?? '1';
  const tid = String(tr.transporterId ?? '').trim().toUpperCase();
  const vehicle = String(tr.vehicleNo ?? '').replace(/[\s-]/g, '').toUpperCase();
  const payload: EwayPayload = {
    supplyType: 'O', subSupplyType: t.sub, docType: t.code, docNo: String(d.number ?? ''), docDate: d.doc_date ? ddmmyyyy(String(d.doc_date)) : '',
    fromGstin: String(s.gstin ?? '').toUpperCase(), fromTrdName: String(s.legal_name ?? s.trade_name ?? ''), fromAddr1: String(sa.line1 ?? ''), ...(sa.line2 ? { fromAddr2: String(sa.line2) } : {}),
    fromPlace: String(sa.city ?? ''), fromPincode: Number(sa.pincode ?? 0), fromStateCode: Number(s.state_code), actFromStateCode: Number(s.state_code),
    toGstin: String(r?.gstin ?? '').toUpperCase() || 'URP', toTrdName: String(r?.name ?? ''), toAddr1: String(to.line1 ?? ''), ...(to.line2 ? { toAddr2: String(to.line2) } : {}),
    toPlace: String(to.city ?? ''), toPincode: Number(to.pincode ?? 0), toStateCode: Number(d.place_of_supply), actToStateCode: Number((ship?.stateCode as string | undefined) ?? d.place_of_supply),
    transactionType: 1, totalValue: rupees(sum('taxable_paise')), cgstValue: rupees(sum('cgst_paise')), sgstValue: rupees(sum('sgst_paise')), igstValue: rupees(sum('igst_paise')),
    cessValue: rupees(sum('cess_paise')), totInvValue: rupees(sum('line_total_paise')), transMode: mode, transDistance: String(tr.distanceKm ?? '').trim(),
    ...(tr.transporterName ? { transporterName: String(tr.transporterName).trim() } : {}), ...(tid ? { transporterId: tid } : {}),
    ...(tr.transDocNo ? { transDocNo: String(tr.transDocNo).trim() } : {}), ...(tr.transDocDate ? { transDocDate: ddmmyyyy(String(tr.transDocDate)) } : {}),
    ...(vehicle ? { vehicleNo: vehicle, vehicleType: 'R' as const } : {}),
    itemList: goods.map((l) => ({
      productName: String(l.item_name ?? '').slice(0, 100), hsnCode: Number(String(l.hsn_sac ?? '').replace(/\D/g, '') || 0), quantity: Number(l.quantity), qtyUnit: ewayUnit(l.unit as string),
      taxableAmount: rupees(l.taxable_paise), sgstRate: intra ? Number(l.tax_rate_bp) / 200 : 0, cgstRate: intra ? Number(l.tax_rate_bp) / 200 : 0, igstRate: intra ? 0 : Number(l.tax_rate_bp) / 100, cessRate: Number(l.cess_rate_bp ?? 0) / 100,
    })),
  };
  const problems = validateEwayPayload(payload);
  if (!['issued'].includes(String(d.status))) problems.unshift({ code: '302', message: 'The document must be issued before an e-way bill can be made.' });
  if (!(['bill_of_supply'].includes(d.doc_type as string)) && !intra && payload.cgstValue > 0) problems.push({ code: '303', message: 'The tax on this document does not match the place of supply.' });
  return { payload, problems };
}

async function load(tx: any, t: TenantSession, documentId: string) {
  const full = await getDocumentTx(tx, documentId);
  if (!full) throw new ValidationError('Document not found.');
  const d = full.document as Row;
  const [business] = await tx`select legal_name, trade_name, gstin, state_code, address from business where id = ${t.businessId}`;
  const supplier = (d.supplier_snapshot as Row | null) ?? business;
  const recipient = (d.recipient_snapshot as Row | null) ?? (d.party_id ? (await tx`select name, gstin, state_code, billing_address, shipping_address from party where id = ${d.party_id}`)[0] ?? null : null);
  return { doc: d, lines: full.lines as Row[], supplier: supplier as Row, recipient: recipient as Row | null };
}

/** What an e-way bill for this document would say, whether it is needed, the bills already made, and anything to fix. Saves nothing. */
export async function ewayOverview(sql: Sql, t: TenantSession, documentId: string, transport: Transport | null = null) {
  return inTenant(sql, t, 'document.read', async (tx) => {
    const d = await load(tx, t, documentId);
    const bills = await tx`select id, ewb_number, status, valid_until, vehicle_no, transporter_id, distance_km, trans_mode, error_message, generated_at, cancelled_at, cancel_reason, created_at
                             from eway_bill where document_id = ${documentId} order by created_at desc`;
    const built = transport ? buildEwayPayload({ ...d, transport }) : null;
    return { advice: ewayAdvice(d.doc, d.lines), bills, payload: built?.payload ?? null, problems: built?.problems ?? [] };
  });
}

/** The explanation of a portal refusal, in plain words. The portal's own code stays in the message for the partner's support. */
export function explainEwayError(code: string, message: string): string {
  if (code === '604') return `${message} Cancel it first if you need a new one.`;
  if (code === '238') return 'The portal says the buyer GSTIN is not active, so it will not make an e-way bill. Check the GSTIN with the customer.';
  return `${message} (portal code ${code})`;
}

export class EwayInvalidError extends ValidationError {
  constructor(public problems: EwayProblem[]) {
    super(`Fix these before the e-way bill can be made: ${problems.slice(0, 6).map((p, i) => `${i + 1}) ${p.message}`).join(' ')}`);
  }
}

/** Asks the partner for an e-way bill. A bill that is already active for the document blocks a second one. Needs the right to submit. */
export async function createEwayBill(sql: Sql, t: TenantSession, gsp: GspClient, documentId: string, transport: Transport) {
  const ctx = await inTenant(sql, t, 'einvoice.submit', async (tx) => {
    const d = await load(tx, t, documentId);
    const [active] = await tx`select ewb_number from eway_bill where document_id = ${documentId} and status in ('active', 'extended')`;
    if (active) throw new ValidationError(`This document already has an e-way bill (${active.ewb_number}). Cancel it first if you need a new one.`);
    const built = buildEwayPayload({ ...d, transport });
    if (!built.payload || built.problems.length) throw new EwayInvalidError(built.problems);
    return { payload: built.payload };
  });
  const p = ctx.payload;
  const save = (status: 'active' | 'failed', extra: { result?: { ewbNo: string; ewbDate: string; validUpto: string }; error?: string }) =>
    inTenant(sql, t, 'einvoice.submit', async (tx) => {
      const [row] = await tx`insert into eway_bill (business_id, document_id, ewb_number, valid_until, vehicle_no, transporter_id, distance_km, trans_mode, status, error_message, payload, response, generated_at)
        values (${t.businessId}, ${documentId}, ${extra.result?.ewbNo ?? null}, ${extra.result?.validUpto ?? null}, ${p.vehicleNo ?? null}, ${p.transporterId ?? null}, ${Number(p.transDistance)}, ${p.transMode ?? '1'},
                ${status}, ${extra.error ?? null}, ${tx.json(p as any)}, ${extra.result ? tx.json(extra.result as any) : null}, ${extra.result?.ewbDate ?? null}) returning id`;
      return row!.id as string;
    });
  try {
    const result = await gsp.generateEwayBill(p as unknown as Record<string, unknown>);
    const id = await save('active', { result });
    return { id, ewbNumber: result.ewbNo, validUntil: result.validUpto };
  } catch (e) {
    if (!isGspError(e)) throw e;
    const message = e.kind === 'transient' ? 'The GST portal is not available right now. Try again in a few minutes.' : e.kind === 'auth' ? 'Kora could not sign in to the GST partner. Ask the person who set it up to check the credentials.' : explainEwayError(e.code, e.message);
    await save('failed', { error: message }).catch(() => undefined);
    throw new ValidationError(message);
  }
}

const CANCEL_REASONS: Record<string, EwayCancelReason> = { duplicate: '1', order_cancelled: '2', mistake: '3', other: '4' };

/** Cancels a bill within 24 hours of making it. The portal enforces the same limit. */
export async function cancelEwayBill(sql: Sql, t: TenantSession, gsp: GspClient, ewayId: string, a: { reason: string; remark: string }, now = new Date()) {
  const code = CANCEL_REASONS[a.reason] ?? (['1', '2', '3', '4'].includes(a.reason) ? (a.reason as EwayCancelReason) : null);
  if (!code) throw new ValidationError('Choose why the e-way bill is cancelled.', 'reason');
  const remark = str(a.remark, 'Remark', { required: true, max: 100 })!;
  const bill = await inTenant(sql, t, 'einvoice.submit', async (tx) => {
    const [b] = await tx`select id, ewb_number, status, generated_at from eway_bill where id = ${ewayId} for update`;
    if (!b) throw new ValidationError('E-way bill not found.');
    if (!['active', 'extended'].includes(b.status as string)) throw new ValidationError('Only an active e-way bill can be cancelled.');
    if (b.generated_at && now.getTime() - new Date(b.generated_at as string).getTime() > 24 * 3600_000) throw new ValidationError('An e-way bill can be cancelled only within 24 hours of making it.');
    return b;
  });
  try {
    await gsp.cancelEwayBill({ ewbNo: String(bill.ewb_number), reason: code, remark });
  } catch (e) {
    if (!isGspError(e)) throw e;
    throw new ValidationError(e.kind === 'transient' ? 'The GST portal is not available right now. Try again in a few minutes.' : explainEwayError(e.code, e.message));
  }
  await inTenant(sql, t, 'einvoice.submit', (tx) => tx`update eway_bill set status = 'cancelled', cancelled_at = now(), cancel_reason = ${remark} where id = ${ewayId}`);
  return { ok: true };
}

/**
 * The JSON to upload on the e-way bill portal's bulk generation page, for a business that has no partner connection yet.
 * It is the same payload Kora sends a partner, wrapped the way the bulk tool expects. Not checked against the live tool.
 */
export async function ewayPortalJson(sql: Sql, t: TenantSession, documentId: string, transport: Transport) {
  return inTenant(sql, t, 'document.read', async (tx) => {
    const built = buildEwayPayload({ ...(await load(tx, t, documentId)), transport });
    if (!built.payload || built.problems.length) throw new EwayInvalidError(built.problems);
    return { version: '1.0.0421', billLists: [built.payload] };
  });
}
