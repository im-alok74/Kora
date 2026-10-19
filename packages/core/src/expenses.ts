import { parseRupees } from '@kora/tax';
import type { Sql } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { isDate, str, todayIn, ValidationError } from './validation.js';
import type { Column } from './registers.js';
import { randomUUID } from 'node:crypto';
import { getBlobStore } from './blobs.js';

/** Suggested categories. A business can type its own: the category is free text. */
export const EXPENSE_CATEGORIES = [
  'Rent', 'Salaries', 'Utilities', 'Travel', 'Office supplies', 'Software and subscriptions', 'Professional fees', 'Marketing',
  'Repairs and maintenance', 'Bank charges', 'Purchases for resale', 'Other',
] as const;
export const PAID_VIA = ['cash', 'upi', 'bank_transfer', 'card', 'cheque', 'other'] as const;
export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export const RECEIPT_MAX_BYTES = 2 * 1024 * 1024;

export interface ExpenseIn {
  date?: string;
  vendor?: string | null;
  category: string;
  amount: string;          // rupees, tax included
  gst?: string | null;     // rupees, the GST inside the amount
  paidVia?: string;
  notes?: string | null;
}

async function clean(tx: import('@kora/db').Tx, t: TenantSession, i: ExpenseIn) {
  const [b] = await tx`select timezone from business where id = ${t.businessId}`;
  const date = i.date || todayIn(b!.timezone as string);
  if (!isDate(date)) throw new ValidationError('Enter the date as YYYY-MM-DD.', 'date');
  const category = str(i.category, 'Category', { required: true, max: 60 })!;
  let amount: bigint, gst = 0n;
  try { amount = parseRupees(String(i.amount ?? '')); } catch { throw new ValidationError('Enter the amount in rupees.', 'amount'); }
  if (amount <= 0n) throw new ValidationError('The amount must be more than zero.', 'amount');
  if (i.gst) { try { gst = parseRupees(String(i.gst)); } catch { throw new ValidationError('Enter the GST in rupees.', 'gst'); } }
  if (gst < 0n) throw new ValidationError('The GST cannot be negative.', 'gst');
  if (gst > amount) throw new ValidationError('The GST is more than the amount paid. The amount includes the GST.', 'gst');
  const paidVia = i.paidVia ?? 'cash';
  if (!(PAID_VIA as readonly string[]).includes(paidVia)) throw new ValidationError('Choose how it was paid.', 'paidVia');
  return { date, category, amount: amount.toString(), gst: gst.toString(), paidVia, vendor: str(i.vendor, 'Vendor', { max: 120 }), notes: str(i.notes, 'Notes', { max: 1000 }) };
}

export async function saveExpense(sql: Sql, t: TenantSession, input: ExpenseIn, id: string | null = null): Promise<{ id: string }> {
  return inTenant(sql, t, 'expense.write', async (tx) => {
    const c = await clean(tx, t, input);
    if (id) {
      const r = await tx`update expense set expense_date = ${c.date}, vendor = ${c.vendor}, category = ${c.category}, amount_paise = ${c.amount},
                                gst_paise = ${c.gst}, paid_via = ${c.paidVia}, notes = ${c.notes} where id = ${id} returning id`;
      if (r.length === 0) throw new ValidationError('Expense not found.');
      return { id };
    }
    const [r] = await tx`insert into expense (business_id, expense_date, vendor, category, amount_paise, gst_paise, paid_via, notes, created_by)
                         values (${t.businessId}, ${c.date}, ${c.vendor}, ${c.category}, ${c.amount}, ${c.gst}, ${c.paidVia}, ${c.notes}, ${t.userId}) returning id`;
    return { id: r!.id as string };
  });
}

export async function deleteExpense(sql: Sql, t: TenantSession, id: string): Promise<void> {
  await inTenant(sql, t, 'expense.write', async (tx) => {
    const r = await tx`delete from expense where id = ${id} returning id`;
    if (r.length === 0) throw new ValidationError('Expense not found.');
  });
}

export async function getExpense(sql: Sql, t: TenantSession, id: string) {
  const rows = await inTenant(sql, t, 'expense.read', (tx) => tx`
    select e.id, e.expense_date::text as expense_date, e.vendor, e.category, e.amount_paise, e.gst_paise, e.paid_via, e.notes,
           r.file_name as receipt_name, r.content_type as receipt_type
      from expense e left join expense_receipt r on r.expense_id = e.id where e.id = ${id}`);
  return rows[0] ?? null;
}

export async function listExpenses(sql: Sql, t: TenantSession, f: { from?: string; to?: string; category?: string; q?: string; limit?: number } = {}) {
  return inTenant(sql, t, 'expense.read', async (tx) => {
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const today = todayIn(b!.timezone as string);
    const from = f.from || `${today.slice(0, 7)}-01`;
    const to = f.to || today;
    if (!isDate(from) || !isDate(to)) throw new ValidationError('Enter dates as YYYY-MM-DD.', 'from');
    if (from > to) throw new ValidationError('The start date is after the end date.', 'from');
    const like = f.q ? `%${f.q}%` : null;
    const rows = await tx`
      select e.id, e.expense_date::text as expense_date, e.vendor, e.category, e.amount_paise, e.gst_paise, e.paid_via, e.notes,
             (r.expense_id is not null) as has_receipt
        from expense e left join expense_receipt r on r.expense_id = e.id
       where e.expense_date between ${from}::date and ${to}::date
         and (${f.category ?? null}::text is null or e.category = ${f.category ?? ''})
         and (${like}::text is null or e.vendor ilike ${like ?? ''} or e.notes ilike ${like ?? ''})
       order by e.expense_date desc, e.created_at desc limit ${Math.min(f.limit ?? 500, 1000)}`;
    let total = 0n, gst = 0n;
    const byCategory = new Map<string, bigint>();
    for (const r of rows) {
      total += BigInt(r.amount_paise as string); gst += BigInt(r.gst_paise as string);
      byCategory.set(r.category as string, (byCategory.get(r.category as string) ?? 0n) + BigInt(r.amount_paise as string));
    }
    return {
      from, to, rows, total: total.toString(), gst: gst.toString(),
      byCategory: [...byCategory.entries()].sort((a, c) => (c[1] > a[1] ? 1 : -1)).map(([category, amt]) => ({ category, total: amt.toString() })),
    };
  });
}

export const EXPENSE_COLUMNS: Column<any>[] = [
  { key: 'expense_date', label: 'Date' }, { key: 'vendor', label: 'Vendor' }, { key: 'category', label: 'Category' },
  { key: 'amount_paise', label: 'Amount paid', money: true }, { key: 'gst_paise', label: 'GST included', money: true },
  { key: 'paid_via', label: 'Paid by' }, { key: 'notes', label: 'Notes' },
];

export async function setReceipt(sql: Sql, t: TenantSession, id: string, file: { name: string; type: string; dataBase64: string }) {
  if (!(RECEIPT_TYPES as readonly string[]).includes(file.type)) throw new ValidationError('A receipt can be a JPEG or PNG photo, or a PDF.', 'type');
  const name = str(file.name, 'File name', { required: true, max: 120 })!.replace(/[^\w.\- ]+/g, '_');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(file.dataBase64)) throw new ValidationError('The file could not be read.', 'data');
  const data = Buffer.from(file.dataBase64, 'base64');
  if (data.length === 0) throw new ValidationError('The file is empty.', 'data');
  if (data.length > RECEIPT_MAX_BYTES) throw new ValidationError('The receipt is larger than 2 MB. Use a smaller photo.', 'data');
  // The first bytes must match what the file claims to be, so a renamed file cannot be stored as a picture or PDF.
  const magic = file.type === 'application/pdf' ? data.subarray(0, 4).toString('latin1') === '%PDF'
    : file.type === 'image/png' ? data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    : data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (!magic) throw new ValidationError('The file does not look like a real receipt of that type.', 'data');
  const store = getBlobStore();
  const key = store ? `${t.businessId}/receipts/${id}-${randomUUID()}` : null;
  if (store && key) await store.put(key, data, file.type);
  let previous: string | null = null;
  try {
    await inTenant(sql, t, 'expense.write', async (tx) => {
      const [e] = await tx`select id from expense where id = ${id}`;
      if (!e) throw new ValidationError('Expense not found.');
      const [old] = await tx`select storage_key from expense_receipt where expense_id = ${id}`;
      previous = (old?.storage_key as string | null) ?? null;
      await tx`insert into expense_receipt (expense_id, business_id, file_name, content_type, data, storage_key) values (${id}, ${t.businessId}, ${name}, ${file.type}, ${key ? null : data}, ${key})
               on conflict (expense_id) do update set file_name = excluded.file_name, content_type = excluded.content_type, data = excluded.data, storage_key = excluded.storage_key`;
    });
  } catch (e) {
    if (store && key) await store.delete(key).catch(() => {});
    throw e;
  }
  if (store && previous) await store.delete(previous).catch(() => {});
}

export async function getReceipt(sql: Sql, t: TenantSession, id: string) {
  const rows = await inTenant(sql, t, 'expense.read', (tx) => tx`select file_name, content_type, data, storage_key from expense_receipt where expense_id = ${id}`);
  const r = rows[0];
  if (!r) return null;
  let data = r.data as Buffer | null;
  if (!data && r.storage_key) {
    const store = getBlobStore();
    if (!store) throw new Error('This file is in object storage, which is not configured here.');
    data = await store.get(r.storage_key as string);
    if (!data) return null;
  }
  return { name: r.file_name as string, type: r.content_type as string, data: data! };
}

export async function removeReceipt(sql: Sql, t: TenantSession, id: string): Promise<void> {
  const key = await inTenant(sql, t, 'expense.write', async (tx) => {
    const [r] = await tx`delete from expense_receipt where expense_id = ${id} returning storage_key`;
    return (r?.storage_key as string | null) ?? null;
  });
  if (key) await getBlobStore()?.delete(key).catch(() => {});
}
