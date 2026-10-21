import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, applyMarkup, archivePriceList, assignPriceList, createBusiness, createItem, createParty, createPriceList, getDocument, getParty, issueDocument,
  listPriceLists, removePriceListEntry, resolveItemPrice, resolveTenant, saveDraft, setPriceListEntry, updatePriceList, validatePriceList, validatePriceListEntry,
  type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, accountant: TenantSession, other: TenantSession;
let cust: string, plain: string, otherCust: string;
let bolt: string, nut: string, mrp: string, otherItem: string;

const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const item = (t: TenantSession, name: string, price: string, inclusive = false) =>
  createItem(db.web, t, { name, defaultRateBp: 1800, price, priceIncludesTax: inclusive });
const price = (itemId: string, partyId: string | null = cust) => resolveItemPrice(db.web, owner, { itemId, partyId });

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [o, a, x] = [await mk('pl-o@c.test'), await mk('pl-a@c.test'), await mk('pl-x@c.test')];
  const bid = await createBusiness(db.web, o, { legalName: 'Price Co', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  await addMember(db.web, o, bid, a, 'accountant');
  owner = await resolveTenant(db.web, o, bid); accountant = await resolveTenant(db.web, a, bid);
  other = await resolveTenant(db.web, x, await createBusiness(db.web, x, { legalName: 'Other Co', gstin: '29BBBCC1234D1Z4', stateCode: '29', registrationType: 'regular' }));
  cust = await createParty(db.web, owner, { kind: 'customer', name: 'Distributor', stateCode: '27' });
  plain = await createParty(db.web, owner, { kind: 'customer', name: 'Walk-in', stateCode: '27' });
  otherCust = await createParty(db.web, other, { kind: 'customer', name: 'Theirs', stateCode: '29' });
  bolt = await item(owner, 'Bolt', '100.05');
  nut = await item(owner, 'Nut', '10');
  mrp = await item(owner, 'Packed rice', '118', true);
  otherItem = await item(other, 'Their bolt', '5');
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('the percentage rule', () => {
  it('rounds half up to the paise, at the edges', () => {
    expect(applyMarkup(10005n, -5000)).toBe(5003n);            // 50.025 -> 50.03, exactly half goes up
    expect(applyMarkup(10001n, -5000)).toBe(5001n);            // 50.005 -> 50.01
    expect(applyMarkup(10000n, 1000)).toBe(11000n);            // exact, nothing to round
    expect(applyMarkup(3n, 1666)).toBe(3n);                    // 3.4998 -> 3
    expect(applyMarkup(3n, 1667)).toBe(4n);                    // 3.5001 -> 4
    expect(applyMarkup(1n, -5000)).toBe(1n);                   // 0.5 paise rounds up, not to zero
    expect(applyMarkup(0n, 5000)).toBe(0n);
    expect(applyMarkup(12345n, -10000)).toBe(0n);              // 100% off is free, never negative
    expect(applyMarkup(9_999_999_999_999n, 1_000_000)).toBe(1_009_999_999_999_899n); // +10,000%: 101x, exact in bigint
  });

  it('rounds to the whole rupee when asked, half up', () => {
    expect(applyMarkup(10049n, 0, 'rupee')).toBe(10000n);      // 100.49 -> 100
    expect(applyMarkup(10050n, 0, 'rupee')).toBe(10100n);      // 100.50 -> 101
    expect(applyMarkup(10005n, -5000, 'rupee')).toBe(5000n);   // 50.025 -> 50
    expect(applyMarkup(10099n, 1000, 'rupee')).toBe(11100n);   // 111.089 -> 111
  });
});

describe('resolving a price', () => {
  it('uses the item price when the customer has no list, or there is no customer', async () => {
    expect(await price(bolt, plain)).toEqual({ pricePaise: '10005', priceIncludesTax: false, source: 'item', priceListId: null });
    expect(await price(bolt, null)).toMatchObject({ pricePaise: '10005', source: 'item' });
    expect(await price(mrp, plain)).toMatchObject({ pricePaise: '11800', priceIncludesTax: true, source: 'item' });
  });

  it('uses a fixed entry, and falls back to the item price for an item the list does not name', async () => {
    const list = await createPriceList(db.web, owner, { name: 'Wholesale', kind: 'fixed' });
    await setPriceListEntry(db.web, owner, list, { itemId: bolt, price: '90' });
    await assignPriceList(db.web, owner, cust, list);
    expect(await price(bolt)).toEqual({ pricePaise: '9000', priceIncludesTax: false, source: 'list', priceListId: list });
    expect(await price(nut)).toEqual({ pricePaise: '1000', priceIncludesTax: false, source: 'item', priceListId: null });
    expect(await price(bolt, plain)).toMatchObject({ pricePaise: '10005', source: 'item' });   // another customer is unaffected
    await setPriceListEntry(db.web, owner, list, { itemId: bolt, price: '85.50' });             // setting again replaces
    expect((await price(bolt)).pricePaise).toBe('8550');
    expect((await db.owner`select count(*)::int as n from price_list_item where price_list_id = ${list}`)[0]!.n).toBe(1);
  });

  it('inherits the item inclusive flag unless the entry states its own', async () => {
    const list = await createPriceList(db.web, owner, { name: 'Retail MRP', kind: 'fixed' });
    await assignPriceList(db.web, owner, cust, list);
    await setPriceListEntry(db.web, owner, list, { itemId: mrp, price: '110' });                        // inherits: inclusive
    await setPriceListEntry(db.web, owner, list, { itemId: nut, price: '9', priceIncludesTax: true });  // states its own over an exclusive item
    await setPriceListEntry(db.web, owner, list, { itemId: bolt, price: '95', priceIncludesTax: false });
    expect(await price(mrp)).toMatchObject({ pricePaise: '11000', priceIncludesTax: true });
    expect(await price(nut)).toMatchObject({ pricePaise: '900', priceIncludesTax: true });
    await setPriceListEntry(db.web, owner, list, { itemId: mrp, price: '100', priceIncludesTax: false }); // an inclusive item, exclusive on the list
    expect(await price(mrp)).toMatchObject({ pricePaise: '10000', priceIncludesTax: false });
    expect(await price(bolt)).toMatchObject({ pricePaise: '9500', priceIncludesTax: false });
  });

  it('marks every item up or down on a percentage list, keeps the item flag, and lets an entry win', async () => {
    const down = await createPriceList(db.web, owner, { name: 'Distributor 50% off', kind: 'percentage', markupBp: -5000 });
    await assignPriceList(db.web, owner, cust, down);
    expect(await price(bolt)).toMatchObject({ pricePaise: '5003', source: 'list', priceIncludesTax: false });   // 100.05 -> 50.025 -> 50.03
    expect(await price(mrp)).toMatchObject({ pricePaise: '5900', priceIncludesTax: true });                     // the item's flag carries over
    await setPriceListEntry(db.web, owner, down, { itemId: nut, price: '9.99' });
    expect(await price(nut)).toMatchObject({ pricePaise: '999', source: 'list' });
    await updatePriceList(db.web, owner, down, { name: 'Distributor 50% off', kind: 'percentage', markupBp: -5000, rounding: 'rupee' });
    expect(await price(bolt)).toMatchObject({ pricePaise: '5000' });                                            // 50.025 -> 50
    await updatePriceList(db.web, owner, down, { name: 'Distributor 12.5% up', kind: 'percentage', markupBp: 1250 });
    expect(await price(bolt)).toMatchObject({ pricePaise: '11256' });                                           // 112.55625 -> 112.56
  });

  it('falls back to item prices once the list is archived, and the customer still works', async () => {
    const list = await createPriceList(db.web, owner, { name: 'Seasonal', kind: 'fixed' });
    await setPriceListEntry(db.web, owner, list, { itemId: bolt, price: '1' });
    await assignPriceList(db.web, owner, cust, list);
    expect((await price(bolt)).source).toBe('list');
    await archivePriceList(db.web, owner, list);
    expect(await price(bolt)).toMatchObject({ pricePaise: '10005', source: 'item' });
    expect((await getParty(db.web, owner, cust))!.price_list_id).toBe(list);          // the pointer is left alone; the lookup ignores it
    expect((await listPriceLists(db.web, owner)).some((l) => l.id === list)).toBe(false);
    expect((await fails(assignPriceList(db.web, owner, plain, list))).message).toMatch(/Price list not found/);
    expect((await fails(setPriceListEntry(db.web, owner, list, { itemId: nut, price: '2' }))).message).toMatch(/Price list not found/);
    await assignPriceList(db.web, owner, cust, null);                                // and it can be cleared
    expect((await getParty(db.web, owner, cust))!.price_list_id).toBeNull();
  });
});

describe('issued documents', () => {
  it('keep the rate copied at entry when the list changes or is archived later', async () => {
    const list = await createPriceList(db.web, owner, { name: 'Contract', kind: 'fixed' });
    await setPriceListEntry(db.web, owner, list, { itemId: bolt, price: '80' });
    await assignPriceList(db.web, owner, cust, list);
    const quoted = await price(bolt);
    expect(quoted.pricePaise).toBe('8000');
    const d = await saveDraft(db.web, owner, {
      docType: 'tax_invoice', partyId: cust, docDate: '2026-05-10', dueDate: '2026-05-20',
      lines: [{ name: 'Bolt', itemId: bolt, hsnSac: '7318', quantity: '10', rate: '80', taxRateBp: 1800, taxInclusive: quoted.priceIncludesTax }],
    });
    const id = (await issueDocument(db.web, owner, d.id)).document.id as string;
    const snapshot = async () => JSON.stringify([
      (await db.owner`select * from document_line where document_id = ${id} order by position`),
      (await db.owner`select taxable_paise, cgst_paise, sgst_paise, igst_paise, grand_total_paise, status from document where id = ${id}`),
    ]);
    const before = await snapshot();
    expect((await getDocument(db.web, owner, id))!.document.grand_total_paise).toBe('94400');   // 800 + 18%

    await setPriceListEntry(db.web, owner, list, { itemId: bolt, price: '120' });
    await removePriceListEntry(db.web, owner, list, bolt);
    await updatePriceList(db.web, owner, list, { name: 'Contract', kind: 'percentage', markupBp: 5000 });
    await archivePriceList(db.web, owner, list);
    await assignPriceList(db.web, owner, cust, null);
    expect(await snapshot()).toBe(before);
    expect((await getDocument(db.web, owner, id))!.document.grand_total_paise).toBe('94400');
  });
});

describe('who can see and use a list', () => {
  it('keeps lists, entries and assignments inside the business', async () => {
    const theirs = await createPriceList(db.web, other, { name: 'Wholesale', kind: 'fixed' });   // the same name in another business is fine
    await setPriceListEntry(db.web, other, theirs, { itemId: otherItem, price: '4' });
    expect((await fails(assignPriceList(db.web, owner, cust, theirs))).message).toMatch(/Price list not found/);
    expect((await fails(assignPriceList(db.web, other, cust, theirs))).message).toMatch(/Customer not found/);
    expect((await fails(setPriceListEntry(db.web, owner, theirs, { itemId: bolt, price: '1' }))).message).toMatch(/Price list not found/);
    expect((await fails(setPriceListEntry(db.web, other, theirs, { itemId: bolt, price: '1' }))).message).toMatch(/Item not found/);
    expect((await fails(resolveItemPrice(db.web, owner, { itemId: otherItem, partyId: cust }))).message).toMatch(/Item not found/);
    expect((await listPriceLists(db.web, owner)).some((l) => l.id === theirs)).toBe(false);
    // Even straight past the application, the database refuses a list from another business.
    const e = await fails(db.owner`update party set price_list_id = ${theirs} where id = ${cust}`);
    expect(e.message).toMatch(/violates foreign key/);
    const e2 = await fails(db.owner`insert into price_list_item (business_id, price_list_id, item_id, price_paise) values (${other.businessId}, ${theirs}, ${bolt}, 1)`);
    expect(e2.message).toMatch(/violates foreign key/);
  });

  it('lets an accountant read and resolve, but not change', async () => {
    expect((await listPriceLists(db.web, accountant)).length).toBeGreaterThan(0);
    expect(await resolveItemPrice(db.web, accountant, { itemId: nut, partyId: cust })).toMatchObject({ pricePaise: '1000' });
    await fails(createPriceList(db.web, accountant, { name: 'Nope', kind: 'fixed' }));
    await fails(assignPriceList(db.web, accountant, cust, null));
  });

  it('refuses a second live list with the same name, in any case', async () => {
    await createPriceList(db.web, owner, { name: 'Gold', kind: 'fixed' });
    expect((await fails(createPriceList(db.web, owner, { name: 'gold', kind: 'fixed' }))).message).toMatch(/already has that name/);
  });
});

describe('validation', () => {
  it('explains what is wrong with a price list', () => {
    expect(() => validatePriceList({ name: '  ', kind: 'fixed' })).toThrow(/Price list name is required/);
    expect(() => validatePriceList({ name: 'x'.repeat(101), kind: 'fixed' })).toThrow(/too long/);
    expect(() => validatePriceList({ name: 'A', kind: 'weird' as never })).toThrow(/fixed or a percentage/);
    expect(() => validatePriceList({ name: 'A', kind: 'percentage' })).toThrow(/Enter the markup or discount/);
    expect(() => validatePriceList({ name: 'A', kind: 'percentage', markupBp: 12.5 })).toThrow(/Enter the markup or discount/);
    expect(() => validatePriceList({ name: 'A', kind: 'percentage', markupBp: -10001 })).toThrow(/more than 100%/);
    expect(() => validatePriceList({ name: 'A', kind: 'percentage', markupBp: 1_000_001 })).toThrow(/more than 10,000%/);
    expect(() => validatePriceList({ name: 'A', kind: 'fixed', markupBp: 500 })).toThrow(/fixed price list has no percentage/);
    expect(() => validatePriceList({ name: 'A', kind: 'percentage', markupBp: 0, rounding: 'crore' as never })).toThrow(/rounding/);
    expect(validatePriceList({ name: ' A ', kind: 'percentage', markupBp: -10000 })).toEqual({ name: 'A', kind: 'percentage', markupBp: -10000, rounding: 'paise' });
    try { validatePriceList({ name: 'A', kind: 'percentage' }); } catch (e) { expect((e as { field?: string }).field).toBe('markupBp'); }
  });

  it('explains what is wrong with an entry', () => {
    expect(() => validatePriceListEntry({ itemId: '', price: '5' })).toThrow(/Choose an item/);
    expect(() => validatePriceListEntry({ itemId: 'x', price: 'abc' })).toThrow(/Enter the price in rupees/);
    expect(() => validatePriceListEntry({ itemId: 'x', price: '-5' })).toThrow(/Enter the price in rupees/);
    expect(() => validatePriceListEntry({ itemId: 'x', price: '1.234' })).toThrow(/Enter the price in rupees/);
    expect(validatePriceListEntry({ itemId: 'x', price: '1,250.5' })).toEqual({ itemId: 'x', price: '125050', inclusive: null });
  });

  it('refuses to resolve nothing', async () => {
    expect((await fails(resolveItemPrice(db.web, owner, { itemId: '' }))).message).toMatch(/Choose an item/);
  });
});
