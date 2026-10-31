import { computeLine, DEFAULT_ALLOWED_RATE_BP, nearestSlabBp, parseQuantity, parseRupees, TaxError } from '@kora/tax';
import type { Sql } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { isDate, str, todayIn, ValidationError } from './validation.js';
import { msmeCovered, msmeDeadline, msmeStatus } from './msme.js';

const rs = (p: bigint | string | number) => { const n = BigInt(p); return `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`; };
const PAY_METHODS = ['cash', 'upi', 'card', 'netbanking', 'bank_transfer', 'cheque', 'other'] as const;

export interface BillLineIn { itemId?: string | null; description: string; hsnSac?: string | null; quantity: string; rate: string; discount?: string; taxRateBp: number; cessRateBp?: number }
export interface BillIn {
  partyId: string; billNumber: string; billDate: string; dueDate?: string | null; reverseCharge?: boolean;
  itcStatus?: 'eligible' | 'blocked'; itcReason?: string | null; notes?: string | null; lines: BillLineIn[];
}

const paise = (v: unknown, field: string): bigint => { try { return parseRupees(String(v ?? '')); } catch { throw new ValidationError('Enter the amount in rupees.', field); } };

/** Records a bill from a vendor. Tax is worked out from the vendor's state and ours: CGST and SGST inside the state, IGST across states. */
export async function createBill(sql: Sql, t: TenantSession, i: BillIn): Promise<{ id: string; totalPaise: string }> {
  const billNumber = str(i.billNumber, 'Bill number', { required: true, max: 40 })!;
  if (!isDate(String(i.billDate))) throw new ValidationError('Enter the bill date as YYYY-MM-DD.', 'billDate');
  if (i.dueDate && !isDate(i.dueDate)) throw new ValidationError('Enter the due date as YYYY-MM-DD.', 'dueDate');
  if (!Array.isArray(i.lines) || i.lines.length === 0) throw new ValidationError('Add at least one line.', 'lines');
  if (i.lines.length > 200) throw new ValidationError('A bill can have at most 200 lines.', 'lines');
  const itcStatus = i.itcStatus ?? 'eligible';
  if (!['eligible', 'blocked'].includes(itcStatus)) throw new ValidationError('Choose eligible or blocked.', 'itcStatus');
  const itcReason = str(i.itcReason, 'Reason', { max: 300 });
  const notes = str(i.notes, 'Notes', { max: 1000 });
  return inTenant(sql, t, 'purchase.write', async (tx) => {
    const [v] = await tx`select state_code, kind from party where id = ${i.partyId}`;
    if (!v || v.kind === 'customer') throw new ValidationError('Choose a vendor.', 'partyId');
    const [b] = await tx`select state_code from business where id = ${t.businessId}`;
    const supply = v.state_code === b!.state_code ? 'intra' as const : 'inter' as const;
    const results = i.lines.map((l, idx) => {
      const description = str(l.description, `Line ${idx + 1} description`, { required: true, max: 300 })!;
      const hsn = l.hsnSac ? String(l.hsnSac).trim() : null;
      if (hsn && !/^[0-9]{4,8}$/.test(hsn)) throw new ValidationError(`Line ${idx + 1}: HSN or SAC must be 4 to 8 digits.`, 'hsnSac');
      try {
        const qty = parseQuantity(String(l.quantity));
        const r = computeLine({ quantityMilli: qty, ratePaise: paise(l.rate, 'rate'), discountPaise: l.discount ? paise(l.discount, 'discount') : 0n, taxRateBp: l.taxRateBp, cessRateBp: l.cessRateBp ?? 0 }, supply, DEFAULT_ALLOWED_RATE_BP);
        return { description, hsn, qty, rateP: paise(l.rate, 'rate'), disc: l.discount ? paise(l.discount, 'discount') : 0n, l, r };
      } catch (e) { if (e instanceof TaxError) throw new ValidationError(`Line ${idx + 1}: ${e.message}`, 'lines'); throw e; }
    });
    const sum = (f: (r: (typeof results)[number]['r']) => bigint) => results.reduce((s, x) => s + f(x.r), 0n);
    const taxable = sum((r) => r.taxablePaise), cgst = sum((r) => r.cgstPaise), sgst = sum((r) => r.sgstPaise), igst = sum((r) => r.igstPaise), cess = sum((r) => r.cessPaise);
    const rcm = !!i.reverseCharge;
    const total = taxable + (rcm ? 0n : cgst + sgst + igst + cess);
    let id: string;
    try {
      const [r] = await tx`insert into purchase_bill (business_id, party_id, bill_number, bill_date, due_date, supply, reverse_charge, taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise, total_paise, itc_status, itc_reason, notes, created_by)
                           values (${t.businessId}, ${i.partyId}, ${billNumber}, ${i.billDate}, ${i.dueDate ?? null}, ${supply}, ${rcm}, ${taxable.toString()}, ${cgst.toString()}, ${sgst.toString()}, ${igst.toString()}, ${cess.toString()}, ${total.toString()}, ${itcStatus}, ${itcReason}, ${notes}, ${t.userId}) returning id`;
      id = r!.id as string;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ValidationError('You have already recorded a bill with that number from this vendor.', 'billNumber');
      throw e;
    }
    let n = 0;
    for (const x of results) {
      n++;
      await tx`insert into purchase_line (business_id, bill_id, line_no, item_id, description, hsn_sac, quantity_milli, rate_paise, discount_paise, tax_rate_bp, cess_rate_bp, taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise, total_paise)
               values (${t.businessId}, ${id}, ${n}, ${x.l.itemId ?? null}, ${x.description}, ${x.hsn}, ${x.qty.toString()}, ${x.rateP.toString()}, ${x.disc.toString()}, ${x.l.taxRateBp}, ${x.l.cessRateBp ?? 0}, ${x.r.taxablePaise.toString()}, ${x.r.cgstPaise.toString()}, ${x.r.sgstPaise.toString()}, ${x.r.igstPaise.toString()}, ${x.r.cessPaise.toString()}, ${x.r.lineTotalPaise.toString()})`;
    }
    return { id, totalPaise: total.toString() };
  });
}

export async function listBills(sql: Sql, t: TenantSession, f: { q?: string; state?: string; from?: string; to?: string; limit?: number } = {}) {
  if (f.from && !isDate(f.from)) throw new ValidationError('Enter dates as YYYY-MM-DD.', 'from');
  if (f.to && !isDate(f.to)) throw new ValidationError('Enter dates as YYYY-MM-DD.', 'to');
  if (f.state && !['open', 'paid', 'cancelled'].includes(f.state)) throw new ValidationError('Choose open, paid or cancelled.', 'state');
  const like = f.q ? `%${f.q.replace(/[%_\\]/g, '\\$&')}%` : null;
  return inTenant(sql, t, 'purchase.read', async (tx) => {
    const [biz] = await tx`select timezone from business where id = ${t.businessId}`;
    const today = todayIn(biz!.timezone as string);
    const rows = await tx`
    select p.msme_class, b.id, b.bill_number, b.bill_date::text as bill_date, b.due_date::text as due_date, b.status, b.reverse_charge, b.itc_status, p.name as vendor,
           b.taxable_paise::text, (b.cgst_paise + b.sgst_paise + b.igst_paise + b.cess_paise)::text as tax_paise, b.total_paise::text, b.paid_paise::text, (b.total_paise - b.paid_paise)::text as due_paise
      from purchase_bill b join party p on p.id = b.party_id
     where (${like}::text is null or b.bill_number ilike ${like} or p.name ilike ${like})
       and (${f.state ?? null}::text is null or (${f.state ?? ''} = 'cancelled' and b.status = 'cancelled') or (b.status = 'recorded' and ((${f.state ?? ''} = 'paid' and b.paid_paise >= b.total_paise) or (${f.state ?? ''} = 'open' and b.paid_paise < b.total_paise))))
       and (${f.from ?? null}::date is null or b.bill_date >= ${f.from ?? null}::date) and (${f.to ?? null}::date is null or b.bill_date <= ${f.to ?? null}::date)
     order by b.bill_date desc, b.created_at desc limit ${Math.min(500, f.limit ?? 100)}`;
    return rows.map((r) => {
      const open = r.status === 'recorded' && BigInt(r.due_paise as string) > 0n;
      if (!open || !msmeCovered(r.msme_class as string)) return r;
      const deadline = msmeDeadline(r.bill_date as string, r.due_date as string | null);
      return { ...r, msme_deadline: deadline, msme_state: msmeStatus(deadline, today).state, msme_days_left: msmeStatus(deadline, today).daysLeft };
    });
  });
}

export async function getBill(sql: Sql, t: TenantSession, id: string) {
  return inTenant(sql, t, 'purchase.read', async (tx) => {
    const [b] = await tx`select b.*, b.bill_date::text as bill_date_s, b.due_date::text as due_date_s, p.name as vendor, p.gstin as vendor_gstin, p.udyam_number, p.msme_class
                           from purchase_bill b join party p on p.id = b.party_id where b.id = ${id}`;
    if (!b) return null;
    const lines = await tx`select line_no, description, hsn_sac, (quantity_milli::numeric / 1000)::text as quantity, rate_paise::text, discount_paise::text, tax_rate_bp, taxable_paise::text, cgst_paise::text, sgst_paise::text, igst_paise::text, cess_paise::text, total_paise::text from purchase_line where bill_id = ${id} order by line_no`;
    const payments = await tx`select id, paid_on::text as paid_on, amount_paise::text, tds_paise::text, tds_section, method, note from purchase_payment where bill_id = ${id} order by paid_on, created_at`;
    const [m] = await tx`select period, invoice_number from gstr2b_entry where bill_id = ${id} limit 1`;
    const [biz] = await tx`select timezone from business where id = ${t.businessId}`;
    const open = b.status === 'recorded' && BigInt(b.paid_paise as string) < BigInt(b.total_paise as string);
    const deadline = msmeCovered(b.msme_class as string) ? msmeDeadline(b.bill_date_s as string, b.due_date_s as string | null) : null;
    const msme = deadline ? { class: b.msme_class as string, udyamNumber: b.udyam_number as string, deadline, open, ...msmeStatus(deadline, todayIn(biz!.timezone as string)) } : null;
    return {
      msme,
      bill: {
        id: b.id as string, vendor: b.vendor as string, vendorGstin: b.vendor_gstin as string | null, partyId: b.party_id as string, billNumber: b.bill_number as string,
        billDate: b.bill_date_s as string, dueDate: b.due_date_s as string | null, supply: b.supply as string, reverseCharge: b.reverse_charge as boolean, status: b.status as string,
        taxablePaise: String(b.taxable_paise), cgstPaise: String(b.cgst_paise), sgstPaise: String(b.sgst_paise), igstPaise: String(b.igst_paise), cessPaise: String(b.cess_paise),
        totalPaise: String(b.total_paise), paidPaise: String(b.paid_paise), itcStatus: b.itc_status as string, itcReason: b.itc_reason as string | null, notes: b.notes as string | null,
      },
      lines, payments, in2b: m ? { period: m.period as string, invoiceNumber: m.invoice_number as string } : null,
    };
  });
}

/** A bill with no payments can be cancelled. It stays in the records, marked cancelled, and drops out of input credit. */
export async function cancelBill(sql: Sql, t: TenantSession, id: string): Promise<void> {
  await inTenant(sql, t, 'purchase.write', async (tx) => {
    const [b] = await tx`select status, paid_paise from purchase_bill where id = ${id} for update`;
    if (!b) throw new ValidationError('Bill not found.');
    if (b.status === 'cancelled') return;
    if (BigInt(b.paid_paise as string) > 0n) throw new ValidationError('This bill has payments against it. Remove them first.');
    await tx`update purchase_bill set status = 'cancelled' where id = ${id}`;
    await tx`update gstr2b_entry set bill_id = null where bill_id = ${id}`;
  });
}

export async function setItcStatus(sql: Sql, t: TenantSession, id: string, status: 'eligible' | 'blocked', reason?: string | null): Promise<void> {
  if (!['eligible', 'blocked'].includes(status)) throw new ValidationError('Choose eligible or blocked.', 'status');
  const why = str(reason, 'Reason', { max: 300 });
  if (status === 'blocked' && !why) throw new ValidationError('Say why the credit is blocked (for example, food and beverages, or personal use).', 'reason');
  await inTenant(sql, t, 'purchase.write', async (tx) => {
    const r = await tx`update purchase_bill set itc_status = ${status}, itc_reason = ${status === 'blocked' ? why : null} where id = ${id} and status = 'recorded' returning id`;
    if (r.length === 0) throw new ValidationError('Bill not found, or it is cancelled.');
  });
}

/** Sections of the Income Tax Act under which a business holds back tax when paying a vendor. The rate is the CA's call, so Kora records the amount you enter. */
export const TDS_SECTIONS: [string, string][] = [
  ['194C', 'Contractors and job work'], ['194J', 'Professional and technical fees'], ['194H', 'Commission and brokerage'], ['194I', 'Rent'],
  ['194Q', 'Purchase of goods'], ['194A', 'Interest other than on securities'], ['194O', 'E-commerce operators'], ['194M', 'Contract or fees by an individual or HUF'],
  ['195', 'Payments to non-residents'],
];

export async function payBill(sql: Sql, t: TenantSession, id: string, i: { amount: string; method?: string; paidOn?: string; note?: string | null; tds?: string | null; tdsSection?: string | null }) {
  const amount = paise(i.amount, 'amount');
  if (amount <= 0n) throw new ValidationError('The amount must be more than zero.', 'amount');
  const tds = i.tds ? paise(i.tds, 'tds') : 0n;
  if (tds < 0n) throw new ValidationError('The tax held back cannot be negative.', 'tds');
  const tdsSection = tds > 0n ? String(i.tdsSection ?? '').trim().toUpperCase() : null;
  if (tds > 0n && !TDS_SECTIONS.some(([k]) => k === tdsSection)) throw new ValidationError('Choose the section under which you held back the tax.', 'tdsSection');
  const method = i.method ?? 'bank_transfer';
  if (!(PAY_METHODS as readonly string[]).includes(method)) throw new ValidationError('Choose how it was paid.', 'method');
  const note = str(i.note, 'Note', { max: 300 });
  return inTenant(sql, t, 'purchase.write', async (tx) => {
    const [b] = await tx`select status, total_paise, paid_paise from purchase_bill where id = ${id} for update`;
    if (!b || b.status !== 'recorded') throw new ValidationError('Bill not found, or it is cancelled.');
    const due = BigInt(b.total_paise as string) - BigInt(b.paid_paise as string);
    if (amount + tds > due) throw new ValidationError(`Only Rs ${rs(due)} is still due on this bill.`, 'amount');
    const [biz] = await tx`select timezone from business where id = ${t.businessId}`;
    const on = i.paidOn || todayIn(biz!.timezone as string);
    if (!isDate(on)) throw new ValidationError('Enter the date as YYYY-MM-DD.', 'paidOn');
    const [p] = await tx`insert into purchase_payment (business_id, bill_id, paid_on, amount_paise, method, note, tds_paise, tds_section, created_by) values (${t.businessId}, ${id}, ${on}, ${amount.toString()}, ${method}, ${note}, ${tds.toString()}, ${tdsSection}, ${t.userId}) returning id`;
    await tx`update purchase_bill set paid_paise = paid_paise + ${(amount + tds).toString()} where id = ${id}`;
    return { id: p!.id as string, duePaise: (due - amount - tds).toString() };
  });
}

export async function removeBillPayment(sql: Sql, t: TenantSession, paymentId: string): Promise<void> {
  await inTenant(sql, t, 'purchase.write', async (tx) => {
    const [p] = await tx`delete from purchase_payment where id = ${paymentId} returning bill_id, amount_paise, tds_paise`;
    if (!p) throw new ValidationError('Payment not found.');
    await tx`update purchase_bill set paid_paise = paid_paise - ${(BigInt(p.amount_paise as string) + BigInt(p.tds_paise as string)).toString()} where id = ${p.bill_id}`;
  });
}

/** What you owe vendors, oldest first, with how late each bill is. */
export async function payablesAgeing(sql: Sql, t: TenantSession) {
  return inTenant(sql, t, 'purchase.read', async (tx) => {
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const today = todayIn(b!.timezone as string);
    const rows = await tx`select b.id, b.bill_number, p.name as vendor, b.bill_date::text as bill_date, coalesce(b.due_date, b.bill_date)::text as due_date,
                                 (b.total_paise - b.paid_paise)::text as due_paise, (${today}::date - coalesce(b.due_date, b.bill_date))::int as days_late
                            from purchase_bill b join party p on p.id = b.party_id
                           where b.status = 'recorded' and b.paid_paise < b.total_paise order by coalesce(b.due_date, b.bill_date), b.bill_number`;
    const bucket = (d: number) => (d <= 0 ? 'current' : d <= 30 ? 'd1_30' : d <= 60 ? 'd31_60' : d <= 90 ? 'd61_90' : 'd90_plus');
    const totals: Record<string, bigint> = { current: 0n, d1_30: 0n, d31_60: 0n, d61_90: 0n, d90_plus: 0n };
    for (const r of rows) totals[bucket(r.days_late as number)]! += BigInt(r.due_paise as string);
    return { today, rows, totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v.toString()])), outstanding: Object.values(totals).reduce((a, b) => a + b, 0n).toString() };
  });
}

// ---------------------------------------------------------------- input tax credit
const monthBounds = (period: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new ValidationError('Enter the month as YYYY-MM.', 'period');
  const [y, m] = period.split('-').map(Number) as [number, number];
  const next = new Date(Date.UTC(y, m, 1));
  return { from: `${period}-01`, to: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01` };
};
const heads = () => ({ taxable: 0n, igst: 0n, cgst: 0n, sgst: 0n, cess: 0n });
type Heads = ReturnType<typeof heads>;
const out = (h: Heads) => ({ taxable: h.taxable.toString(), igst: h.igst.toString(), cgst: h.cgst.toString(), sgst: h.sgst.toString(), cess: h.cess.toString() });
const add = (h: Heads, r: Record<string, unknown>) => {
  h.taxable += BigInt(r.taxable_paise as string); h.igst += BigInt(r.igst_paise as string); h.cgst += BigInt(r.cgst_paise as string);
  h.sgst += BigInt(r.sgst_paise as string); h.cess += BigInt(r.cess_paise as string);
};

/**
 * Input tax credit for a month, from bills dated in it. Eligible credit is split into the credit on ordinary bills and on bills where
 * you pay the tax under reverse charge. Blocked credit is listed separately. If a GSTR-2B statement for the month has been loaded,
 * eligible bills that are not in it are shown as at risk: credit is only safe to claim when the supplier has filed it.
 */
export async function itcSummary(sql: Sql, t: TenantSession, period: string) {
  const { from, to } = monthBounds(period);
  return inTenant(sql, t, 'purchase.read', async (tx) => {
    const bills = await tx`select b.id, b.bill_number, b.bill_date::text as bill_date, b.reverse_charge, b.itc_status, b.itc_reason, p.name as vendor, p.gstin as vendor_gstin,
                                  b.taxable_paise, b.cgst_paise, b.sgst_paise, b.igst_paise, b.cess_paise,
                                  exists (select 1 from gstr2b_entry e where e.bill_id = b.id) as in_2b
                             from purchase_bill b join party p on p.id = b.party_id
                            where b.status = 'recorded' and b.bill_date >= ${from}::date and b.bill_date < ${to}::date order by b.bill_date, b.bill_number`;
    const [loaded] = await tx`select count(*)::int as n from gstr2b_entry where period = ${period}`;
    const has2b = (loaded!.n as number) > 0;
    const ordinary = heads(), rcm = heads(), blocked = heads(), atRisk = heads();
    const risky: Record<string, unknown>[] = [];
    for (const b of bills) {
      if (b.itc_status === 'blocked') { add(blocked, b); continue; }
      add(b.reverse_charge ? rcm : ordinary, b);
      // credit on a bill where the supplier is unregistered, or where we pay the tax, does not appear in 2B
      if (has2b && !b.reverse_charge && b.vendor_gstin && !b.in_2b) { add(atRisk, b); risky.push(b); }
    }
    const total = (h: Heads) => h.igst + h.cgst + h.sgst + h.cess;
    return {
      period, has2b, billCount: bills.length,
      ordinary: out(ordinary), reverseCharge: out(rcm), blocked: out(blocked), atRisk: out(atRisk),
      eligibleTotal: (total(ordinary) + total(rcm)).toString(), blockedTotal: total(blocked).toString(), atRiskTotal: total(atRisk).toString(),
      claimable: out({ taxable: ordinary.taxable + rcm.taxable, igst: ordinary.igst + rcm.igst, cgst: ordinary.cgst + rcm.cgst, sgst: ordinary.sgst + rcm.sgst, cess: ordinary.cess + rcm.cess }),
      atRiskBills: risky.map((b) => ({ id: b.id as string, billNumber: b.bill_number as string, vendor: b.vendor as string, billDate: b.bill_date as string, taxPaise: (BigInt(b.cgst_paise as string) + BigInt(b.sgst_paise as string) + BigInt(b.igst_paise as string) + BigInt(b.cess_paise as string)).toString() })),
      blockedBills: bills.filter((b) => b.itc_status === 'blocked').map((b) => ({ id: b.id as string, billNumber: b.bill_number as string, vendor: b.vendor as string, reason: b.itc_reason as string | null })),
    };
  });
}

// ---------------------------------------------------------------- GSTR-2B
/** "INV/0012", "inv-12" and "INV12" are the same invoice to a person, so they are to the match: letters and digits only, no zeros at the front of a run of digits. */
export const normaliseInvoiceNumber = (s: string) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(?<![0-9])0+(?=[0-9])/g, '');
// The portal's figures are rupees with two decimals. Print to two places and drop the point rather than multiplying a float by 100.
const rupeesToPaise = (v: unknown): bigint => { const n = Number(v ?? 0); return Number.isFinite(n) ? BigInt(n.toFixed(2).replace('.', '')) : 0n; };
const portalDate = (s: unknown): string | null => { const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(s ?? '')); return m ? `${m[3]}-${m[2]}-${m[1]}` : /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? '')) ? String(s) : null; };

export interface Parsed2bEntry { gstin: string; name: string | null; number: string; date: string | null; taxable: bigint; igst: bigint; cgst: bigint; sgst: bigint; cess: bigint; itc: boolean; rcm: boolean }

/**
 * Reads the JSON the GST portal gives for GSTR-2B (Returns, GSTR-2B, Download). It reads the B2B section: each supplier's invoices with
 * their item amounts, adding the items up. Amounts are in rupees in the file. Other sections (credit notes, imports) are not read yet.
 */
export function parseGstr2b(json: unknown): Parsed2bEntry[] {
  const root = json as { data?: { docdata?: { b2b?: unknown[] }; b2b?: unknown[] }; docdata?: { b2b?: unknown[] }; b2b?: unknown[] };
  const b2b = root?.data?.docdata?.b2b ?? root?.docdata?.b2b ?? root?.data?.b2b ?? root?.b2b;
  if (!Array.isArray(b2b)) throw new ValidationError('This does not look like a GSTR-2B file. Download the JSON from the GST portal under Returns, GSTR-2B.');
  const entries: Parsed2bEntry[] = [];
  for (const s of b2b as Record<string, any>[]) {
    const gstin = String(s.ctin ?? '').toUpperCase();
    if (gstin.length !== 15) continue;
    for (const inv of (s.inv ?? []) as Record<string, any>[]) {
      const number = String(inv.inum ?? '').trim();
      if (!number) continue;
      const items = ((inv.items ?? inv.itms ?? []) as Record<string, any>[]).map((x) => x.itm_det ?? x);
      const sum = (k: string) => items.reduce((a, x) => a + rupeesToPaise(x[k]), 0n);
      const e: Parsed2bEntry = { gstin, name: s.trdnm ? String(s.trdnm) : null, number, date: portalDate(inv.dt), taxable: sum('txval'), igst: sum('igst') + sum('iamt'), cgst: sum('cgst') + sum('camt'), sgst: sum('sgst') + sum('samt'), cess: sum('cess') + sum('csamt'), itc: String(inv.itcavl ?? 'Y').toUpperCase() !== 'N', rcm: String(inv.rev ?? inv.rchrg ?? 'N').toUpperCase() === 'Y' };
      if (items.length === 0) { e.taxable = rupeesToPaise(inv.txval); e.igst = rupeesToPaise(inv.igst); e.cgst = rupeesToPaise(inv.cgst); e.sgst = rupeesToPaise(inv.sgst); e.cess = rupeesToPaise(inv.cess); }
      entries.push(e);
    }
  }
  return entries;
}

/** Loads a 2B statement for a month (replacing any earlier load of the same entries) and matches each entry to a bill by supplier and number. */
export async function importGstr2b(sql: Sql, t: TenantSession, period: string, json: unknown) {
  monthBounds(period);
  const entries = parseGstr2b(json);
  if (entries.length === 0) throw new ValidationError('The file has no supplier invoices in its B2B section.');
  if (entries.length > 20_000) throw new ValidationError('That file is too large. Split it by month.');
  return inTenant(sql, t, 'purchase.write', async (tx) => {
    let added = 0, updated = 0;
    for (const e of entries) {
      const r = await tx`insert into gstr2b_entry (business_id, period, supplier_gstin, supplier_name, invoice_number, invoice_date, taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise, itc_available, reverse_charge)
                         values (${t.businessId}, ${period}, ${e.gstin}, ${e.name}, ${e.number}, ${e.date}, ${e.taxable.toString()}, ${e.cgst.toString()}, ${e.sgst.toString()}, ${e.igst.toString()}, ${e.cess.toString()}, ${e.itc}, ${e.rcm})
                         on conflict (business_id, period, supplier_gstin, invoice_number) do update set supplier_name = excluded.supplier_name, invoice_date = excluded.invoice_date, taxable_paise = excluded.taxable_paise,
                           cgst_paise = excluded.cgst_paise, sgst_paise = excluded.sgst_paise, igst_paise = excluded.igst_paise, cess_paise = excluded.cess_paise, itc_available = excluded.itc_available, reverse_charge = excluded.reverse_charge
                         returning (xmax = 0) as inserted`;
      if (r[0]!.inserted) added++; else updated++;
    }
    const matched = await matchEntries(tx, t.businessId, period);
    return { entries: entries.length, added, updated, matched };
  });
}

/** Links unmatched 2B entries to bills. Safe to run again after bills are added. Returns how many links exist for the month. */
async function matchEntries(tx: import('@kora/db').Tx, businessId: string, period: string): Promise<number> {
  const entries = await tx`select e.id, e.supplier_gstin, e.invoice_number from gstr2b_entry e where e.business_id = ${businessId} and e.period = ${period} and e.bill_id is null`;
  if (entries.length) {
    const bills = await tx`select b.id, b.bill_number, p.gstin from purchase_bill b join party p on p.id = b.party_id where b.status = 'recorded' and p.gstin is not null
                              and not exists (select 1 from gstr2b_entry x where x.bill_id = b.id)`;
    const byKey = new Map<string, string>();
    for (const b of bills) byKey.set(`${b.gstin}|${normaliseInvoiceNumber(b.bill_number as string)}`, b.id as string);
    for (const e of entries) {
      const bid = byKey.get(`${e.supplier_gstin}|${normaliseInvoiceNumber(e.invoice_number as string)}`);
      if (bid) { await tx`update gstr2b_entry set bill_id = ${bid} where id = ${e.id}`; byKey.delete(`${e.supplier_gstin}|${normaliseInvoiceNumber(e.invoice_number as string)}`); }
    }
  }
  const [c] = await tx`select count(*)::int as n from gstr2b_entry where business_id = ${businessId} and period = ${period} and bill_id is not null`;
  return c!.n as number;
}

const TOLERANCE = 100n;    // Rs 1: vendors and portals round differently
const dif = (a: unknown, b: unknown) => { const d = BigInt(a as string) - BigInt(b as string); return d < 0n ? -d : d; };

/** Compares your bills with the supplier-filed statement: matched, differing in amount, in 2B only, and in your books only. */
export async function reconcileGstr2b(sql: Sql, t: TenantSession, period: string) {
  const { from, to } = monthBounds(period);
  return inTenant(sql, t, 'purchase.write', async (tx) => {
    await matchEntries(tx, t.businessId, period);
    const rows = await tx`select e.id, e.supplier_gstin, e.supplier_name, e.invoice_number, e.invoice_date::text as invoice_date, e.itc_available, e.reverse_charge,
                                 e.taxable_paise, e.cgst_paise, e.sgst_paise, e.igst_paise, e.cess_paise, e.bill_id,
                                 b.bill_number, b.taxable_paise as b_taxable, b.cgst_paise as b_cgst, b.sgst_paise as b_sgst, b.igst_paise as b_igst, b.cess_paise as b_cess
                            from gstr2b_entry e left join purchase_bill b on b.id = e.bill_id where e.period = ${period} order by e.supplier_gstin, e.invoice_number`;
    const matched: unknown[] = [], mismatched: unknown[] = [], onlyIn2b: unknown[] = [];
    for (const r of rows) {
      const base = { entryId: r.id as string, gstin: r.supplier_gstin as string, supplier: r.supplier_name as string | null, invoiceNumber: r.invoice_number as string, invoiceDate: r.invoice_date as string | null, itcAvailable: r.itc_available as boolean };
      if (!r.bill_id) { onlyIn2b.push({ ...base, taxablePaise: String(r.taxable_paise), taxPaise: (BigInt(r.cgst_paise as string) + BigInt(r.sgst_paise as string) + BigInt(r.igst_paise as string) + BigInt(r.cess_paise as string)).toString() }); continue; }
      const diffs: Record<string, string> = {};
      for (const [k, a, b] of [['taxable', r.taxable_paise, r.b_taxable], ['cgst', r.cgst_paise, r.b_cgst], ['sgst', r.sgst_paise, r.b_sgst], ['igst', r.igst_paise, r.b_igst], ['cess', r.cess_paise, r.b_cess]] as const) {
        if (dif(a, b) > TOLERANCE) diffs[k] = (BigInt(a as string) - BigInt(b as string)).toString();   // 2B minus books
      }
      (Object.keys(diffs).length ? mismatched : matched).push({ ...base, billId: r.bill_id as string, billNumber: r.bill_number as string, differences: diffs });
    }
    const books = await tx`select b.id, b.bill_number, b.bill_date::text as bill_date, p.name as vendor, p.gstin as vendor_gstin, b.reverse_charge,
                                  (b.cgst_paise + b.sgst_paise + b.igst_paise + b.cess_paise)::text as tax_paise
                             from purchase_bill b join party p on p.id = b.party_id
                            where b.status = 'recorded' and b.bill_date >= ${from}::date and b.bill_date < ${to}::date and p.gstin is not null and not b.reverse_charge
                              and not exists (select 1 from gstr2b_entry x where x.bill_id = b.id)`;
    return {
      period, loaded: rows.length,
      counts: { matched: matched.length, mismatched: mismatched.length, onlyIn2b: onlyIn2b.length, onlyInBooks: books.length },
      matched, mismatched, onlyIn2b,
      onlyInBooks: books.map((b) => ({ billId: b.id as string, billNumber: b.bill_number as string, billDate: b.bill_date as string, vendor: b.vendor as string, gstin: b.vendor_gstin as string, taxPaise: b.tax_paise as string })),
    };
  });
}

/** Turns a 2B entry that is not in your books into a bill, creating the vendor from its GSTIN if you do not have one yet. */
export async function acceptGstr2bEntry(sql: Sql, t: TenantSession, entryId: string): Promise<{ billId: string }> {
  return inTenant(sql, t, 'purchase.write', async (tx) => {
    const [e] = await tx`select * from gstr2b_entry where id = ${entryId}`;
    if (!e) throw new ValidationError('That statement line was not found.');
    if (e.bill_id) throw new ValidationError('That line is already matched to a bill.');
    const gstin = e.supplier_gstin as string;
    const [b] = await tx`select state_code from business where id = ${t.businessId}`;
    const state = gstin.slice(0, 2);
    let [v] = await tx`select id from party where gstin = ${gstin} and kind in ('vendor', 'both')`;
    if (!v) [v] = await tx`insert into party (business_id, kind, name, gstin, state_code) values (${t.businessId}, 'vendor', ${String(e.supplier_name ?? gstin).slice(0, 120)}, ${gstin}, ${state}) returning id`;
    const supply = state === b!.state_code ? 'intra' : 'inter';
    const taxable = BigInt(e.taxable_paise as string), cgst = BigInt(e.cgst_paise as string), sgst = BigInt(e.sgst_paise as string), igst = BigInt(e.igst_paise as string), cess = BigInt(e.cess_paise as string);
    const rcm = e.reverse_charge as boolean;
    const total = taxable + (rcm ? 0n : cgst + sgst + igst + cess);
    const date = (e.invoice_date as Date | string | null) ? String(e.invoice_date instanceof Date ? e.invoice_date.toISOString().slice(0, 10) : e.invoice_date).slice(0, 10) : `${e.period}-01`;
    const [bill] = await tx`insert into purchase_bill (business_id, party_id, bill_number, bill_date, supply, reverse_charge, taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise, total_paise, itc_status, itc_reason, notes, created_by)
                            values (${t.businessId}, ${v!.id}, ${e.invoice_number}, ${date}, ${supply}, ${rcm}, ${taxable.toString()}, ${cgst.toString()}, ${sgst.toString()}, ${igst.toString()}, ${cess.toString()}, ${total.toString()},
                                    ${e.itc_available ? 'eligible' : 'blocked'}, ${e.itc_available ? null : 'Marked not available in GSTR-2B'}, 'Created from the GSTR-2B statement', ${t.userId}) returning id`;
    await tx`insert into purchase_line (business_id, bill_id, line_no, description, quantity_milli, rate_paise, tax_rate_bp, taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise, total_paise)
             values (${t.businessId}, ${bill!.id}, 1, ${`Invoice ${e.invoice_number} (from GSTR-2B)`}, 1000, ${taxable.toString()}, ${taxable > 0n ? nearestSlabBp(Number(((cgst + sgst + igst) * 10000n) / taxable)) : 0}, ${taxable.toString()}, ${cgst.toString()}, ${sgst.toString()}, ${igst.toString()}, ${cess.toString()}, ${total.toString()})`;
    await tx`update gstr2b_entry set bill_id = ${bill!.id} where id = ${entryId}`;
    return { billId: bill!.id as string };
  });
}


/**
 * Where the books and the GSTR-2B statement stand for a month, read as the business last left them. It does not run the matching (that writes);
 * it counts what is already matched. A CA firm reading a linked client uses this, so it can show differences without changing anything.
 */
export async function reconciliationCounts(sql: Sql, t: TenantSession, period: string) {
  const { from, to } = monthBounds(period);
  return inTenant(sql, t, 'purchase.read', async (tx) => {
    const [c] = await tx`select count(*)::int as loaded,
        count(*) filter (where e.bill_id is null)::int as only_in_2b,
        count(*) filter (where e.bill_id is not null and (abs(e.taxable_paise - b.taxable_paise) > 100 or abs(e.cgst_paise - b.cgst_paise) > 100 or abs(e.sgst_paise - b.sgst_paise) > 100
                                                          or abs(e.igst_paise - b.igst_paise) > 100 or abs(e.cess_paise - b.cess_paise) > 100))::int as mismatched
      from gstr2b_entry e left join purchase_bill b on b.id = e.bill_id where e.period = ${period}`;
    const [bk] = await tx`select count(*)::int as n from purchase_bill b join party p on p.id = b.party_id
                           where b.status = 'recorded' and b.bill_date >= ${from}::date and b.bill_date < ${to}::date and p.gstin is not null and not b.reverse_charge
                             and not exists (select 1 from gstr2b_entry x where x.bill_id = b.id)`;
    const loaded = c!.loaded as number;
    return { period, loaded, matched: loaded - (c!.only_in_2b as number) - (c!.mismatched as number), mismatched: c!.mismatched as number, onlyIn2b: c!.only_in_2b as number, onlyInBooks: bk!.n as number };
  });
}
