import { parseRupees } from '@kora/tax';
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
}

function clean(i: ItemInput) {
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
  return { name, kind, hsn, unit, rate: i.defaultRateBp, cess, price: price.toString() };
}

export async function createItem(sql: Sql, t: TenantSession, input: ItemInput): Promise<string> {
  const c = clean(input);
  return inTenant(sql, t, 'item.write', async (tx) => {
    try {
      const [r] = await tx`insert into item (business_id, name, kind, hsn_sac, unit, default_rate_bp, cess_rate_bp, price_paise)
                           values (${t.businessId}, ${c.name}, ${c.kind}, ${c.hsn}, ${c.unit}, ${c.rate}, ${c.cess}, ${c.price}) returning id`;
      return r!.id as string;
    } catch (e) {
      if ((e as { code?: string }).code === '23503') throw new ValidationError('That tax rate is not in the allowed list.', 'defaultRateBp');
      throw e;
    }
  });
}

export async function updateItem(sql: Sql, t: TenantSession, id: string, input: ItemInput): Promise<void> {
  const c = clean(input);
  await inTenant(sql, t, 'item.write', async (tx) => {
    const r = await tx`update item set name = ${c.name}, kind = ${c.kind}, hsn_sac = ${c.hsn}, unit = ${c.unit},
                              default_rate_bp = ${c.rate}, cess_rate_bp = ${c.cess}, price_paise = ${c.price}
                        where id = ${id} returning id`;
    if (r.length === 0) throw new ValidationError('Item not found.');
  });
}

export async function listItems(sql: Sql, t: TenantSession, f: { q?: string; limit?: number } = {}) {
  return inTenant(sql, t, 'item.read', (tx) => tx`
    select id, name, kind, hsn_sac, unit, default_rate_bp, cess_rate_bp, price_paise
      from item where archived_at is null and (${f.q ?? null}::text is null or name ilike ${'%' + (f.q ?? '') + '%'})
     order by name limit ${Math.min(f.limit ?? 100, 500)}`);
}

export async function archiveItem(sql: Sql, t: TenantSession, id: string): Promise<void> {
  await inTenant(sql, t, 'item.write', (tx) => tx`update item set archived_at = now() where id = ${id}`);
}
