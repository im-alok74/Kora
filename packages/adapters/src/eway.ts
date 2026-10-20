import { gstinValid } from '@kora/tax';

/**
 * The e-way bill: the JSON the portal takes for one consignment of goods, and the rules it checks.
 * The field names and rules follow the public e-way bill API as I know it (version 1.0.0421). They have not been checked against the
 * live portal or a partner's sandbox, and must be before any live use. The same checks run here, in the mock partner, and before a send,
 * so most mistakes are caught with a plain message instead of a portal error code.
 */
export const EWAY_THRESHOLD_PAISE = 5_000_000n;               // Rs 50,000 of goods in one consignment

export interface EwayItem { productName: string; productDesc?: string; hsnCode: number; quantity: number; qtyUnit: string; taxableAmount: number; sgstRate: number; cgstRate: number; igstRate: number; cessRate: number }
export interface EwayPayload {
  supplyType: 'O' | 'I'; subSupplyType: number; docType: 'INV' | 'BIL' | 'BOE' | 'CHL' | 'CNT' | 'OTH'; docNo: string; docDate: string;
  fromGstin: string; fromTrdName: string; fromAddr1: string; fromAddr2?: string; fromPlace: string; fromPincode: number; fromStateCode: number; actFromStateCode: number;
  toGstin: string; toTrdName: string; toAddr1: string; toAddr2?: string; toPlace: string; toPincode: number; toStateCode: number; actToStateCode: number;
  transactionType: 1 | 2 | 3 | 4; totalValue: number; cgstValue: number; sgstValue: number; igstValue: number; cessValue: number; totInvValue: number;
  transMode?: '1' | '2' | '3' | '4'; transDistance: string; transporterName?: string; transporterId?: string; transDocNo?: string; transDocDate?: string;
  vehicleNo?: string; vehicleType?: 'R' | 'O'; itemList: EwayItem[];
}

/** Units the portal accepts (the same list as for e-invoices, the ones a shop is likely to use). Anything else goes in as OTH. */
export const EWAY_UNITS = new Set(['BAG', 'BAL', 'BDL', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM', 'CMS', 'CTN', 'DOZ', 'DRM', 'GMS', 'KGS', 'KLR', 'KME', 'LTR', 'MLT', 'MTR', 'MTS', 'NOS', 'PAC', 'PCS', 'PRS', 'QTL', 'ROL', 'SET', 'SQF', 'SQM', 'TBS', 'TGM', 'THD', 'TON', 'TUB', 'UNT', 'YDS', 'OTH']);
export const ewayUnit = (u: string | null | undefined) => { const x = String(u ?? '').toUpperCase(); return EWAY_UNITS.has(x) ? x : 'OTH'; };

export const VEHICLE_NUMBER = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/;
const DOC_NO = /^[A-Za-z0-9][A-Za-z0-9/-]{0,15}$/;
const DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const rupees = (n: number) => Math.round(n * 100);

export type EwayProblem = { code: string; message: string; field?: string };

/** The portal's content rules, with messages a person can act on. Money is compared in paise. */
export function validateEwayPayload(p: Partial<EwayPayload> | null | undefined): EwayProblem[] {
  const out: EwayProblem[] = [];
  const bad = (code: string, message: string, field?: string) => out.push({ code, message, field });
  if (!p) return [{ code: '300', message: 'There is nothing to send.' }];
  if (!DOC_NO.test(String(p.docNo ?? ''))) bad('305', 'The document number must be 1 to 16 letters, digits, / or -.', 'docNo');
  if (!DATE.test(String(p.docDate ?? ''))) bad('306', 'The document date must be dd/mm/yyyy.', 'docDate');
  for (const [side, label] of [['from', 'the sender (you)'], ['to', 'the buyer']] as const) {
    const g = String(p[`${side}Gstin` as 'fromGstin'] ?? '');
    if (side === 'from' ? !gstinValid(g) : (g !== 'URP' && !gstinValid(g))) bad('310', `The GSTIN of ${label} is not valid${side === 'to' ? ' (leave it empty for a customer with no GSTIN)' : ''}.`, `${side}Gstin`);
    if (!String(p[`${side}TrdName` as 'fromTrdName'] ?? '').trim()) bad('311', `The name of ${label} is missing.`, `${side}TrdName`);
    if (!String(p[`${side}Addr1` as 'fromAddr1'] ?? '').trim()) bad('312', `The address of ${label} is missing.`, `${side}Addr1`);
    if (!String(p[`${side}Place` as 'fromPlace'] ?? '').trim()) bad('313', `The city of ${label} is missing.`, `${side}Place`);
    if (!/^[1-9][0-9]{5}$/.test(String(p[`${side}Pincode` as 'fromPincode'] ?? ''))) bad('314', `The pincode of ${label} must be 6 digits.`, `${side}Pincode`);
    if (!Number.isInteger(p[`${side}StateCode` as 'fromStateCode'])) bad('315', `The state of ${label} is missing.`, `${side}StateCode`);
  }
  const items = p.itemList ?? [];
  if (items.length === 0) bad('320', 'Add at least one item.', 'itemList');
  if (items.length > 250) bad('321', 'An e-way bill can have at most 250 items.', 'itemList');
  items.forEach((it, i) => {
    const n = i + 1;
    if (!/^[0-9]{4,8}$/.test(String(it.hsnCode ?? ''))) bad('322', `Item ${n}: the HSN code must be 4 to 8 digits. Services do not need an e-way bill.`, 'itemList');
    if (!(it.quantity > 0)) bad('323', `Item ${n}: the quantity must be more than zero.`, 'itemList');
    if (!String(it.productName ?? '').trim()) bad('324', `Item ${n}: the name is missing.`, 'itemList');
  });
  const sum = items.reduce((a, it) => a + rupees(it.taxableAmount), 0);
  if (rupees(p.totalValue ?? 0) !== sum) bad('330', 'The total value does not equal the sum of the items.', 'totalValue');
  const total = rupees(p.totalValue ?? 0) + rupees(p.cgstValue ?? 0) + rupees(p.sgstValue ?? 0) + rupees(p.igstValue ?? 0) + rupees(p.cessValue ?? 0);
  if (Math.abs(rupees(p.totInvValue ?? 0) - total) > 100) bad('331', 'The invoice value must equal the value plus the taxes (a round-off of up to Re 1 is allowed).', 'totInvValue');
  if ((p.igstValue ?? 0) > 0 && ((p.cgstValue ?? 0) > 0 || (p.sgstValue ?? 0) > 0)) bad('332', 'IGST and CGST or SGST cannot be on the same e-way bill.', 'igstValue');
  const dist = Number(p.transDistance);
  if (!Number.isInteger(dist) || dist < 1 || dist > 4000) bad('340', 'The distance must be a whole number of kilometres, from 1 to 4000.', 'transDistance');
  if (!['1', '2', '3', '4'].includes(String(p.transMode ?? '1'))) bad('341', 'Choose road, rail, air or ship.', 'transMode');
  const mode = p.transMode ?? '1';
  if (p.vehicleNo !== undefined && p.vehicleNo !== '' && (mode !== '1' || !VEHICLE_NUMBER.test(p.vehicleNo))) bad('342', 'The vehicle number looks wrong. Write it without spaces, like MH12AB1234.', 'vehicleNo');
  if (p.transporterId !== undefined && p.transporterId !== '' && !gstinValid(p.transporterId)) bad('343', 'The transporter ID is a GSTIN, and this one is not valid.', 'transporterId');
  if (mode === '1' && !p.vehicleNo && !p.transporterId) bad('344', 'For road transport give a vehicle number, or a transporter ID so the transporter can add the vehicle later.', 'vehicleNo');
  if (mode !== '1' && (!p.transDocNo || !p.transDocDate)) bad('345', 'For rail, air or ship give the transport document number and its date.', 'transDocNo');
  return out;
}

/** One day for every 200 km, at least one: the validity the portal gives a regular consignment. */
export const ewayValidityDays = (km: number) => Math.max(1, Math.ceil(km / 200));
