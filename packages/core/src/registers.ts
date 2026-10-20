import type { Sql } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { isDate, todayIn, ValidationError } from './validation.js';

/** Registers and statements, and the CSV they export to. All amounts are paise as strings until formatted. */
export interface Column<T> { key: keyof T & string; label: string; money?: boolean }

const fmtMoney = (p: string | bigint) => {
  const n = BigInt(p); const neg = n < 0n; const a = neg ? -n : n;
  return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`;
};

/**
 * CSV with the two protections that matter for a file people open in a spreadsheet:
 * quotes and line breaks are escaped, and a cell that starts with = + - @ or a tab is prefixed with a quote so a
 * customer name like "=HYPERLINK(...)" cannot run as a formula. Rupee columns are written as plain numbers.
 */
export function toCsv<T extends Record<string, any>>(columns: Column<T>[], rows: T[]): string {
  const cell = (v: unknown, money?: boolean) => {
    if (v === null || v === undefined) return '';
    let s = money ? fmtMoney(v as string) : String(v);
    if (!money && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => cell(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c.key], c.money)).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';   // BOM so Excel reads UTF-8 names correctly
}

export function dateRange(f: { from?: string; to?: string }, tz: string) {
  const to = f.to ?? todayIn(tz);
  const [y, m] = to.split('-').map(Number) as [number, number];
  const from = f.from ?? `${y}-${String(m).padStart(2, '0')}-01`;
  if (!isDate(from) || !isDate(to)) throw new ValidationError('Enter dates as YYYY-MM-DD.', 'from');
  if (from > to) throw new ValidationError('The start date is after the end date.', 'from');
  return { from, to };
}

export const SALES_COLUMNS: Column<any>[] = [
  { key: 'doc_date', label: 'Date' }, { key: 'number', label: 'Number' }, { key: 'type', label: 'Type' }, { key: 'customer', label: 'Customer' },
  { key: 'gstin', label: 'GSTIN' }, { key: 'taxable', label: 'Taxable value', money: true }, { key: 'cgst', label: 'CGST', money: true },
  { key: 'sgst', label: 'SGST', money: true }, { key: 'igst', label: 'IGST', money: true }, { key: 'cess', label: 'Cess', money: true },
  { key: 'total', label: 'Total', money: true }, { key: 'status', label: 'Status' },
];

const TYPE_LABEL: Record<string, string> = { tax_invoice: 'Tax invoice', bill_of_supply: 'Bill of supply', credit_note: 'Credit note', debit_note: 'Debit note' };

/** Every issued sale document in the range. Credit notes are negative so the totals are net sales. */
export async function salesRegister(sql: Sql, t: TenantSession, f: { from?: string; to?: string } = {}) {
  return inTenant(sql, t, 'report.read', async (tx) => {
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const { from, to } = dateRange(f, b!.timezone as string);
    const rows = await tx`
      select d.doc_date::text as doc_date, d.number, d.doc_type, d.status, coalesce(p.name, 'Walk-in customer') as customer,
             coalesce(d.recipient_snapshot->>'gstin', p.gstin) as gstin,
             (case when d.doc_type = 'credit_note' then -1 else 1 end * d.taxable_paise)::text as taxable,
             (case when d.doc_type = 'credit_note' then -1 else 1 end * d.cgst_paise)::text as cgst,
             (case when d.doc_type = 'credit_note' then -1 else 1 end * d.sgst_paise)::text as sgst,
             (case when d.doc_type = 'credit_note' then -1 else 1 end * d.igst_paise)::text as igst,
             (case when d.doc_type = 'credit_note' then -1 else 1 end * d.cess_paise)::text as cess,
             (case when d.doc_type = 'credit_note' then -1 else 1 end * d.grand_total_paise)::text as total
        from document d left join party p on p.id = d.party_id
       where d.status in ('issued', 'cancelled') and d.doc_type in ('tax_invoice', 'bill_of_supply', 'credit_note', 'debit_note')
         and d.doc_date between ${from}::date and ${to}::date
       order by d.doc_date, d.number`;
    const live = rows.filter((r) => r.status === 'issued');
    const sum = (k: string) => live.reduce((n, r) => n + BigInt(r[k] as string), 0n).toString();
    return {
      from, to,
      rows: rows.map((r): Record<string, any> => ({ ...r, type: TYPE_LABEL[r.doc_type as string], status: r.status === 'cancelled' ? 'Cancelled' : 'Issued' })),
      totals: { taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst'), cess: sum('cess'), total: sum('total'), count: live.length },
    };
  });
}

export const CUSTOMER_COLUMNS: Column<any>[] = [
  { key: 'customer', label: 'Customer' }, { key: 'gstin', label: 'GSTIN' }, { key: 'documents', label: 'Documents' },
  { key: 'taxable', label: 'Taxable value', money: true }, { key: 'total', label: 'Total', money: true }, { key: 'outstanding', label: 'Outstanding', money: true },
];

/** Net sales and what is still owed, by customer. */
export async function salesByCustomer(sql: Sql, t: TenantSession, f: { from?: string; to?: string } = {}) {
  return inTenant(sql, t, 'report.read', async (tx) => {
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const { from, to } = dateRange(f, b!.timezone as string);
    const rows = await tx`
      select coalesce(p.name, 'Walk-in customers') as customer, max(p.gstin) as gstin, count(*)::int as documents,
             sum(case when d.doc_type = 'credit_note' then -d.taxable_paise else d.taxable_paise end)::text as taxable,
             sum(case when d.doc_type = 'credit_note' then -d.grand_total_paise else d.grand_total_paise end)::text as total,
             coalesce(sum(case when d.doc_type in ('tax_invoice', 'bill_of_supply', 'debit_note') then d.grand_total_paise - d.amount_settled_paise else 0 end), 0)::text as outstanding
        from document d left join party p on p.id = d.party_id
       where d.status = 'issued' and d.doc_type in ('tax_invoice', 'bill_of_supply', 'credit_note', 'debit_note') and d.doc_date between ${from}::date and ${to}::date
       group by p.id, p.name order by sum(case when d.doc_type = 'credit_note' then -d.grand_total_paise else d.grand_total_paise end) desc`;
    return { from, to, rows };
  });
}

export const PAYMENT_COLUMNS: Column<any>[] = [
  { key: 'received_on', label: 'Date' }, { key: 'customer', label: 'Customer' }, { key: 'method', label: 'Method' }, { key: 'invoices', label: 'Invoices' },
  { key: 'amount', label: 'Amount', money: true }, { key: 'unallocated', label: 'Not applied', money: true }, { key: 'reference', label: 'Reference' },
];

export async function paymentsReceived(sql: Sql, t: TenantSession, f: { from?: string; to?: string } = {}) {
  return inTenant(sql, t, 'report.read', async (tx) => {
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const { from, to } = dateRange(f, b!.timezone as string);
    const rows = await tx`
      select p.received_on::text as received_on, coalesce(pa.name, 'Walk-in customer') as customer,
             case when p.gateway is null then p.method else p.method || ' via ' || p.gateway end as method,
             coalesce(string_agg(distinct d.number, ', '), '') as invoices, p.amount_paise::text as amount,
             (p.amount_paise - coalesce(sum(a.amount_paise), 0))::text as unallocated, coalesce(p.gateway_payment_id, p.note, '') as reference
        from payment p left join payment_allocation a on a.payment_id = p.id left join document d on d.id = a.document_id left join party pa on pa.id = p.party_id
       where p.received_on between ${from}::date and ${to}::date
       group by p.id, pa.name order by p.received_on, p.created_at`;
    const total = rows.reduce((n, r) => n + BigInt(r.amount as string), 0n).toString();
    return { from, to, rows, total };
  });
}

export const TDS_COLUMNS: Column<any>[] = [
  { key: 'customer', label: 'Customer' }, { key: 'gstin', label: 'GSTIN' }, { key: 'invoices', label: 'Invoices with TDS' },
  { key: 'expected', label: 'TDS the customer will deduct', money: true }, { key: 'received', label: 'TDS received as a credit', money: true }, { key: 'pending', label: 'Still to receive', money: true },
];

/**
 * Tax deducted at source by customers, for invoices dated in the period: what each customer is expected to deduct (set on the invoice),
 * what has been recorded as received (payments of the kind "TDS deducted by the customer"), and what is still to come. A way to follow up
 * on the certificates and to check the credit in the tax account (Form 26AS or AIS) against your books.
 */
export async function tdsReceivable(sql: Sql, t: TenantSession, f: { from?: string; to?: string } = {}) {
  return inTenant(sql, t, 'report.read', async (tx) => {
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const { from, to } = dateRange(f, b!.timezone as string);
    const rows = await tx`
      select coalesce(p.name, 'Walk-in customer') as customer, coalesce(p.gstin, '') as gstin, count(*)::int as invoices, sum(d.tds_paise)::text as expected,
             coalesce(sum((select sum(a.amount_paise) from payment_allocation a join payment pay on pay.id = a.payment_id where a.document_id = d.id and pay.method = 'tds')), 0)::text as received
        from document d left join party p on p.id = d.party_id
       where d.status = 'issued' and d.doc_type in ('tax_invoice', 'bill_of_supply', 'debit_note') and d.tds_paise > 0 and d.doc_date between ${from}::date and ${to}::date
       group by p.id, p.name, p.gstin order by customer`;
    const out: Record<string, any>[] = rows.map((r) => ({ ...r, pending: (BigInt(r.expected as string) - BigInt(r.received as string)).toString() }));
    const sum = (k: string) => out.reduce((n, r) => n + BigInt(r[k] as string), 0n).toString();
    return { from, to, rows: out, totals: { expected: sum('expected'), received: sum('received'), pending: sum('pending') } };
  });
}

export const STATEMENT_COLUMNS: Column<any>[] = [
  { key: 'date', label: 'Date' }, { key: 'description', label: 'Description' }, { key: 'debit', label: 'Billed', money: true },
  { key: 'credit', label: 'Received or credited', money: true }, { key: 'balance', label: 'Balance', money: true },
];

/** A customer's account: what was billed, what was received or credited, and the running balance. */
export async function customerStatement(sql: Sql, t: TenantSession, partyId: string, f: { from?: string; to?: string } = {}) {
  return inTenant(sql, t, 'report.read', async (tx) => {
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const { from, to } = dateRange(f, b!.timezone as string);
    const [party] = await tx`select id, name, gstin from party where id = ${partyId}`;
    if (!party) throw new ValidationError('Customer not found.');
    const docs = await tx`
      select doc_date::text as date, doc_type, number, grand_total_paise from document
       where party_id = ${partyId} and status = 'issued' and doc_type in ('tax_invoice', 'bill_of_supply', 'debit_note', 'credit_note') order by doc_date, number`;
    const pays = await tx`
      select p.received_on::text as date, p.method, p.gateway, p.amount_paise, coalesce(sum(a.amount_paise), 0) as applied
        from payment p left join payment_allocation a on a.payment_id = p.id where p.party_id = ${partyId} group by p.id order by p.received_on, p.created_at`;
    type E = { date: string; description: string; debit: bigint; credit: bigint };
    const entries: E[] = [
      ...docs.map((d) => ({ date: d.date as string, description: `${TYPE_LABEL[d.doc_type as string]} ${d.number}`,
        debit: d.doc_type === 'credit_note' ? 0n : BigInt(d.grand_total_paise as string), credit: d.doc_type === 'credit_note' ? BigInt(d.grand_total_paise as string) : 0n })),
      ...pays.map((p) => ({ date: p.date as string, description: `Payment (${p.gateway ? `${p.method} via ${p.gateway}` : p.method})`, debit: 0n, credit: BigInt(p.amount_paise as string) })),
    ].sort((x, y) => x.date.localeCompare(y.date));
    // Credit notes applied to an invoice reduce the balance once, as the note itself, so they are not counted again as payments.
    let bal = 0n, opening = 0n;
    const rows: { date: string; description: string; debit: string; credit: string; balance: string }[] = [];
    for (const e of entries) {
      if (e.date > to) break;
      bal += e.debit - e.credit;
      if (e.date < from) { opening = bal; continue; }
      rows.push({ date: e.date, description: e.description, debit: e.debit.toString(), credit: e.credit.toString(), balance: bal.toString() });
    }
    return { from, to, party, opening: opening.toString(), rows, closing: bal.toString() };
  });
}
