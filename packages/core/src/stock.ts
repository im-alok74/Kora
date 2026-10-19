import { parseQuantity } from '@kora/tax';
import type { Sql } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { isDate, str, todayIn, ValidationError } from './validation.js';

/**
 * Stock follows documents by itself (the database writes a movement when an invoice is issued or cancelled and when a purchase bill is
 * recorded or cancelled), so these functions only read levels and record what a person did by hand: opening stock, a count, a return.
 */
const milli = (q: bigint) => `${q / 1000n}.${(((q % 1000n) + 1000n) % 1000n).toString().padStart(3, '0')}`.replace(/\.?0+$/, '') || '0';
export const formatQuantity = (milliUnits: string | bigint) => { const n = BigInt(milliUnits); return n < 0n ? `-${milli(-n)}` : milli(n); };

export async function stockLevels(sql: Sql, t: TenantSession, f: { q?: string; lowOnly?: boolean } = {}) {
  const like = f.q ? `%${f.q.replace(/[%_\\]/g, '\\$&')}%` : null;
  return inTenant(sql, t, 'item.read', (tx) => tx`
    select i.id, i.name, i.unit, i.hsn_sac, i.barcode, s.qty_milli::text as qty_milli, i.reorder_level_milli::text as reorder_milli,
           (i.reorder_level_milli is not null and s.qty_milli <= i.reorder_level_milli) as low, (s.qty_milli <= 0) as out
      from item i join item_stock s on s.item_id = i.id
     where i.archived_at is null and (${like}::text is null or i.name ilike ${like} or i.barcode ilike ${like})
       and (not ${!!f.lowOnly} or (i.reorder_level_milli is not null and s.qty_milli <= i.reorder_level_milli))
     order by low desc, out desc, i.name limit 500`);
}

/** Records stock by hand. 'in' adds, 'out' removes, 'count' sets the level to what was counted. */
export async function adjustStock(sql: Sql, t: TenantSession, itemId: string, i: { mode: 'in' | 'out' | 'count'; quantity: string; note?: string | null; date?: string; opening?: boolean }) {
  if (!['in', 'out', 'count'].includes(i.mode)) throw new ValidationError('Choose in, out or count.', 'mode');
  let q: bigint;
  try {
    q = /^0(\.0{1,3})?$/.test(String(i.quantity).trim()) && i.mode === 'count' ? 0n : parseQuantity(String(i.quantity));
  } catch (e) { throw new ValidationError((e as Error).message.replace('Quantity must be greater than zero.', 'Enter a quantity greater than zero.'), 'quantity'); }
  const note = str(i.note, 'Note', { max: 300 });
  if (i.mode !== 'count' && !note && !i.opening) throw new ValidationError('Say why, for example a customer return, damage or a stock count.', 'note');
  return inTenant(sql, t, 'item.write', async (tx) => {
    const [it] = await tx`select i.track_stock, s.qty_milli from item i left join item_stock s on s.item_id = i.id where i.id = ${itemId}`;
    if (!it) throw new ValidationError('Item not found.');
    if (!it.track_stock) throw new ValidationError('Turn on stock tracking for this item first.');
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const date = i.date || todayIn(b!.timezone as string);
    if (!isDate(date)) throw new ValidationError('Enter the date as YYYY-MM-DD.', 'date');
    const current = BigInt(it.qty_milli as string);
    const delta = i.mode === 'in' ? q : i.mode === 'out' ? -q : q - current;
    if (delta === 0n) return { changed: false, qtyMilli: current.toString() };
    const [m] = await tx`insert into stock_movement (business_id, item_id, qty_milli, kind, note, occurred_on, created_by)
                         values (${t.businessId}, ${itemId}, ${delta.toString()}, ${i.opening ? 'opening' : 'adjustment'}, ${note ?? (i.mode === 'count' ? 'Stock count' : null)}, ${date}, ${t.userId}) returning id`;
    return { changed: true, id: m!.id as string, qtyMilli: (current + delta).toString() };
  });
}

export async function stockHistory(sql: Sql, t: TenantSession, itemId: string, limit = 100) {
  return inTenant(sql, t, 'item.read', (tx) => tx`
    select m.id, m.qty_milli::text as qty_milli, m.kind, m.note, m.occurred_on::text as occurred_on, m.created_at,
           d.number as invoice_number, b.bill_number
      from stock_movement m left join document d on d.id = m.document_id left join purchase_bill b on b.id = m.bill_id
     where m.item_id = ${itemId} order by m.created_at desc, m.id limit ${Math.min(500, Math.max(1, limit))}`);
}

/** The item a scanned code belongs to, with what a till needs to add it to a bill. */
export async function findItemByBarcode(sql: Sql, t: TenantSession, code: string) {
  const c = String(code ?? '').trim();
  if (!c || c.length > 60) return null;
  return inTenant(sql, t, 'item.read', async (tx) => {
    const [r] = await tx`select i.id, i.name, i.kind, i.hsn_sac, i.unit, i.default_rate_bp, i.cess_rate_bp, i.price_paise::text as price_paise, i.price_includes_tax, i.barcode, i.track_stock,
                                s.qty_milli::text as qty_milli
                           from item i left join item_stock s on s.item_id = i.id where i.barcode = ${c} and i.archived_at is null`;
    return r ?? null;
  });
}
