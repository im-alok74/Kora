import { parseQuantity, parseRupees } from '@kora/tax';
import type { Sql } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { str, ValidationError } from './validation.js';

export interface ItemInput {
  name: string;
  kind?: 'goods' | 'service';
  hsnSac?: string | null;
  unit?: string;
  defaultRateBp: number;
  cessRateBp?: number;
  price?: string; // rupees
  /** The price already includes GST, as an MRP does. */
  priceIncludesTax?: boolean;
  trackStock?: boolean;
  barcode?: string | null;
  /** Quantity at or below which the item shows as low, for example "5". */
  reorderLevel?: string | null;
  /** Show in the Kora network catalogue (only matters if the business is listed). */
  networkListed?: boolean;
}

export function validateItem(i: ItemInput) {
  const name = str(i.name, 'Item name', { required: true })!;
  const kind = i.kind ?? 'goods';
  if (!['goods', 'service'].includes(kind)) throw new ValidationError('Choose goods or service.', 'kind');
  const hsn = str(i.hsnSac, 'HSN or SAC', { max: 8 });
  if (hsn && !/^[0-9]{4,8}$/.test(hsn)) throw new ValidationError('HSN or SAC is 4 to 8 digits.', 'hsnSac');
  const unit = str(i.unit, 'Unit', { max: 10 }) ?? 'NOS';
  if (!Number.isInteger(i.defaultRateBp) || i.defaultRateBp < 0) throw new ValidationError('Choose a tax rate.', 'defaultRateBp');
  const cess = i.cessRateBp ?? 0;
  if (!Number.isInteger(cess) || cess < 0) throw new ValidationError('Cess rate is not valid.', 'cessRateBp');
  let price = 0n;
  try { price = i.price ? parseRupees(i.price) : 0n; } catch { throw new ValidationError('Enter the price in rupees.', 'price'); }
  const barcode = str(i.barcode, 'Barcode', { max: 60 });
  let reorder: string | null = null;
  if (i.reorderLevel !== undefined && i.reorderLevel !== null && String(i.reorderLevel).trim() !== '') {
    try { reorder = /^0(\.0{1,3})?$/.test(String(i.reorderLevel).trim()) ? '0' : parseQuantity(String(i.reorderLevel)).toString(); } catch { throw new ValidationError('Enter the reorder level as a number.', 'reorderLevel'); }
  }
  if (i.trackStock && kind === 'service') throw new ValidationError('Services have no stock. Choose goods to track stock.', 'trackStock');
  return { name, kind, hsn, unit, rate: i.defaultRateBp, cess, price: price.toString(), inclusive: !!i.priceIncludesTax, track: !!i.trackStock, barcode, reorder, network: !!i.networkListed };
}

export async function createItem(sql: Sql, t: TenantSession, input: ItemInput): Promise<string> {
  const c = validateItem(input);
  return inTenant(sql, t, 'item.write', async (tx) => {
    try {
      const [r] = await tx`insert into item (business_id, name, kind, hsn_sac, unit, default_rate_bp, cess_rate_bp, price_paise, price_includes_tax, track_stock, barcode, reorder_level_milli, network_listed)
                           values (${t.businessId}, ${c.name}, ${c.kind}, ${c.hsn}, ${c.unit}, ${c.rate}, ${c.cess}, ${c.price}, ${c.inclusive}, ${c.track}, ${c.barcode}, ${c.reorder}, ${c.network}) returning id`;
      return r!.id as string;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === '23503') throw new ValidationError('That tax rate is not in the allowed list.', 'defaultRateBp');
      if (code === '23505') throw new ValidationError('Another item already has that barcode.', 'barcode');
      throw e;
    }
  });
}

export async function updateItem(sql: Sql, t: TenantSession, id: string, input: ItemInput): Promise<void> {
  const c = validateItem(input);
  await inTenant(sql, t, 'item.write', async (tx) => {
    try {
      const r = await tx`update item set name = ${c.name}, kind = ${c.kind}, hsn_sac = ${c.hsn}, unit = ${c.unit},
                                default_rate_bp = ${c.rate}, cess_rate_bp = ${c.cess}, price_paise = ${c.price},
                                price_includes_tax = ${c.inclusive}, track_stock = ${c.track}, barcode = ${c.barcode}, reorder_level_milli = ${c.reorder}, network_listed = ${c.network}
                          where id = ${id} returning id`;
      if (r.length === 0) throw new ValidationError('Item not found.');
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ValidationError('Another item already has that barcode.', 'barcode');
      throw e;
    }
  });
}

export async function listItems(sql: Sql, t: TenantSession, f: { q?: string; limit?: number; offset?: number } = {}) {
  return inTenant(sql, t, 'item.read', (tx) => tx`
    select i.id, i.name, i.kind, i.hsn_sac, i.unit, i.default_rate_bp, i.cess_rate_bp, i.price_paise, i.price_includes_tax, i.track_stock, i.barcode,
           i.network_listed, i.reorder_level_milli::text as reorder_milli, s.qty_milli::text as qty_milli
      from item i left join item_stock s on s.item_id = i.id
     where i.archived_at is null and (${f.q ?? null}::text is null or i.name ilike ${'%' + (f.q ?? '') + '%'} or i.barcode = ${f.q ?? ''})
     order by i.name limit ${Math.min(f.limit ?? 100, 500)} offset ${f.offset ?? 0}`);
}

export async function archiveItem(sql: Sql, t: TenantSession, id: string): Promise<void> {
  await inTenant(sql, t, 'item.write', (tx) => tx`update item set archived_at = now() where id = ${id}`);
}
