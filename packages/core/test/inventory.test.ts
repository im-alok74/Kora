import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, adjustStock, cancelBill, cancelDocument, createBill, createBusiness, createItem, createParty, formatQuantity, findItemByBarcode, getDocument, issueDocument, listItems, resolveTenant,
  saveDraft, startNote, stockHistory, stockLevels, updateItem, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, staff: TenantSession, ca: TenantSession, other: TenantSession;
let vendor: string, customer: string;
const level = async (id: string) => (await stockLevels(db.web, owner)).find((r) => r.id === id)?.qty_milli as string | undefined;
const goods = (name: string, o: Record<string, unknown> = {}) => createItem(db.web, owner, { name, kind: 'goods', hsnSac: '1905', defaultRateBp: 500, price: '100', trackStock: true, ...o } as never);

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [o, s, c, x] = [await mk('o@e.test'), await mk('s@e.test'), await mk('c@e.test'), await mk('x@e.test')];
  const bid = await createBusiness(db.web, o, { legalName: 'Corner Shop', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  await addMember(db.web, o, bid, s, 'staff'); await addMember(db.web, o, bid, c, 'accountant');
  owner = await resolveTenant(db.web, o, bid); staff = await resolveTenant(db.web, s, bid); ca = await resolveTenant(db.web, c, bid);
  other = await resolveTenant(db.web, x, await createBusiness(db.web, x, { legalName: 'Other Shop', gstin: null, stateCode: '27', registrationType: 'unregistered' }));
  vendor = await createParty(db.web, owner, { kind: 'vendor', name: 'Wholesaler', stateCode: '27' });
  customer = await createParty(db.web, owner, { kind: 'customer', name: 'Walk Customer', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('items that track stock', () => {
  it('start at nothing, show in the stock list, and refuse services and a repeated barcode', async () => {
    const biscuit = await goods('Biscuit pack', { barcode: '8901234567890', reorderLevel: '5' });
    expect(await level(biscuit)).toBe('0');
    expect((await stockLevels(db.web, ca)).find((r) => r.id === biscuit)).toMatchObject({ barcode: '8901234567890', reorder_milli: '5000', low: true, out: true });
    await expect(goods('Duplicate', { barcode: '8901234567890' })).rejects.toThrow(/already has that barcode/);
    await expect(createItem(db.web, owner, { name: 'Repair', kind: 'service', hsnSac: '9987', defaultRateBp: 1800, trackStock: true })).rejects.toThrow(/Services have no stock/);
    await expect(goods('Bad level', { reorderLevel: 'lots' })).rejects.toThrow(/reorder level/);
    expect((await findItemByBarcode(db.web, owner, ' 8901234567890 '))).toMatchObject({ id: biscuit, name: 'Biscuit pack', price_paise: '10000' });
    expect(await findItemByBarcode(db.web, owner, 'nope')).toBeNull();
    expect(await findItemByBarcode(db.web, other, '8901234567890')).toBeNull();
    const listed = (await listItems(db.web, owner, { q: '8901234567890' })).find((r) => r.id === biscuit)!;
    expect(listed).toMatchObject({ track_stock: true, barcode: '8901234567890', qty_milli: '0' });
  });
});

describe('stock follows documents', () => {
  let item: string;
  it('comes in with a purchase bill, goes out when an invoice is issued, and comes back when either is cancelled', async () => {
    item = await goods('Tea 250g', { price: '150' });
    const bill = await createBill(db.web, owner, { partyId: vendor, billNumber: 'W-1', billDate: '2026-10-01', lines: [{ itemId: item, description: 'Tea 250g', quantity: '24', rate: '100', taxRateBp: 500 }] });
    expect(await level(item)).toBe('24000');
    const inv = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, lines: [{ itemId: item, name: 'Tea 250g', hsnSac: '1905', quantity: '3', rate: '150', taxRateBp: 500, kind: 'goods' }] });
    expect(await level(item)).toBe('24000');                    // a draft takes nothing
    await issueDocument(db.web, owner, inv.id);
    expect(await level(item)).toBe('21000');
    await cancelDocument(db.web, owner, inv.id, 'Customer changed mind');
    expect(await level(item)).toBe('24000');
    await cancelBill(db.web, owner, bill.id);
    expect(await level(item)).toBe('0');
    const kinds = (await stockHistory(db.web, ca, item)).map((m) => m.kind).reverse();
    expect(kinds).toEqual(['purchase', 'sale', 'sale_cancelled', 'purchase_cancelled']);
  });
  it('ignores items that are not tracked, and lines with no item', async () => {
    const plain = await goods('Loose sweets', { trackStock: false });
    const inv = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, lines: [
      { itemId: plain, name: 'Loose sweets', hsnSac: '1704', quantity: '2', rate: '10', taxRateBp: 500, kind: 'goods' }, { name: 'Free text', hsnSac: '1704', quantity: '1', rate: '10', taxRateBp: 500, kind: 'goods' }] });
    await issueDocument(db.web, owner, inv.id);
    expect((await db.owner`select count(*)::int as n from stock_movement where item_id = ${plain}`)[0]!.n).toBe(0);
  });
  it('takes fractions of a unit, and a credit note does not move stock', async () => {
    const rice = await goods('Rice', { unit: 'KGS', price: '60' });
    await adjustStock(db.web, owner, rice, { mode: 'in', quantity: '50', opening: true });
    const inv = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, lines: [{ itemId: rice, name: 'Rice', hsnSac: '1006', quantity: '2.5', rate: '60', taxRateBp: 500, kind: 'goods' }] });
    await issueDocument(db.web, owner, inv.id);
    expect(await level(rice)).toBe('47500');
    expect(formatQuantity('47500')).toBe('47.5');
    const note = await startNote(db.web, owner, inv.id, 'credit_note');
    await issueDocument(db.web, owner, note.id);
    expect(await level(rice)).toBe('47500');
    expect((await stockLevels(db.web, owner, { q: 'rice' }))[0]).toMatchObject({ qty_milli: '47500' });
  });
});

describe('adjusting by hand', () => {
  it('adds, removes and counts, and explains each one', async () => {
    const it = await goods('Soap');
    await expect(adjustStock(db.web, owner, it, { mode: 'in', quantity: '10' })).rejects.toThrow(/Say why/);
    await adjustStock(db.web, owner, it, { mode: 'in', quantity: '10', note: 'Customer return' });
    await adjustStock(db.web, staff, it, { mode: 'out', quantity: '2.5', note: 'Damaged' });
    expect(await level(it)).toBe('7500');
    expect(await adjustStock(db.web, owner, it, { mode: 'count', quantity: '7.5' })).toMatchObject({ changed: false });
    expect(await adjustStock(db.web, owner, it, { mode: 'count', quantity: '12' })).toMatchObject({ changed: true, qtyMilli: '12000' });
    expect(await adjustStock(db.web, owner, it, { mode: 'count', quantity: '0' })).toMatchObject({ qtyMilli: '0' });
    const h = await stockHistory(db.web, owner, it);
    expect(h.map((m) => m.qty_milli)).toEqual(['-12000', '4500', '-2500', '10000']);
    expect(h[1]!.note).toBe('Stock count');
    await expect(adjustStock(db.web, owner, it, { mode: 'in', quantity: '0', note: 'x' })).rejects.toThrow(/greater than zero/);
    await expect(adjustStock(db.web, owner, it, { mode: 'in', quantity: '1', note: 'x', date: 'yesterday' })).rejects.toThrow(/YYYY-MM-DD/);
  });
  it('is refused for untracked items, other businesses and the accountant, and movements cannot be edited', async () => {
    const plain = await goods('Untracked', { trackStock: false });
    await expect(adjustStock(db.web, owner, plain, { mode: 'in', quantity: '1', note: 'x' })).rejects.toThrow(/Turn on stock tracking/);
    const tracked = await goods('Tracked');
    await expect(adjustStock(db.web, other, tracked, { mode: 'in', quantity: '1', note: 'x' })).rejects.toThrow(/Item not found/);
    await expect(adjustStock(db.web, ca, tracked, { mode: 'in', quantity: '1', note: 'x' })).rejects.toThrow(/cannot do this/);
    await adjustStock(db.web, owner, tracked, { mode: 'in', quantity: '1', note: 'x' });
    await expect(db.web`update stock_movement set qty_milli = 99`).rejects.toThrow();
    await expect(db.web`delete from stock_movement`).rejects.toThrow();
    expect((await stockLevels(db.web, other)).length).toBe(0);
  });
  it('lists low stock only when asked', async () => {
    const low = await goods('Low one', { reorderLevel: '10' });
    await adjustStock(db.web, owner, low, { mode: 'in', quantity: '3', note: 'x' });
    const only = await stockLevels(db.web, owner, { lowOnly: true });
    expect(only.some((r) => r.id === low)).toBe(true);
    expect(only.every((r) => r.low)).toBe(true);
    await adjustStock(db.web, owner, low, { mode: 'in', quantity: '20', note: 'restock' });
    expect((await stockLevels(db.web, owner, { lowOnly: true })).some((r) => r.id === low)).toBe(false);
  });
});

describe('prices that include GST, end to end', () => {
  it('an MRP of Rs 99 at 18% totals exactly Rs 99, passes the database checks, and survives being reopened and corrected', async () => {
    const line = { name: 'Gift box', hsnSac: '3923', quantity: '1', rate: '99', taxRateBp: 1800, kind: 'goods' as const, taxInclusive: true };
    const d = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, lines: [line] });
    await issueDocument(db.web, owner, d.id);
    const doc = (await getDocument(db.web, owner, d.id))!;
    expect(doc.document.grand_total_paise).toBe('9900');
    expect(doc.lines[0]).toMatchObject({ price_includes_tax: true, rate_paise: '9900', line_total_paise: '9900', taxable_paise: '8390', cgst_paise: '755', sgst_paise: '755' });
    // the stored taxable value is Rs 83.90 (exact is 83.898): the paisa left over keeps CGST equal to SGST
    const note = await startNote(db.web, owner, d.id, 'credit_note');
    const n = (await getDocument(db.web, owner, note.id))!;
    expect(n.document.grand_total_paise).toBe('9900');
    expect(n.lines[0]).toMatchObject({ price_includes_tax: true });
  });
  it('several MRP lines still add up to the sum of their prices, rounded to the rupee', async () => {
    const lines = [49, 99, 250.5, 7].map((p, i) => ({ name: `Line ${i}`, hsnSac: '3923', quantity: '1', rate: String(p), taxRateBp: i % 2 ? 1800 : 500, kind: 'goods' as const, taxInclusive: true }));
    const d = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: customer, lines });
    const doc = (await getDocument(db.web, owner, d.id))!;
    const sum = doc.lines.reduce((s: bigint, l: Record<string, unknown>) => s + BigInt(l.line_total_paise as string), 0n);
    expect(sum).toBe(4900n + 9900n + 25050n + 700n);
    expect(BigInt(doc.document.grand_total_paise as string)).toBe(((sum + 50n) / 100n) * 100n);
  });
  it('an item can carry the flag for the till to use', async () => {
    const id = await goods('MRP item', { price: '118', priceIncludesTax: true, defaultRateBp: 1800 });
    expect((await findItemByBarcode(db.web, owner, 'none'))).toBeNull();
    expect((await listItems(db.web, owner, { q: 'MRP item' }))[0]).toMatchObject({ id, price_includes_tax: true, price_paise: '11800' });
    await updateItem(db.web, owner, id, { name: 'MRP item', kind: 'goods', hsnSac: '1905', defaultRateBp: 1800, price: '118', priceIncludesTax: false, trackStock: true });
    expect((await listItems(db.web, owner, { q: 'MRP item' }))[0]).toMatchObject({ price_includes_tax: false });
  });
});

describe('the till', () => {
  it('makes, issues and pays a bill in one step, takes stock out, and totals exactly the prices shown', async () => {
    const { completeSale } = await import('../src/index.js');
    const it = await goods('Counter item', { price: '99', priceIncludesTax: true, defaultRateBp: 1800 });
    await adjustStock(db.web, owner, it, { mode: 'in', quantity: '10', note: 'Opening stock' });
    const sale = await completeSale(db.web, staff, { method: 'upi', lines: [{ itemId: it, name: 'Counter item', hsnSac: '1905', quantity: '2', rate: '99', taxRateBp: 1800, kind: 'goods', taxInclusive: true }] });
    expect(sale).toMatchObject({ docType: 'tax_invoice', totalPaise: '19800', paid: true, paymentError: null });
    expect(await level(it)).toBe('8000');
    const d = (await getDocument(db.web, owner, sale.id))!;
    expect(d.document).toMatchObject({ status: 'issued', payment_status: 'paid', grand_total_paise: '19800' });
    const pay = await db.owner`select method, amount_paise from payment where id in (select payment_id from payment_allocation where document_id = ${sale.id})`;
    expect(pay[0]).toMatchObject({ method: 'upi', amount_paise: '19800' });
  });
  it('issues a bill of supply with no GST for a seller who cannot charge it', async () => {
    const { completeSale } = await import('../src/index.js');
    const [u] = await db.owner`insert into app_user (email) values ('tiny@e.test') returning id`;
    const small = await resolveTenant(db.web, u!.id as string, await createBusiness(db.web, u!.id as string, { legalName: 'Tiny Kirana', gstin: null, stateCode: '27', registrationType: 'unregistered' }));
    const sale = await completeSale(db.web, small, { lines: [{ name: 'Atta 5kg', hsnSac: '1101', quantity: '1', rate: '250', taxRateBp: 500, kind: 'goods', taxInclusive: true }] });
    expect(sale).toMatchObject({ docType: 'bill_of_supply', totalPaise: '25000', paid: true });
  });
  it('removes the draft when the bill cannot be issued, and refuses empty bills and unknown payment methods', async () => {
    const { completeSale } = await import('../src/index.js');
    const before = (await db.owner`select count(*)::int as n from document where status = 'draft'`)[0]!.n;
    await expect(completeSale(db.web, ca, { lines: [{ name: 'x', hsnSac: '1905', quantity: '1', rate: '1', taxRateBp: 500, kind: 'goods' }] })).rejects.toThrow(/cannot do this/);
    await expect(completeSale(db.web, staff, { lines: [{ name: 'x', hsnSac: '12', quantity: '1', rate: '1', taxRateBp: 500, kind: 'goods' }] })).rejects.toThrow(/HSN or SAC/);
    await expect(completeSale(db.web, staff, { lines: [] })).rejects.toThrow(/Add something/);
    await expect(completeSale(db.web, staff, { method: 'barter', lines: [{ name: 'x', hsnSac: '1905', quantity: '1', rate: '1', taxRateBp: 500, kind: 'goods' }] })).rejects.toThrow(/how the customer paid/);
    expect((await db.owner`select count(*)::int as n from document where status = 'draft'`)[0]!.n).toBe(before);
  });
});
