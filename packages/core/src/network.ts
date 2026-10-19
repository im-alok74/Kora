import { computeLine, DEFAULT_ALLOWED_RATE_BP, parseQuantity, parseRupees, TaxError } from '@kora/tax';
import type { Sql, Tx } from '@kora/db';
import { saveDraft, type LineIn } from './documents.js';
import { can, ForbiddenError } from './permissions.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { isDate, str, todayIn, ValidationError } from './validation.js';

/**
 * The Kora network. An invoice issued to a customer whose GSTIN is another Kora business reaches that business by itself, and a listed
 * business can be sent purchase orders. The database moves the rows between businesses (see migration 0023); this file is what each side does with them.
 */

// ---------------------------------------------------------------- listing and settings
export async function getNetworkSettings(sql: Sql, t: TenantSession) {
  return inTenant(sql, t, 'document.read', async (tx) => {
    const [b] = await tx`select network_receive, gstin from business where id = ${t.businessId}`;
    const [p] = await tx`select listed, about, categories, city from network_profile where business_id = ${t.businessId}`;
    const [n] = await tx`select count(*)::int as n from item where network_listed and archived_at is null`;
    return { receive: b!.network_receive as boolean, hasGstin: !!b!.gstin, listed: !!p?.listed, about: (p?.about as string | null) ?? '', categories: (p?.categories as string[] | undefined) ?? [], city: (p?.city as string | null) ?? '', listedItems: n!.n as number };
  });
}

export async function saveNetworkSettings(sql: Sql, t: TenantSession, i: { receive?: boolean; listed?: boolean; about?: string | null; categories?: string[]; city?: string | null }) {
  const about = i.about === undefined ? undefined : str(i.about, 'About', { max: 600 });
  const city = i.city === undefined ? undefined : str(i.city, 'City', { max: 80 });
  const cats = i.categories === undefined ? undefined : [...new Set(i.categories.map((c) => String(c).trim()).filter(Boolean))].slice(0, 8);
  if (cats?.some((c) => c.length > 40)) throw new ValidationError('Each category is at most 40 characters.', 'categories');
  await inTenant(sql, t, 'settings.write', async (tx) => {
    const [b] = await tx`select gstin from business where id = ${t.businessId}`;
    if (i.listed && !b!.gstin) throw new ValidationError('Only a business with a GSTIN can be listed. Add it in Settings first.', 'listed');
    if (i.receive !== undefined) await tx`update business set network_receive = ${!!i.receive} where id = ${t.businessId}`;
    await tx`insert into network_profile (business_id, listed, about, categories, city) values (${t.businessId}, ${!!i.listed}, ${about ?? null}, ${cats ?? []}, ${city ?? null})
             on conflict (business_id) do update set listed = ${i.listed === undefined ? tx`network_profile.listed` : !!i.listed},
               about = ${about === undefined ? tx`network_profile.about` : about}, categories = ${cats === undefined ? tx`network_profile.categories` : cats},
               city = ${city === undefined ? tx`network_profile.city` : city}, updated_at = now()`;
  });
}

export async function networkDirectory(sql: Sql, t: TenantSession, q?: string) {
  return inTenant(sql, t, 'document.read', (tx) => tx`select business_id, name, gstin, city, state_code, about, categories, items from network_directory(${q?.trim() || null}, 30)`);
}

export async function networkCatalogue(sql: Sql, t: TenantSession, sellerBusinessId: string) {
  return inTenant(sql, t, 'document.read', async (tx) => {
    const [s] = await tx`select name, gstin from network_seller(${sellerBusinessId})`;
    if (!s) return null;
    const items = await tx`select name, kind, hsn_sac, unit, price_paise::text as price_paise, price_includes_tax, default_rate_bp from network_catalogue(${sellerBusinessId})`;
    return { seller: { id: sellerBusinessId, name: s.name as string, gstin: s.gstin as string }, items };
  });
}

// ---------------------------------------------------------------- invoices received
export async function listReceivedInvoices(sql: Sql, t: TenantSession, f: { status?: string } = {}) {
  if (f.status && !['new', 'accepted', 'rejected'].includes(f.status)) throw new ValidationError('Choose new, accepted or rejected.', 'status');
  return inTenant(sql, t, 'purchase.read', (tx) => tx`
    select id, seller_name, seller_gstin, doc_type, number, doc_date::text as doc_date, due_date::text as due_date, supply, reverse_charge, taxable_paise::text as taxable_paise,
           (cgst_paise + sgst_paise + igst_paise + cess_paise)::text as tax_paise, grand_total_paise::text as grand_total_paise, status, seller_cancelled_at, bill_id, reason, received_at, decided_at
      from network_invoice where (${f.status ?? null}::text is null or status = ${f.status ?? null})
     order by (status = 'new') desc, received_at desc limit 200`);
}

export async function getReceivedInvoice(sql: Sql, t: TenantSession, id: string) {
  return inTenant(sql, t, 'purchase.read', async (tx) => {
    const [n] = await tx`select * from network_invoice where id = ${id}`;
    return n ?? null;
  });
}

/** Turns a received invoice into a purchase bill with exactly the supplier's amounts, creating the vendor from its GSTIN if needed. */
export async function acceptReceivedInvoice(sql: Sql, t: TenantSession, id: string): Promise<{ billId: string; linked: boolean }> {
  return inTenant(sql, t, 'purchase.write', async (tx) => {
    const [n] = await tx`select * from network_invoice where id = ${id} for update`;
    if (!n) throw new ValidationError('That invoice was not found.');
    if (n.status === 'accepted' && n.bill_id) return { billId: n.bill_id as string, linked: true };
    if (n.status === 'rejected') throw new ValidationError('You rejected this invoice. Ask the seller to send it again.');
    if (n.seller_cancelled_at) throw new ValidationError('The seller cancelled this invoice. It cannot be accepted.');
    const gstin = n.seller_gstin as string;
    let [v] = await tx`select id from party where gstin = ${gstin} and kind in ('vendor', 'both')`;
    if (!v) [v] = await tx`insert into party (business_id, kind, name, gstin, state_code) values (${t.businessId}, 'vendor', ${String(n.seller_name).slice(0, 120)}, ${gstin}, ${gstin.slice(0, 2)}) returning id`;
    // the same bill may already have been keyed in by hand: link it rather than make a second one
    const [dup] = await tx`select id from purchase_bill where party_id = ${v!.id} and lower(bill_number) = lower(${n.number}) and status = 'recorded'`;
    let billId: string, linked = false;
    if (dup) { billId = dup.id as string; linked = true; }
    else {
      const rcm = n.reverse_charge as boolean;
      const total = BigInt(n.taxable_paise as string) + (rcm ? 0n : BigInt(n.cgst_paise as string) + BigInt(n.sgst_paise as string) + BigInt(n.igst_paise as string) + BigInt(n.cess_paise as string));
      const [bill] = await tx`insert into purchase_bill (business_id, party_id, bill_number, bill_date, due_date, supply, reverse_charge, taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise, total_paise, itc_status, notes, created_by)
                              values (${t.businessId}, ${v!.id}, ${n.number}, ${n.doc_date}, ${n.due_date}, ${n.supply}, ${rcm}, ${n.taxable_paise}, ${n.cgst_paise}, ${n.sgst_paise}, ${n.igst_paise}, ${n.cess_paise}, ${total.toString()},
                                      ${n.doc_type === 'bill_of_supply' ? 'blocked' : 'eligible'}, ${`Received through Kora from ${n.seller_name}`}, ${t.userId}) returning id`;
      billId = bill!.id as string;
      let k = 0;
      for (const l of n.lines as Record<string, any>[]) {
        k++;
        const qtyMilli = BigInt(Math.max(1, Math.round(Number(l.quantity) * 1000)));
        await tx`insert into purchase_line (business_id, bill_id, line_no, description, hsn_sac, quantity_milli, rate_paise, discount_paise, tax_rate_bp, cess_rate_bp, taxable_paise, cgst_paise, sgst_paise, igst_paise, cess_paise, total_paise)
                 values (${t.businessId}, ${billId}, ${k}, ${String(l.name).slice(0, 300)}, ${l.hsn ?? null}, ${qtyMilli.toString()}, ${String(l.rate_paise)}, ${String(l.discount_paise ?? 0)}, ${l.tax_rate_bp}, ${l.cess_rate_bp ?? 0},
                         ${String(l.taxable_paise)}, ${String(l.cgst_paise)}, ${String(l.sgst_paise)}, ${String(l.igst_paise)}, ${String(l.cess_paise)}, ${String(l.total_paise)})`;
      }
    }
    await tx`update network_invoice set status = 'accepted', bill_id = ${billId}, decided_by = ${t.userId}, decided_at = now() where id = ${id}`;
    return { billId, linked };
  });
}

export async function rejectReceivedInvoice(sql: Sql, t: TenantSession, id: string, reason: string): Promise<void> {
  const why = str(reason, 'Reason', { required: true, max: 300 })!;
  await inTenant(sql, t, 'purchase.write', async (tx) => {
    const r = await tx`update network_invoice set status = 'rejected', reason = ${why}, decided_by = ${t.userId}, decided_at = now() where id = ${id} and status = 'new' returning id`;
    if (r.length === 0) throw new ValidationError('Only a new invoice can be rejected.');
  });
}

/** What became of an invoice the business sent through Kora, or null if it did not go to another Kora business. */
export async function deliveryStatus(sql: Sql, t: TenantSession, documentId: string) {
  return inTenant(sql, t, 'document.read', async (tx) => {
    const [r] = await tx`select buyer_name, status, seller_cancelled, received_at, decided_at, reason from network_delivery_status(${documentId})`;
    return r ? { buyer: r.buyer_name as string, status: r.status as string, sellerCancelled: r.seller_cancelled as boolean, receivedAt: r.received_at as string, decidedAt: r.decided_at as string | null, reason: r.reason as string | null } : null;
  });
}

// ---------------------------------------------------------------- orders
export interface OrderLineIn { name: string; hsnSac?: string | null; unit?: string; quantity: string; rate: string; taxRateBp: number }

function cleanOrderLines(lines: OrderLineIn[]) {
  if (!Array.isArray(lines) || lines.length === 0) throw new ValidationError('Add at least one item.', 'lines');
  if (lines.length > 100) throw new ValidationError('An order can have at most 100 lines.', 'lines');
  return lines.map((l, i) => {
    const name = str(l.name, `Line ${i + 1} name`, { required: true, max: 200 })!;
    const hsn = l.hsnSac ? String(l.hsnSac).trim() : null;
    if (hsn && !/^[0-9]{4,8}$/.test(hsn)) throw new ValidationError(`Line ${i + 1}: HSN or SAC is 4 to 8 digits.`, 'hsnSac');
    try {
      const q = parseQuantity(String(l.quantity)), r = parseRupees(String(l.rate));
      computeLine({ quantityMilli: q, ratePaise: r, taxRateBp: l.taxRateBp }, 'intra', DEFAULT_ALLOWED_RATE_BP);
      return { name, hsn, unit: str(l.unit, 'Unit', { max: 10 }) ?? 'NOS', quantity: String(l.quantity).trim(), rate: String(l.rate).trim(), taxRateBp: l.taxRateBp };
    } catch (e) { if (e instanceof TaxError) throw new ValidationError(`Line ${i + 1}: ${e.message}`, 'lines'); throw new ValidationError(`Line ${i + 1}: enter the quantity and rate as numbers.`, 'lines'); }
  });
}

export async function createOrder(sql: Sql, t: TenantSession, i: { sellerBusinessId: string; lines: OrderLineIn[]; poNumber?: string | null; poDate?: string; expectedOn?: string | null; notes?: string | null }) {
  if (!can(t.role, 'purchase.write')) throw new ForbiddenError('purchase.write');
  const lines = cleanOrderLines(i.lines);
  const notes = str(i.notes, 'Notes', { max: 1000 });
  if (i.expectedOn && !isDate(i.expectedOn)) throw new ValidationError('Enter the date as YYYY-MM-DD.', 'expectedOn');
  return inTenant(sql, t, 'document.read', async (tx) => {
    const [me] = await tx`select legal_name, trade_name, gstin, timezone from business where id = ${t.businessId}`;
    if (!me!.gstin) throw new ValidationError('Only a business with a GSTIN can send orders. Add it in Settings first.');
    const [seller] = await tx`select name, gstin from network_seller(${i.sellerBusinessId})`;
    if (!seller) throw new ValidationError('That business is not listed on Kora.', 'sellerBusinessId');
    const date = i.poDate || todayIn(me!.timezone as string);
    if (!isDate(date)) throw new ValidationError('Enter the order date as YYYY-MM-DD.', 'poDate');
    let po = str(i.poNumber, 'Order number', { max: 40 });
    if (!po) { const [c] = await tx`select count(*)::int as n from network_order where business_id = ${t.businessId}`; po = `PO-${String((c!.n as number) + 1).padStart(4, '0')}`; }
    try {
      const [o] = await tx`insert into network_order (business_id, seller_business_id, buyer_name, buyer_gstin, seller_name, seller_gstin, po_number, po_date, expected_on, lines, notes, created_by)
                           values (${t.businessId}, ${i.sellerBusinessId}, ${String(me!.trade_name ?? me!.legal_name)}, ${me!.gstin}, ${seller.name}, ${seller.gstin}, ${po}, ${date}, ${i.expectedOn ?? null}, ${tx.json(lines as never)}, ${notes}, ${t.userId}) returning id`;
      return { id: o!.id as string, poNumber: po };
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ValidationError('You already used that order number.', 'poNumber');
      throw e;
    }
  });
}

export async function listOrders(sql: Sql, t: TenantSession, side: 'sent' | 'received') {
  return inTenant(sql, t, 'purchase.read', (tx) => tx`
    select id, po_number, po_date::text as po_date, expected_on::text as expected_on, status, buyer_name, buyer_gstin, seller_name, seller_gstin, decline_reason, seller_document_id, created_at,
           jsonb_array_length(lines) as line_count
      from network_order where ${side === 'sent' ? tx`business_id = ${t.businessId}` : tx`seller_business_id = ${t.businessId}`} order by created_at desc limit 200`);
}

export async function getOrder(sql: Sql, t: TenantSession, id: string) {
  return inTenant(sql, t, 'purchase.read', async (tx) => {
    const [o] = await tx`select * from network_order where id = ${id}`;
    if (!o) return null;
    const side = o.business_id === t.businessId ? 'sent' as const : 'received' as const;
    return { side, order: o };
  });
}

export async function cancelOrder(sql: Sql, t: TenantSession, id: string): Promise<void> {
  await inTenant(sql, t, 'purchase.write', async (tx) => {
    try {
      const r = await tx`update network_order set status = 'cancelled' where id = ${id} and business_id = ${t.businessId} returning id`;
      if (r.length === 0) throw new ValidationError('Order not found.');
    } catch (e) { if ((e as { code?: string }).code === '23514' && e instanceof Error) throw new ValidationError(e.message); throw e; }
  });
}

export async function declineOrder(sql: Sql, t: TenantSession, id: string, reason: string): Promise<void> {
  const why = str(reason, 'Reason', { required: true, max: 300 })!;
  await inTenant(sql, t, 'document.write', async (tx) => {
    try {
      const r = await tx`update network_order set status = 'declined', decline_reason = ${why} where id = ${id} and seller_business_id = ${t.businessId} returning id`;
      if (r.length === 0) throw new ValidationError('Order not found.');
    } catch (e) { if ((e as { code?: string }).code === '23514' && e instanceof Error) throw new ValidationError(e.message); throw e; }
  });
}

/** Accepts an order and makes a draft invoice for the buyer, from the order's lines. The seller reviews and issues it as usual. */
export async function acceptOrder(sql: Sql, t: TenantSession, id: string): Promise<{ documentId: string }> {
  if (!can(t.role, 'document.write')) throw new ForbiddenError('document.write');
  const o = await inTenant(sql, t, 'document.read', async (tx) => {
    const [r] = await tx`select * from network_order where id = ${id} and seller_business_id = ${t.businessId}`;
    return r ?? null;
  });
  if (!o) throw new ValidationError('Order not found.');
  if (o.status !== 'sent') throw new ValidationError(`This order has already been ${o.status}.`);
  const gstin = o.buyer_gstin as string;
  const partyId = await inTenant(sql, t, 'party.write', async (tx) => {
    const [p] = await tx`select id from party where gstin = ${gstin} and kind in ('customer', 'both') and archived_at is null`;
    if (p) return p.id as string;
    const [c] = await tx`insert into party (business_id, kind, name, gstin, state_code) values (${t.businessId}, 'customer', ${String(o.buyer_name).slice(0, 120)}, ${gstin}, ${gstin.slice(0, 2)}) returning id`;
    return c!.id as string;
  });
  const lines: LineIn[] = (o.lines as Record<string, any>[]).map((l) => ({ name: l.name, hsnSac: l.hsn, unit: l.unit, quantity: l.quantity, rate: l.rate, taxRateBp: l.taxRateBp, kind: 'goods' }));
  const { id: documentId } = await saveDraft(sql, t, { docType: 'tax_invoice', partyId, lines, notes: `Against order ${o.po_number} from ${o.buyer_name}` });
  await inTenant(sql, t, 'document.write', async (tx: Tx) => {
    await tx`update network_order set status = 'accepted', seller_document_id = ${documentId} where id = ${id} and seller_business_id = ${t.businessId}`;
  });
  return { documentId };
}
