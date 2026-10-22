import type { Sql } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { dateRange, type Column } from './registers.js';
import { payablesAgeing } from './purchases.js';

const SALE_TYPES = ['tax_invoice', 'bill_of_supply', 'credit_note', 'debit_note'];

// ---------------------------------------------------------------- sales by item
export const ITEM_COLUMNS: Column<any>[] = [
  { key: 'item', label: 'Item' }, { key: 'hsn_sac', label: 'HSN or SAC' }, { key: 'quantity', label: 'Quantity' }, { key: 'documents', label: 'Documents' },
  { key: 'taxable', label: 'Taxable value', money: true }, { key: 'tax', label: 'Tax', money: true }, { key: 'total', label: 'Total', money: true },
];

/** Net sales by item for the period: credit notes take away what they credit. Lines are grouped by the name printed on the document. */
export async function salesByItem(sql: Sql, t: TenantSession, f: { from?: string; to?: string } = {}) {
  return inTenant(sql, t, 'report.read', async (tx) => {
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const { from, to } = dateRange(f, b!.timezone as string);
    const rows = await tx`
      select l.item_name as item, coalesce(max(l.hsn_sac), '') as hsn_sac,
             sum(case when d.doc_type = 'credit_note' then -l.quantity else l.quantity end)::text as quantity, count(distinct d.id)::int as documents,
             sum(case when d.doc_type = 'credit_note' then -l.taxable_paise else l.taxable_paise end)::text as taxable,
             sum(case when d.doc_type = 'credit_note' then -(l.cgst_paise + l.sgst_paise + l.igst_paise + l.cess_paise) else (l.cgst_paise + l.sgst_paise + l.igst_paise + l.cess_paise) end)::text as tax,
             sum(case when d.doc_type = 'credit_note' then -l.line_total_paise else l.line_total_paise end)::text as total
        from document_line l join document d on d.id = l.document_id
       where d.status = 'issued' and d.doc_type = any(${SALE_TYPES}) and d.doc_date between ${from}::date and ${to}::date
       group by l.item_name order by sum(case when d.doc_type = 'credit_note' then -l.taxable_paise else l.taxable_paise end) desc, l.item_name`;
    const total = rows.reduce((n, r) => n + BigInt(r.taxable as string), 0n).toString();
    return { from, to, rows, totals: { taxable: total } };
  });
}

// ---------------------------------------------------------------- sales by month
export const MONTH_COLUMNS: Column<any>[] = [
  { key: 'month', label: 'Month' }, { key: 'documents', label: 'Documents' }, { key: 'taxable', label: 'Taxable value', money: true },
  { key: 'tax', label: 'Tax', money: true }, { key: 'total', label: 'Total', money: true },
];

export async function salesByMonth(sql: Sql, t: TenantSession, f: { from?: string; to?: string } = {}) {
  return inTenant(sql, t, 'report.read', async (tx) => {
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const { from, to } = dateRange(f, b!.timezone as string);
    const rows = await tx`
      select to_char(d.doc_date, 'YYYY-MM') as month, count(*)::int as documents,
             sum(case when d.doc_type = 'credit_note' then -d.taxable_paise else d.taxable_paise end)::text as taxable,
             sum(case when d.doc_type = 'credit_note' then -(d.cgst_paise + d.sgst_paise + d.igst_paise + d.cess_paise) else (d.cgst_paise + d.sgst_paise + d.igst_paise + d.cess_paise) end)::text as tax,
             sum(case when d.doc_type = 'credit_note' then -d.grand_total_paise else d.grand_total_paise end)::text as total
        from document d
       where d.status = 'issued' and d.doc_type = any(${SALE_TYPES}) and d.doc_date between ${from}::date and ${to}::date
       group by 1 order by 1`;
    const sum = (k: string) => rows.reduce((n, r) => n + BigInt(r[k] as string), 0n).toString();
    return { from, to, rows, totals: { taxable: sum('taxable'), tax: sum('tax'), total: sum('total'), documents: rows.reduce((n, r) => n + (r.documents as number), 0) } };
  });
}

// ---------------------------------------------------------------- profit and loss
export const PNL_COLUMNS: Column<any>[] = [{ key: 'line', label: 'Line' }, { key: 'amount', label: 'Amount', money: true }];

/**
 * A simple profit and loss on what was billed and bought, not on cash: sales (net of credit notes, before GST), the cost of purchase bills
 * (before GST), and expenses (as paid). Input credit is kept out of the cost. It is a quick guide for the owner, not a set of accounts.
 */
export async function profitAndLoss(sql: Sql, t: TenantSession, f: { from?: string; to?: string } = {}) {
  return inTenant(sql, t, 'report.read', async (tx) => {
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const { from, to } = dateRange(f, b!.timezone as string);
    const [s] = await tx`select coalesce(sum(case when doc_type = 'credit_note' then -taxable_paise else taxable_paise end), 0)::text as v from document
                          where status = 'issued' and doc_type = any(${SALE_TYPES}) and doc_date between ${from}::date and ${to}::date`;
    const [p] = await tx`select coalesce(sum(taxable_paise), 0)::text as v from purchase_bill where status = 'recorded' and bill_date between ${from}::date and ${to}::date`;
    const ex = await tx`select category, sum(amount_paise)::text as v from expense where expense_date between ${from}::date and ${to}::date group by category order by sum(amount_paise) desc`;
    const sales = BigInt(s!.v as string), purchases = BigInt(p!.v as string);
    const expenses = ex.reduce((n, r) => n + BigInt(r.v as string), 0n);
    const gross = sales - purchases, net = gross - expenses;
    const rows: { line: string; amount: string; kind: 'income' | 'cost' | 'expense' | 'result'; indent?: boolean }[] = [
      { line: 'Sales (net of credit notes, before GST)', amount: sales.toString(), kind: 'income' },
      { line: 'Purchases (before GST)', amount: purchases.toString(), kind: 'cost' },
      { line: 'Gross profit', amount: gross.toString(), kind: 'result' },
      ...ex.map((r) => ({ line: String(r.category), amount: String(r.v), kind: 'expense' as const, indent: true })),
      { line: 'Expenses', amount: expenses.toString(), kind: 'cost' },
      { line: 'Net profit', amount: net.toString(), kind: 'result' },
    ];
    return { from, to, rows, grossPaise: gross.toString(), netPaise: net.toString() };
  });
}

// ---------------------------------------------------------------- payables ageing, flat
export const PAYABLE_COLUMNS: Column<any>[] = [
  { key: 'vendor', label: 'Vendor' }, { key: 'bill_number', label: 'Bill' }, { key: 'bill_date', label: 'Bill date' }, { key: 'due_date', label: 'Due date' },
  { key: 'days_late', label: 'Days late' }, { key: 'due_paise', label: 'Owed', money: true },
];

export async function payablesRows(sql: Sql, t: TenantSession) {
  const a = await payablesAgeing(sql, t);
  return { asOf: a.today, rows: a.rows.map((r) => ({ vendor: r.vendor as string, bill_number: r.bill_number as string, bill_date: r.bill_date as string, due_date: r.due_date as string, days_late: Math.max(0, r.days_late as number), due_paise: r.due_paise as string })), totals: a.totals, outstanding: a.outstanding };
}

// ---------------------------------------------------------------- Excel for any report
import { tableToXlsx } from './xlsxwrite.js';

/** The same columns a CSV takes, as an Excel workbook. Rupee columns are real numbers, so Excel can add them up. */
export function reportToXlsx(columns: Column<any>[], rows: Record<string, any>[], sheetName = 'Report'): Buffer {
  return tableToXlsx(columns.map((c) => c.label), rows.map((r) => columns.map((c) => {
    const v = r[c.key];
    if (v === null || v === undefined || v === '') return null;
    return c.money ? Number(BigInt(String(v))) / 100 : typeof v === 'number' ? v : String(v);
  })), sheetName);
}
