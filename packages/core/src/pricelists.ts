import { parseRupees } from '@kora/tax';
import type { Sql } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { str, ValidationError } from './validation.js';

export interface PriceListInput {
  name: string;
  kind: 'fixed' | 'percentage';
  /** Percentage lists only: signed basis points over the item's own price. 1000 is 10% dearer, -500 is 5% cheaper. */
  markupBp?: number | null;
  /** Percentage lists only: round half up to the paise (default) or to the whole rupee. */
  rounding?: 'paise' | 'rupee';
}

export interface PriceListEntryInput {
  itemId: string;
  price: string; // rupees
  /** Null or left out: the entry takes the item's own inclusive-of-GST flag. */
  priceIncludesTax?: boolean | null;
}

export function validatePriceList(i: PriceListInput) {
  const name = str(i.name, 'Price list name', { required: true, max: 100 })!;
  if (!['fixed', 'percentage'].includes(i.kind)) throw new ValidationError('Choose a fixed or a percentage price list.', 'kind');
  const rounding = i.rounding ?? 'paise';
  if (!['paise', 'rupee'].includes(rounding)) throw new ValidationError('Choose rounding to the paise or to the rupee.', 'rounding');
  let markupBp: number | null = null;
  if (i.kind === 'percentage') {
    const m = i.markupBp;
    if (m === undefined || m === null || !Number.isInteger(m)) throw new ValidationError('Enter the markup or discount as a percentage.', 'markupBp');
    if (m < -10000) throw new ValidationError('A discount cannot be more than 100%.', 'markupBp');
    if (m > 1_000_000) throw new ValidationError('A markup cannot be more than 10,000%.', 'markupBp');
    markupBp = m;
  } else if (i.markupBp !== undefined && i.markupBp !== null) {
    throw new ValidationError('A fixed price list has no percentage. Give each item its price instead.', 'markupBp');
  }
  return { name, kind: i.kind, markupBp, rounding };
}

export function validatePriceListEntry(i: PriceListEntryInput) {
  if (!i.itemId) throw new ValidationError('Choose an item.', 'itemId');
  let price: bigint;
  try { price = parseRupees(String(i.price ?? '')); } catch { throw new ValidationError('Enter the price in rupees.', 'price'); }
  const inclusive = i.priceIncludesTax === undefined || i.priceIncludesTax === null ? null : !!i.priceIncludesTax;
  return { itemId: i.itemId, price: price.toString(), inclusive };
}

/**
 * Moves a price by signed basis points, in whole integers. Rounds half up: exactly half a paise (or half a rupee, on
 * rupee rounding) goes up, so 100.05 less 50% is 50.03, not 50.02. Prices are never negative, so half up and
 * half away from zero are the same thing here.
 */
export function applyMarkup(basePaise: bigint, markupBp: number, rounding: 'paise' | 'rupee' = 'paise'): bigint {
  const scaled = basePaise * BigInt(10000 + markupBp); // paise x 10,000
  if (rounding === 'rupee') return ((scaled + 500_000n) / 1_000_000n) * 100n;
  return (scaled + 5_000n) / 10_000n;
}

const dupName = (e: unknown): never => {
  if ((e as { code?: string }).code === '23505') throw new ValidationError('Another price list already has that name.', 'name');
  throw e;
};

export async function createPriceList(sql: Sql, t: TenantSession, input: PriceListInput): Promise<string> {
  const c = validatePriceList(input);
  return inTenant(sql, t, 'item.write', async (tx) => {
    try {
      const [r] = await tx`insert into price_list (business_id, name, kind, markup_bp, rounding) values (${t.businessId}, ${c.name}, ${c.kind}, ${c.markupBp}, ${c.rounding}) returning id`;
      return r!.id as string;
    } catch (e) { return dupName(e); }
  });
}

export async function updatePriceList(sql: Sql, t: TenantSession, id: string, input: PriceListInput): Promise<void> {
  const c = validatePriceList(input);
  await inTenant(sql, t, 'item.write', async (tx) => {
    let r;
    try { r = await tx`update price_list set name = ${c.name}, kind = ${c.kind}, markup_bp = ${c.markupBp}, rounding = ${c.rounding} where id = ${id} and archived_at is null returning id`; }
    catch (e) { return dupName(e); }
    if (r.length === 0) throw new ValidationError('Price list not found.');
  });
}

/** Archives the list. Customers who still point at it simply fall back to item prices. */
export async function archivePriceList(sql: Sql, t: TenantSession, id: string): Promise<void> {
  await inTenant(sql, t, 'item.write', async (tx) => {
    const r = await tx`update price_list set archived_at = now() where id = ${id} and archived_at is null returning id`;
    if (r.length === 0) throw new ValidationError('Price list not found.');
  });
}

export async function listPriceLists(sql: Sql, t: TenantSession) {
  return inTenant(sql, t, 'item.read', (tx) => tx`
    select l.id, l.name, l.kind, l.markup_bp, l.rounding,
           (select count(*)::int from price_list_item e where e.price_list_id = l.id) as entries,
           (select count(*)::int from party p where p.price_list_id = l.id and p.archived_at is null) as customers
      from price_list l where l.archived_at is null order by l.name`);
}

export async function getPriceList(sql: Sql, t: TenantSession, id: string) {
  return inTenant(sql, t, 'item.read', async (tx) => {
    const [list] = await tx`select id, name, kind, markup_bp, rounding from price_list where id = ${id} and archived_at is null`;
    if (!list) return null;
    const entries = await tx`
      select e.id, e.item_id, i.name as item_name, i.unit, i.price_paise as item_price_paise, i.price_includes_tax as item_price_includes_tax,
             e.price_paise, e.price_includes_tax
        from price_list_item e join item i on i.id = e.item_id where e.price_list_id = ${id} order by i.name`;
    return { ...list, entries };
  });
}

/** Sets the price of one item on a list, replacing any earlier entry for that item. */
export async function setPriceListEntry(sql: Sql, t: TenantSession, listId: string, input: PriceListEntryInput): Promise<void> {
  const c = validatePriceListEntry(input);
  await inTenant(sql, t, 'item.write', async (tx) => {
    const [l] = await tx`select id from price_list where id = ${listId} and archived_at is null`;
    if (!l) throw new ValidationError('Price list not found.');
    const [i] = await tx`select id from item where id = ${c.itemId} and archived_at is null`;
    if (!i) throw new ValidationError('Item not found.', 'itemId');
    await tx`insert into price_list_item (business_id, price_list_id, item_id, price_paise, price_includes_tax)
             values (${t.businessId}, ${listId}, ${c.itemId}, ${c.price}, ${c.inclusive})
             on conflict (price_list_id, item_id) do update set price_paise = excluded.price_paise, price_includes_tax = excluded.price_includes_tax`;
  });
}

export async function removePriceListEntry(sql: Sql, t: TenantSession, listId: string, itemId: string): Promise<void> {
  await inTenant(sql, t, 'item.write', async (tx) => {
    const r = await tx`delete from price_list_item where price_list_id = ${listId} and item_id = ${itemId} returning id`;
    if (r.length === 0) throw new ValidationError('That item is not on this price list.');
  });
}

/** Gives a customer a price list, or takes it away with null. */
export async function assignPriceList(sql: Sql, t: TenantSession, partyId: string, priceListId: string | null): Promise<void> {
  await inTenant(sql, t, 'party.write', async (tx) => {
    if (priceListId) {
      const [l] = await tx`select id from price_list where id = ${priceListId} and archived_at is null`;
      if (!l) throw new ValidationError('Price list not found.', 'priceListId');
    }
    const r = await tx`update party set price_list_id = ${priceListId} where id = ${partyId} returning id`;
    if (r.length === 0) throw new ValidationError('Customer not found.');
  });
}

export interface ResolvedPrice {
  pricePaise: string;
  priceIncludesTax: boolean;
  source: 'list' | 'item';
  priceListId: string | null;
}

/**
 * The price to put on a new line for this item and customer. In order: the customer's live list entry for the item;
 * else, on a percentage list, the item's own price moved by the list's markup; else the item's own price.
 * It is a convenience at line entry. Nothing reads it when a document is totalled or issued.
 */
export async function resolveItemPrice(sql: Sql, t: TenantSession, f: { itemId: string; partyId?: string | null }): Promise<ResolvedPrice> {
  if (!f.itemId) throw new ValidationError('Choose an item.', 'itemId');
  return inTenant(sql, t, 'item.read', async (tx) => {
    const [item] = await tx`select price_paise, price_includes_tax from item where id = ${f.itemId}`;
    if (!item) throw new ValidationError('Item not found.', 'itemId');
    const own: ResolvedPrice = { pricePaise: String(item.price_paise), priceIncludesTax: !!item.price_includes_tax, source: 'item', priceListId: null };
    if (!f.partyId) return own;
    const [l] = await tx`
      select l.id, l.kind, l.markup_bp, l.rounding from party p join price_list l on l.id = p.price_list_id and l.business_id = p.business_id
       where p.id = ${f.partyId} and l.archived_at is null`;
    if (!l) return own;
    const listId = l.id as string;
    const [e] = await tx`select price_paise, price_includes_tax from price_list_item where price_list_id = ${listId} and item_id = ${f.itemId}`;
    if (e) return { pricePaise: String(e.price_paise), priceIncludesTax: e.price_includes_tax ?? own.priceIncludesTax, source: 'list', priceListId: listId };
    if (l.kind === 'percentage') {
      return { pricePaise: applyMarkup(BigInt(own.pricePaise), l.markup_bp as number, l.rounding as 'paise' | 'rupee').toString(), priceIncludesTax: own.priceIncludesTax, source: 'list', priceListId: listId };
    }
    return own;
  });
}
