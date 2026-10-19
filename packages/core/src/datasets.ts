import type { Sql, Tx } from '@kora/db';
import { makeXlsx, makeZip, type Sheet } from './files.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { isDate, ValidationError } from './validation.js';
import { toCsv, type Column } from './registers.js';

/**
 * The business's own data as plain tables, for a spreadsheet, for another accounting package, or as a full backup.
 * Every export is recorded in data_export so the owner can see who took what.
 */
export interface Dataset { name: string; label: string; columns: Column<any>[]; rows: Record<string, unknown>[] }

const MAX_ROWS = 200_000;
export const DATASET_NAMES = ['customers', 'items', 'documents', 'document_lines', 'payments', 'expenses'] as const;
export type DatasetName = (typeof DATASET_NAMES)[number];

const TYPE: Record<string, string> = {
  tax_invoice: 'Tax invoice', bill_of_supply: 'Bill of supply', estimate: 'Estimate', proforma: 'Proforma invoice',
  delivery_challan: 'Delivery challan', credit_note: 'Credit note', debit_note: 'Debit note',
};

interface Range { from: string | null; to: string | null }

async function load(tx: Tx, name: DatasetName, r: Range): Promise<Dataset> {
  const lim = MAX_ROWS + 1;
  let ds: Dataset;
  switch (name) {
    case 'customers': {
      const rows = await tx`select name, kind, gstin, state_code, phone, email, currency, billing_address->>'line1' as address, billing_address->>'city' as city,
                                   billing_address->>'pincode' as pincode, created_at::date::text as created
                              from party where archived_at is null order by name limit ${lim}`;
      ds = { name, label: 'Customers', rows, columns: [
        { key: 'name', label: 'Name' }, { key: 'kind', label: 'Type' }, { key: 'gstin', label: 'GSTIN' }, { key: 'state_code', label: 'State code' }, { key: 'phone', label: 'Mobile' },
        { key: 'email', label: 'Email' }, { key: 'currency', label: 'Currency' }, { key: 'address', label: 'Address' }, { key: 'city', label: 'City' }, { key: 'pincode', label: 'Pincode' }, { key: 'created', label: 'Added on' }] };
      break;
    }
    case 'items': {
      const rows = await tx`select name, kind, hsn_sac, unit, (default_rate_bp / 100.0)::text as gst_percent, price_paise::text as price from item where archived_at is null order by name limit ${lim}`;
      ds = { name, label: 'Items', rows, columns: [
        { key: 'name', label: 'Name' }, { key: 'kind', label: 'Type' }, { key: 'hsn_sac', label: 'HSN or SAC' }, { key: 'unit', label: 'Unit' },
        { key: 'gst_percent', label: 'GST percent' }, { key: 'price', label: 'Price', money: true }] };
      break;
    }
    case 'documents': {
      const rows = await tx`
        select d.number, d.doc_type, d.status, d.doc_date::text as doc_date, d.due_date::text as due_date, coalesce(p.name, 'Walk-in customer') as customer,
               coalesce(d.recipient_snapshot->>'gstin', p.gstin) as gstin, d.currency, d.place_of_supply, d.reverse_charge,
               d.taxable_paise::text as taxable, d.cgst_paise::text as cgst, d.sgst_paise::text as sgst, d.igst_paise::text as igst, d.cess_paise::text as cess,
               d.tcs_paise::text as tcs, d.tds_paise::text as tds, d.round_off_paise::text as round_off, d.grand_total_paise::text as total,
               d.amount_settled_paise::text as settled, d.payment_status, o.number as original_number, d.cancel_reason
          from document d left join party p on p.id = d.party_id left join document o on o.id = d.original_document_id
         where (${r.from}::date is null or d.doc_date >= ${r.from}::date) and (${r.to}::date is null or d.doc_date <= ${r.to}::date)
         order by d.doc_date, d.number nulls last limit ${lim}`;
      ds = { name, label: 'Documents', rows: rows.map((x) => ({ ...x, doc_type: TYPE[x.doc_type as string] ?? x.doc_type, reverse_charge: x.reverse_charge ? 'Yes' : '' })), columns: [
        { key: 'number', label: 'Number' }, { key: 'doc_type', label: 'Type' }, { key: 'status', label: 'Status' }, { key: 'doc_date', label: 'Date' }, { key: 'due_date', label: 'Due date' },
        { key: 'customer', label: 'Customer' }, { key: 'gstin', label: 'GSTIN' }, { key: 'currency', label: 'Currency' }, { key: 'place_of_supply', label: 'Place of supply' },
        { key: 'reverse_charge', label: 'Reverse charge' }, { key: 'taxable', label: 'Taxable value', money: true }, { key: 'cgst', label: 'CGST', money: true },
        { key: 'sgst', label: 'SGST', money: true }, { key: 'igst', label: 'IGST', money: true }, { key: 'cess', label: 'Cess', money: true }, { key: 'tcs', label: 'TCS', money: true },
        { key: 'tds', label: 'TDS', money: true }, { key: 'round_off', label: 'Round off', money: true }, { key: 'total', label: 'Total', money: true },
        { key: 'settled', label: 'Received or credited', money: true }, { key: 'payment_status', label: 'Payment status' }, { key: 'original_number', label: 'Corrects' }, { key: 'cancel_reason', label: 'Cancel reason' }] };
      break;
    }
    case 'document_lines': {
      const rows = await tx`
        select d.number, d.doc_type, d.doc_date::text as doc_date, l.position, l.item_name, l.hsn_sac, l.unit, l.quantity::text as quantity, l.rate_paise::text as rate,
               l.discount_paise::text as discount, l.taxable_paise::text as taxable, (l.tax_rate_bp / 100.0)::text as gst_percent, l.cgst_paise::text as cgst,
               l.sgst_paise::text as sgst, l.igst_paise::text as igst, l.cess_paise::text as cess, l.line_total_paise::text as total
          from document_line l join document d on d.id = l.document_id
         where (${r.from}::date is null or d.doc_date >= ${r.from}::date) and (${r.to}::date is null or d.doc_date <= ${r.to}::date)
         order by d.doc_date, d.number nulls last, l.position limit ${lim}`;
      ds = { name, label: 'Document lines', rows: rows.map((x) => ({ ...x, doc_type: TYPE[x.doc_type as string] ?? x.doc_type })), columns: [
        { key: 'number', label: 'Document' }, { key: 'doc_type', label: 'Type' }, { key: 'doc_date', label: 'Date' }, { key: 'position', label: 'Line' }, { key: 'item_name', label: 'Description' },
        { key: 'hsn_sac', label: 'HSN or SAC' }, { key: 'unit', label: 'Unit' }, { key: 'quantity', label: 'Quantity' }, { key: 'rate', label: 'Rate', money: true },
        { key: 'discount', label: 'Discount', money: true }, { key: 'taxable', label: 'Taxable value', money: true }, { key: 'gst_percent', label: 'GST percent' },
        { key: 'cgst', label: 'CGST', money: true }, { key: 'sgst', label: 'SGST', money: true }, { key: 'igst', label: 'IGST', money: true }, { key: 'cess', label: 'Cess', money: true },
        { key: 'total', label: 'Line total', money: true }] };
      break;
    }
    case 'payments': {
      const rows = await tx`
        select p.received_on::text as received_on, coalesce(c.name, '') as customer, p.method, coalesce(p.gateway, '') as gateway, p.amount_paise::text as amount,
               coalesce(string_agg(d.number, ', ' order by d.number), '') as applied_to, coalesce(p.note, '') as note
          from payment p left join party c on c.id = p.party_id left join payment_allocation a on a.payment_id = p.id left join document d on d.id = a.document_id
         where (${r.from}::date is null or p.received_on >= ${r.from}::date) and (${r.to}::date is null or p.received_on <= ${r.to}::date)
         group by p.id, c.name order by p.received_on, p.created_at limit ${lim}`;
      ds = { name, label: 'Payments', rows, columns: [
        { key: 'received_on', label: 'Date' }, { key: 'customer', label: 'Customer' }, { key: 'method', label: 'Method' }, { key: 'gateway', label: 'Gateway' },
        { key: 'amount', label: 'Amount', money: true }, { key: 'applied_to', label: 'Applied to' }, { key: 'note', label: 'Note' }] };
      break;
    }
    case 'expenses': {
      const rows = await tx`select expense_date::text as expense_date, vendor, category, amount_paise::text as amount, gst_paise::text as gst, paid_via, notes
                              from expense where (${r.from}::date is null or expense_date >= ${r.from}::date) and (${r.to}::date is null or expense_date <= ${r.to}::date)
                             order by expense_date, created_at limit ${lim}`;
      ds = { name, label: 'Expenses', rows, columns: [
        { key: 'expense_date', label: 'Date' }, { key: 'vendor', label: 'Vendor' }, { key: 'category', label: 'Category' }, { key: 'amount', label: 'Amount paid', money: true },
        { key: 'gst', label: 'GST included', money: true }, { key: 'paid_via', label: 'Paid by' }, { key: 'notes', label: 'Notes' }] };
      break;
    }
  }
  if (ds.rows.length > MAX_ROWS) throw new ValidationError(`${ds.label} has more than ${MAX_ROWS.toLocaleString('en-IN')} rows. Choose a shorter date range.`, 'from');
  return ds;
}

function range(f: { from?: string; to?: string }): Range {
  if ((f.from && !isDate(f.from)) || (f.to && !isDate(f.to))) throw new ValidationError('Enter dates as YYYY-MM-DD.', 'from');
  if (f.from && f.to && f.from > f.to) throw new ValidationError('The start date is after the end date.', 'from');
  return { from: f.from || null, to: f.to || null };
}

const record = (tx: Tx, t: TenantSession, kind: string, detail: Record<string, unknown>) =>
  tx`insert into data_export (business_id, user_id, kind, detail) values (${t.businessId}, ${t.userId}, ${kind}, ${tx.json(detail as never)})`;

/** One Excel workbook with a sheet per chosen dataset. */
export async function exportWorkbook(sql: Sql, t: TenantSession, o: { datasets?: string[]; from?: string; to?: string } = {}) {
  const names = (o.datasets && o.datasets.length ? o.datasets : [...DATASET_NAMES]) as string[];
  for (const n of names) if (!(DATASET_NAMES as readonly string[]).includes(n)) throw new ValidationError(`Unknown data set: ${n}.`, 'datasets');
  const r = range(o);
  return inTenant(sql, t, 'report.export', async (tx) => {
    const sets: Dataset[] = [];
    for (const n of new Set(names)) sets.push(await load(tx, n as DatasetName, r));
    const counts = Object.fromEntries(sets.map((s) => [s.name, s.rows.length]));
    await record(tx, t, 'workbook', { ...counts, from: r.from, to: r.to });
    const sheets: Sheet[] = sets.map((s) => ({ name: s.label, columns: s.columns, rows: s.rows }));
    return { buffer: makeXlsx(sheets), counts, filename: `kora_data${r.from ? `_${r.from}` : ''}${r.to ? `_to_${r.to}` : ''}.xlsx` };
  });
}

const README = (legalName: string, counts: Record<string, number>, when: string) => `Kora backup of ${legalName}
Taken on ${when}

What is in this file
  customers.csv, items.csv, documents.csv, document_lines.csv, payments.csv, expenses.csv
      The same data as spreadsheets. Open them in Excel or Google Sheets. Money is in rupees.
  data.json
      Everything above in one machine-readable file, with amounts in paise (1 rupee = 100 paise), for another program to read.

What is not in this file
  PDF copies of your documents (open any document in Kora and download it), receipt photos, the activity log, and your settings.

Rows: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}

Keep this file somewhere safe. It holds your customers and sales. Invoices you have issued are legal records: keep your copies for the period the law requires.
`;

/** Everything in one ZIP: a CSV per dataset, plus data.json for another program, plus a plain-words README. */
export async function exportBackup(sql: Sql, t: TenantSession) {
  return inTenant(sql, t, 'report.export', async (tx) => {
    const [b] = await tx`select legal_name, gstin from business where id = ${t.businessId}`;
    const sets: Dataset[] = [];
    for (const n of DATASET_NAMES) sets.push(await load(tx, n, { from: null, to: null }));
    const counts = Object.fromEntries(sets.map((s) => [s.name, s.rows.length])) as Record<string, number>;
    const at = new Date();
    const json = JSON.stringify({
      format: 'kora-backup', version: 1, exported_at: at.toISOString(), business: { legal_name: b!.legal_name, gstin: b!.gstin },
      note: 'Amounts are in paise (1 rupee = 100 paise) as strings. Document and payment dates are YYYY-MM-DD.',
      datasets: Object.fromEntries(sets.map((s) => [s.name, { columns: s.columns.map((c) => ({ key: c.key, label: c.label, money: !!c.money })), rows: s.rows }])),
    });
    await record(tx, t, 'backup', counts);
    const zip = makeZip([
      { name: 'README.txt', data: README(b!.legal_name as string, counts, at.toISOString().slice(0, 10)) },
      ...sets.map((s) => ({ name: `${s.name}.csv`, data: toCsv(s.columns, s.rows) })),
      { name: 'data.json', data: json },
    ], at);
    return { buffer: zip, counts, filename: `kora_backup_${at.toISOString().slice(0, 10)}.zip` };
  });
}
