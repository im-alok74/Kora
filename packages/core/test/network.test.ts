import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { gstinCheckChar } from '@kora/tax';
import {
  acceptOrder, acceptReceivedInvoice, addMember, cancelDocument, cancelOrder, createBill, createBusiness, createItem, createOrder, createParty, declineOrder, deliveryStatus, getBill, getOrder,
  getNetworkSettings, issueDocument, itcSummary, listOrders, listReceivedInvoices, networkCatalogue, networkDirectory, rejectReceivedInvoice, resolveTenant, saveDraft, saveNetworkSettings,
  type TenantSession,
} from '../src/index.js';

const gstinFor = (state: string, pan: string, n: string) => { const b = `${state}${pan}${n}A1Z`; return b + gstinCheckChar(b); };
const G_SELLER = gstinFor('27', 'AAACS', '1111');
const G_BUYER = gstinFor('29', 'AAACB', '2222');
const G_OUTSIDER = gstinFor('33', 'AAACO', '3333');
let db: TestDb;
let seller: TenantSession, sellerStaff: TenantSession, buyer: TenantSession, buyerCa: TenantSession, outsider: TenantSession;
let buyerAsCustomer: string;

const line = (rate: string, name = 'Steel rod') => ({ name, hsnSac: '7214', quantity: '10', rate, taxRateBp: 1800, kind: 'goods' as const });
const sendInvoice = async (rate: string, party = buyerAsCustomer) => {
  const { id } = await saveDraft(db.web, seller, { docType: 'tax_invoice', partyId: party, lines: [line(rate)] });
  await issueDocument(db.web, seller, id);
  return id;
};

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [s, ss, b, bc, o] = [await mk('s@e.test'), await mk('ss@e.test'), await mk('b@e.test'), await mk('bc@e.test'), await mk('o@e.test')];
  const sb = await createBusiness(db.web, s, { legalName: 'Maharashtra Steel', gstin: G_SELLER, stateCode: '27', registrationType: 'regular' });
  const bb = await createBusiness(db.web, b, { legalName: 'Karnataka Builders', gstin: G_BUYER, stateCode: '29', registrationType: 'regular' });
  const ob = await createBusiness(db.web, o, { legalName: 'Tamil Traders', gstin: G_OUTSIDER, stateCode: '33', registrationType: 'regular' });
  await addMember(db.web, s, sb, ss, 'staff'); await addMember(db.web, b, bb, bc, 'accountant');
  seller = await resolveTenant(db.web, s, sb); sellerStaff = await resolveTenant(db.web, ss, sb); buyer = await resolveTenant(db.web, b, bb); buyerCa = await resolveTenant(db.web, bc, bb);
  outsider = await resolveTenant(db.web, o, ob);
  buyerAsCustomer = await createParty(db.web, seller, { kind: 'customer', name: 'Karnataka Builders', gstin: G_BUYER, stateCode: '29' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('an issued invoice reaches the buyer on Kora', () => {
  let inv: string;
  it('arrives by itself, with the supplier\'s exact amounts, when the customer\'s GSTIN is a Kora business', async () => {
    inv = await sendInvoice('500');
    const [r] = await listReceivedInvoices(db.web, buyer);
    expect(r).toMatchObject({ seller_name: 'Maharashtra Steel', seller_gstin: G_SELLER, doc_type: 'tax_invoice', status: 'new', supply: 'inter', taxable_paise: '500000', tax_paise: '90000', grand_total_paise: '590000' });
    expect(r!.number).toMatch(/^INV\//);
    expect(await deliveryStatus(db.web, seller, inv)).toMatchObject({ buyer: 'Karnataka Builders', status: 'new', sellerCancelled: false });
  });
  it('is invisible to everyone else, and the seller cannot read the buyer\'s rows', async () => {
    expect(await listReceivedInvoices(db.web, outsider)).toEqual([]);
    expect(await listReceivedInvoices(db.web, seller)).toEqual([]);
    expect(await deliveryStatus(db.web, outsider, inv)).toBeNull();
    expect(await deliveryStatus(db.web, buyer, inv)).toBeNull();             // the buyer is not the sender
    expect(await db.web`select * from network_invoice`).toEqual([]);         // no tenant chosen: nothing readable
  });
  it('does not go anywhere for a customer who is not on Kora, has no GSTIN, or whose business turned receiving off', async () => {
    const stranger = await createParty(db.web, seller, { kind: 'customer', name: 'Not On Kora', gstin: gstinFor('07', 'AAACN', '4444'), stateCode: '07' });
    const noGstin = await createParty(db.web, seller, { kind: 'customer', name: 'No GSTIN Ltd', stateCode: '27' });
    const before = (await db.owner`select count(*)::int as n from network_invoice`)[0]!.n as number;
    await sendInvoice('10', stranger); await sendInvoice('10', noGstin);
    expect((await db.owner`select count(*)::int as n from network_invoice`)[0]!.n).toBe(before);
    await saveNetworkSettings(db.web, buyer, { receive: false });
    await sendInvoice('11');
    expect((await db.owner`select count(*)::int as n from network_invoice`)[0]!.n).toBe(before);
    await saveNetworkSettings(db.web, buyer, { receive: true });
    expect((await getNetworkSettings(db.web, buyer)).receive).toBe(true);
  });
  it('is accepted into a purchase bill with the same totals and input credit, once, by anyone who may do purchases', async () => {
    const [r] = await listReceivedInvoices(db.web, buyerCa, { status: 'new' });
    const a = await acceptReceivedInvoice(db.web, buyerCa, r!.id as string);
    expect(a.linked).toBe(false);
    const bill = (await getBill(db.web, buyer, a.billId))!;
    expect(bill.bill).toMatchObject({ vendor: 'Maharashtra Steel', vendorGstin: G_SELLER, supply: 'inter', taxablePaise: '500000', igstPaise: '90000', totalPaise: '590000', itcStatus: 'eligible', status: 'recorded' });
    expect(bill.bill.notes).toBe('Received through Kora from Maharashtra Steel');
    expect(bill.lines).toHaveLength(1);
    expect(await acceptReceivedInvoice(db.web, buyer, r!.id as string)).toEqual({ billId: a.billId, linked: true });    // accepting again changes nothing
    expect((await listReceivedInvoices(db.web, buyer, { status: 'accepted' })).map((x) => x.id)).toEqual([r!.id]);
    expect(await deliveryStatus(db.web, seller, inv)).toMatchObject({ status: 'accepted' });
    const month = new Date().toISOString().slice(0, 7);
    expect((await itcSummary(db.web, buyer, month)).ordinary.igst).toBe('90000');
  });
  it('links to a bill already keyed in by hand instead of making a second one', async () => {
    const vendor = (await db.owner`select id from party where gstin = ${G_SELLER} and business_id = ${buyer.businessId}`)[0]!.id as string;
    const id2 = await sendInvoice('700');
    const number = (await db.owner`select number from document where id = ${id2}`)[0]!.number as string;
    const manual = await createBill(db.web, buyer, { partyId: vendor, billNumber: number.toLowerCase(), billDate: '2026-10-05', lines: [{ description: 'Steel', quantity: '1', rate: '1', taxRateBp: 1800 }] });
    const r = (await listReceivedInvoices(db.web, buyer, { status: 'new' })).find((x) => x.number === number)!;
    expect(await acceptReceivedInvoice(db.web, buyer, r.id as string)).toEqual({ billId: manual.id, linked: true });
  });
  it('can be rejected with a reason the seller can read, and then not accepted', async () => {
    const id3 = await sendInvoice('800');
    const r = (await listReceivedInvoices(db.web, buyer, { status: 'new' }))[0]!;
    await expect(rejectReceivedInvoice(db.web, buyer, r.id as string, '')).rejects.toThrow(/Reason/);
    await rejectReceivedInvoice(db.web, buyer, r.id as string, 'We did not order this');
    expect(await deliveryStatus(db.web, seller, id3)).toMatchObject({ status: 'rejected', reason: 'We did not order this' });
    await expect(acceptReceivedInvoice(db.web, buyer, r.id as string)).rejects.toThrow(/rejected this invoice/);
    await expect(rejectReceivedInvoice(db.web, buyer, r.id as string, 'again')).rejects.toThrow(/Only a new invoice/);
  });
  it('shows the buyer when the seller cancels, and refuses to accept it', async () => {
    const id4 = await sendInvoice('900');
    await cancelDocument(db.web, seller, id4, 'Wrong quantity');
    expect(await deliveryStatus(db.web, seller, id4)).toMatchObject({ sellerCancelled: true });
    const r = (await listReceivedInvoices(db.web, buyer, { status: 'new' }))[0]!;
    expect(r.seller_cancelled_at).not.toBeNull();
    await expect(acceptReceivedInvoice(db.web, buyer, r.id as string)).rejects.toThrow(/seller cancelled/);
  });
});

describe('the directory and catalogue', () => {
  it('lists only businesses that chose to be listed, with their catalogue, and never the asker', async () => {
    expect(await networkDirectory(db.web, buyer)).toEqual([]);
    await expect(saveNetworkSettings(db.web, buyerCa, { listed: true })).rejects.toThrow(/cannot do this/);
    await saveNetworkSettings(db.web, seller, { listed: true, about: 'Steel bars and sheets, delivered across Maharashtra', categories: ['Steel', 'Construction', 'Steel'], city: 'Pune' });
    await createItem(db.web, seller, { name: 'TMT bar 12mm', kind: 'goods', hsnSac: '7214', defaultRateBp: 1800, price: '68000', trackStock: false });
    const bar = (await db.owner`select id from item where name = 'TMT bar 12mm'`)[0]!.id as string;
    await db.owner`update item set network_listed = true where id = ${bar}`;
    await createItem(db.web, seller, { name: 'Private item', kind: 'goods', hsnSac: '7214', defaultRateBp: 1800, price: '1' });
    const dir = await networkDirectory(db.web, buyer);
    expect(dir).toHaveLength(1);
    expect(dir[0]).toMatchObject({ name: 'Maharashtra Steel', gstin: G_SELLER, city: 'Pune', categories: ['Steel', 'Construction'], items: 1 });
    expect(await networkDirectory(db.web, seller)).toEqual([]);                  // nobody sees themselves
    expect(await networkDirectory(db.web, buyer, 'tmt')).toHaveLength(1);        // found by an item name
    expect(await networkDirectory(db.web, buyer, 'pune')).toHaveLength(1);
    expect(await networkDirectory(db.web, buyer, 'plumbing')).toHaveLength(0);
    const cat = (await networkCatalogue(db.web, buyer, seller.businessId))!;
    expect(cat.items.map((i) => i.name)).toEqual(['TMT bar 12mm']);
    expect(cat.items[0]).toMatchObject({ price_paise: '6800000' });
  });
  it('refuses to list a business with no GSTIN, and hides an unlisted one again', async () => {
    const [u] = await db.owner`insert into app_user (email) values ('nogst@e.test') returning id`;
    const t = await resolveTenant(db.web, u!.id as string, await createBusiness(db.web, u!.id as string, { legalName: 'Small Seller', gstin: null, stateCode: '27', registrationType: 'unregistered' }));
    await expect(saveNetworkSettings(db.web, t, { listed: true })).rejects.toThrow(/GSTIN/);
    await saveNetworkSettings(db.web, seller, { listed: false });
    expect(await networkDirectory(db.web, buyer)).toEqual([]);
    expect(await networkCatalogue(db.web, buyer, seller.businessId)).toBeNull();
    await saveNetworkSettings(db.web, seller, { listed: true });
  });
});

describe('purchase orders', () => {
  let order: string;
  it('are sent to a listed business, numbered, and seen by both sides and nobody else', async () => {
    const o = await createOrder(db.web, buyerCa, { sellerBusinessId: seller.businessId, lines: [{ name: 'TMT bar 12mm', hsnSac: '7214', quantity: '100', rate: '680', taxRateBp: 1800 }], notes: 'Deliver to site B', expectedOn: '2026-11-15' });
    order = o.id;
    expect(o.poNumber).toBe('PO-0001');
    expect((await createOrder(db.web, buyer, { sellerBusinessId: seller.businessId, lines: [{ name: 'x', quantity: '1', rate: '1', taxRateBp: 0 }] })).poNumber).toBe('PO-0002');
    expect((await listOrders(db.web, buyer, 'sent')).map((x) => x.po_number)).toEqual(['PO-0002', 'PO-0001']);
    expect((await listOrders(db.web, seller, 'received')).map((x) => x.po_number)).toEqual(['PO-0002', 'PO-0001']);
    expect(await listOrders(db.web, outsider, 'received')).toEqual([]);
    expect(await listOrders(db.web, outsider, 'sent')).toEqual([]);
    expect((await getOrder(db.web, seller, order))).toMatchObject({ side: 'received' });
    expect((await getOrder(db.web, buyer, order))).toMatchObject({ side: 'sent' });
    expect(await getOrder(db.web, outsider, order)).toBeNull();
  });
  it('are refused for an unlisted business, a repeated number, an empty order, and a staff-less role', async () => {
    await expect(createOrder(db.web, buyer, { sellerBusinessId: outsider.businessId, lines: [{ name: 'x', quantity: '1', rate: '1', taxRateBp: 0 }] })).rejects.toThrow(/not listed/);
    await expect(createOrder(db.web, buyer, { sellerBusinessId: seller.businessId, poNumber: 'PO-0001', lines: [{ name: 'x', quantity: '1', rate: '1', taxRateBp: 0 }] })).rejects.toThrow(/already used that order number/);
    await expect(createOrder(db.web, buyer, { sellerBusinessId: seller.businessId, lines: [] })).rejects.toThrow(/at least one item/);
    await expect(createOrder(db.web, buyer, { sellerBusinessId: seller.businessId, lines: [{ name: 'x', quantity: '0', rate: '1', taxRateBp: 0 }] })).rejects.toThrow(/Line 1/);
    await expect(createOrder(db.web, outsider, { sellerBusinessId: seller.businessId, lines: [{ name: 'x', quantity: '1', rate: '1', taxRateBp: 0 }] })).resolves.toBeDefined();
  });
  it('are accepted by the seller into a draft invoice for the buyer, which flows back to the buyer when issued', async () => {
    const r = await acceptOrder(db.web, sellerStaff, order);
    const d = (await db.owner`select status, doc_type, notes, party_id from document where id = ${r.documentId}`)[0]!;
    expect(d).toMatchObject({ status: 'draft', doc_type: 'tax_invoice', notes: 'Against order PO-0001 from Karnataka Builders' });
    const o = (await getOrder(db.web, buyer, order))!.order;
    expect(o).toMatchObject({ status: 'accepted', seller_document_id: r.documentId });
    await issueDocument(db.web, seller, r.documentId);
    const received = (await listReceivedInvoices(db.web, buyer, { status: 'new' })).find((x) => x.grand_total_paise === '8024000');   // 100 x 680 = 68,000 + 18%
    expect(received).toBeDefined();
    await expect(acceptOrder(db.web, seller, order)).rejects.toThrow(/already been accepted/);
  });
  it('can be declined with a reason, or cancelled by the buyer, and only by the right side and only once', async () => {
    const a = await createOrder(db.web, buyer, { sellerBusinessId: seller.businessId, lines: [{ name: 'Sheet', quantity: '5', rate: '100', taxRateBp: 1800 }] });
    await expect(declineOrder(db.web, seller, a.id, '')).rejects.toThrow(/Reason/);
    await expect(cancelOrder(db.web, seller, a.id)).rejects.toThrow(/Order not found/);          // the seller cannot cancel the buyer's order
    await declineOrder(db.web, seller, a.id, 'Out of stock');
    expect((await getOrder(db.web, buyer, a.id))!.order).toMatchObject({ status: 'declined', decline_reason: 'Out of stock' });
    await expect(declineOrder(db.web, seller, a.id, 'again')).rejects.toThrow(/already been declined/);
    await expect(cancelOrder(db.web, buyer, a.id)).rejects.toThrow(/already been declined/);

    const b = await createOrder(db.web, buyer, { sellerBusinessId: seller.businessId, lines: [{ name: 'Sheet', quantity: '5', rate: '100', taxRateBp: 1800 }] });
    await cancelOrder(db.web, buyer, b.id);
    expect((await getOrder(db.web, seller, b.id))!.order.status).toBe('cancelled');
    await expect(acceptOrder(db.web, seller, b.id)).rejects.toThrow(/already been cancelled/);
  });
  it('cannot be tampered with: the database refuses edits to a sent order and moves made by the wrong side', async () => {
    const o = await createOrder(db.web, buyer, { sellerBusinessId: seller.businessId, lines: [{ name: 'Guarded', quantity: '1', rate: '1', taxRateBp: 0 }] });
    const sql = db.web;
    // the guard function runs for any session; here we use the app role through a tenant transaction
    const { withTenant } = await import('@kora/db');
    await expect(withTenant(sql, { businessId: buyer.businessId, userId: buyer.userId }, (tx) => tx`update network_order set notes = 'changed' where id = ${o.id}`)).rejects.toThrow(/cannot be edited/);
    await expect(withTenant(sql, { businessId: buyer.businessId, userId: buyer.userId }, (tx) => tx`update network_order set status = 'accepted' where id = ${o.id}`)).rejects.toThrow(/Only the seller/);
    await expect(withTenant(sql, { businessId: seller.businessId, userId: seller.userId }, (tx) => tx`update network_order set status = 'cancelled' where id = ${o.id}`)).rejects.toThrow(/accept or decline/);
    await expect(withTenant(sql, { businessId: outsider.businessId, userId: outsider.userId }, (tx) => tx`update network_order set status = 'declined' where id = ${o.id}`)).resolves.toBeDefined();   // not visible to them, so it changes nothing
    expect((await getOrder(db.web, buyer, o.id))!.order.status).toBe('sent');
  });
});
