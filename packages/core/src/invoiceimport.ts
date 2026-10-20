import { createHash } from 'node:crypto';
import type { Sql } from '@kora/db';
import { parseStatementDate } from './bankstatement.js';
import { saveDraft, previewTotals, type DocIn } from './documents.js';
import { IMPORT_MAX_BYTES, parseCsv } from './importer.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { isValidationError, ValidationError } from './validation.js';

/**
 * Invoices from a spreadsheet become DRAFTS. Kora numbers a document when it is issued and a number can never be reused, so an old
 * invoice's own number is kept as its reference and the draft gets a new number when you issue it. You look at each draft first.
 * Importing the same file twice does not make a second set: each draft is remembered by the file and the invoice reference.
 */
export const INVOICE_IMPORT_MAX_DOCS = 200;
export const INVOICE_IMPORT_MAX_ROWS = 2000;
export type ImportDocType = 'tax_invoice' | 'bill_of_supply' | 'estimate' | 'proforma';

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ALIASES: Record<string, string[]> = {
  ref: ['invoice number', 'invoice no', 'invoice', 'invoice ref', 'invoice id', 'reference', 'order number', 'order no', 'bill no', 'bill number', 'document number', 'ref'],
  date: ['invoice date', 'date', 'bill date', 'document date'],
  due: ['due date', 'payment due date'],
  customer: ['customer', 'customer name', 'party', 'party name', 'client', 'client name', 'display name'],
  gstin: ['gstin', 'customer gstin', 'gst number', 'gstin no', 'gst identification number gstin'],
  desc: ['item', 'item name', 'description', 'item description', 'product', 'product name', 'particulars'],
  hsn: ['hsn', 'sac', 'hsn sac', 'hsn or sac', 'hsn code', 'sac code'],
  qty: ['quantity', 'qty'],
  rate: ['rate', 'price', 'unit price', 'item price', 'selling price', 'sale price'],
  gst: ['gst', 'gst rate', 'tax rate', 'gst %', 'tax percentage', 'gst percent', 'item tax percentage'],
  discount: ['discount', 'discount amount'],
  notes: ['notes', 'remarks', 'customer notes'],
};
const REQUIRED = ['customer', 'desc', 'rate'];

export interface ImportedDoc {
  ref: string; firstLine: number; customer: string; date: string | null; lines: number;
  status: 'ok' | 'error' | 'existing'; message: string | null; totalPaise: string | null;
}

interface Planned { ref: string; firstLine: number; customer: string; input: DocIn | null; problem: string | null; key: string }

function parse(text: string) {
  if (text.length > IMPORT_MAX_BYTES) throw new ValidationError('The file is larger than 1 MB. Split it into smaller files.', 'file');
  const all = parseCsv(text);
  if (all.length === 0) throw new ValidationError('The file is empty.', 'file');
  const mapped: Record<string, number> = {};
  all[0]!.forEach((h, i) => {
    const f = Object.entries(ALIASES).find(([, names]) => names.includes(norm(h)))?.[0];
    if (f && !(f in mapped)) mapped[f] = i;
  });
  const missing = REQUIRED.filter((f) => !(f in mapped));
  if (missing.length) throw new ValidationError(`The first row needs a column for ${missing.map((m) => ({ customer: 'the customer', desc: 'the item or description', rate: 'the rate' }[m])).join(', ')}. Found: ${all[0]!.filter(Boolean).join(', ') || 'nothing'}.`, 'file');
  const body = all.slice(1).map((cells, i) => ({ line: i + 2, cells })).filter((r) => r.cells.some((c) => c.trim() !== ''));
  if (body.length === 0) throw new ValidationError('There are no invoice rows under the heading.', 'file');
  if (body.length > INVOICE_IMPORT_MAX_ROWS) throw new ValidationError(`The file has ${body.length} rows. The most that can be imported at once is ${INVOICE_IMPORT_MAX_ROWS}.`, 'file');
  return { mapped, body };
}

const toDate = (v: string): string | null => (/^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : parseStatementDate(v));

async function plan(sql: Sql, t: TenantSession, text: string, docType: ImportDocType): Promise<Planned[]> {
  if (!['tax_invoice', 'bill_of_supply', 'estimate', 'proforma'].includes(docType)) throw new ValidationError('Choose what the drafts should be.', 'docType');
  const { mapped, body } = parse(text);
  const parties = await inTenant(sql, t, 'party.read', (tx) => tx`select id, lower(name) as name, upper(gstin) as gstin from party where archived_at is null and kind in ('customer', 'both')`);
  const byGstin = new Map(parties.filter((p) => p.gstin).map((p) => [p.gstin as string, p.id as string]));
  const byName = new Map(parties.map((p) => [p.name as string, p.id as string]));
  const fileKey = createHash('sha256').update(text).digest('hex').slice(0, 12);
  const get = (cells: string[], f: string) => { const i = mapped[f]; return i === undefined ? '' : (cells[i] ?? '').trim(); };

  const groups = new Map<string, { firstLine: number; rows: { line: number; cells: string[] }[] }>();
  let last = '';
  for (const r of body) {
    const ref = mapped.ref !== undefined ? get(r.cells, 'ref') : '';
    const key = mapped.ref === undefined ? `row-${r.line}` : ref || last || `row-${r.line}`;     // a blank reference continues the invoice above
    last = key;
    const g = groups.get(key) ?? { firstLine: r.line, rows: [] };
    g.rows.push(r); groups.set(key, g);
  }
  if (groups.size > INVOICE_IMPORT_MAX_DOCS) throw new ValidationError(`The file makes ${groups.size} invoices. The most that can be imported at once is ${INVOICE_IMPORT_MAX_DOCS}.`, 'file');

  const out: Planned[] = [];
  for (const [ref, g] of groups) {
    const head = g.rows[0]!.cells;
    const customer = get(head, 'customer');
    const key = `imp_${createHash('sha256').update(`${fileKey}|${ref}`).digest('hex').slice(0, 40)}`;
    const fail = (problem: string): Planned => ({ ref, firstLine: g.firstLine, customer, input: null, problem, key });
    try {
      const gst = get(head, 'gstin').toUpperCase();
      const partyId = (gst && byGstin.get(gst)) || byName.get(customer.toLowerCase());
      if (!partyId) { out.push(fail(`"${customer || 'blank'}" is not in your customers. Import or add the customer first.`)); continue; }
      const rawDate = get(head, 'date');
      const date = rawDate ? toDate(rawDate) : undefined;
      if (rawDate && !date) { out.push(fail(`"${rawDate}" is not a date. Use 25/10/2026 or 2026-10-25.`)); continue; }
      const rawDue = get(head, 'due');
      const due = rawDue ? toDate(rawDue) : null;
      if (rawDue && !due) { out.push(fail(`"${rawDue}" is not a date for the due date.`)); continue; }
      const lines = g.rows.map((r) => {
        const gstText = get(r.cells, 'gst').replace(/%$/, '').trim();
        if (gstText && !/^\d{1,3}(\.\d{1,2})?$/.test(gstText)) throw new ValidationError(`Row ${r.line}: "${get(r.cells, 'gst')}" is not a GST percentage.`);
        const hsn = get(r.cells, 'hsn').replace(/\s+/g, '');
        return { name: get(r.cells, 'desc'), hsnSac: hsn || null, quantity: get(r.cells, 'qty') || '1', rate: get(r.cells, 'rate').replace(/,/g, ''),
          discount: get(r.cells, 'discount').replace(/,/g, '') || undefined, taxRateBp: gstText ? Math.round(parseFloat(gstText) * 100) : 1800,
          kind: (hsn.startsWith('99') ? 'service' : 'goods') as 'goods' | 'service' };
      });
      const input: DocIn = { docType, partyId, docDate: date ?? undefined, dueDate: due, reference: mapped.ref !== undefined && !ref.startsWith('row-') ? ref.slice(0, 60) : null,
        notes: get(head, 'notes') || null, lines };
      out.push({ ref, firstLine: g.firstLine, customer, input, problem: null, key });
    } catch (e) {
      if (!isValidationError(e)) throw e;
      out.push(fail(e.message));
    }
  }
  return out;
}

/** Reads the file and checks every invoice the way saving would, without saving anything. */
export async function previewInvoiceImport(sql: Sql, t: TenantSession, text: string, docType: ImportDocType = 'tax_invoice') {
  const planned = await plan(sql, t, text, docType);
  const existing = new Set((await inTenant(sql, t, 'document.read', (tx) => tx`select client_ref from document where client_ref like 'imp\\_%'`)).map((r) => r.client_ref as string));
  const docs: ImportedDoc[] = [];
  for (const p of planned) {
    const base = { ref: p.ref.startsWith('row-') ? '' : p.ref, firstLine: p.firstLine, customer: p.customer, date: p.input?.docDate ?? null, lines: p.input?.lines.length ?? 0 };
    if (!p.input) { docs.push({ ...base, status: 'error', message: p.problem, totalPaise: null }); continue; }
    if (existing.has(p.key)) { docs.push({ ...base, status: 'existing', message: 'Already imported from this file.', totalPaise: null }); continue; }
    try {
      const r = await previewTotals(sql, t, p.input);
      docs.push({ ...base, status: 'ok', message: r.warnings[0] ?? null, totalPaise: r.grandTotal });
    } catch (e) {
      if (!isValidationError(e)) throw e;
      docs.push({ ...base, status: 'error', message: e.message, totalPaise: null });
    }
  }
  const count = (s: string) => docs.filter((d) => d.status === s).length;
  return { counts: { total: docs.length, ok: count('ok'), existing: count('existing'), error: count('error') }, docs };
}

/** Makes a draft for every invoice that checks out. The ones with a problem are reported and left out, never guessed at. */
export async function commitInvoiceImport(sql: Sql, t: TenantSession, text: string, docType: ImportDocType = 'tax_invoice') {
  const planned = await plan(sql, t, text, docType);
  const created: { ref: string; id: string }[] = [];
  const problems: { ref: string; line: number; message: string }[] = [];
  let existing = 0;
  const seen = new Set((await inTenant(sql, t, 'document.read', (tx) => tx`select client_ref from document where client_ref like 'imp\_%'`)).map((r) => r.client_ref as string));
  for (const p of planned) {
    const ref = p.ref.startsWith('row-') ? '' : p.ref;
    if (!p.input) { problems.push({ ref, line: p.firstLine, message: p.problem! }); continue; }
    if (seen.has(p.key)) { existing++; continue; }
    try {
      const r = await saveDraft(sql, t, p.input, null, { clientRef: p.key });
      created.push({ ref, id: r.id });
    } catch (e) {
      if (!isValidationError(e)) throw e;
      problems.push({ ref, line: p.firstLine, message: e.message });
    }
  }
  await inTenant(sql, t, 'document.write', (tx) =>
    tx`insert into data_export (business_id, user_id, kind, detail) values (${t.businessId}, ${t.userId}, 'import_invoices', ${tx.json({ created: created.length, existing, failed: problems.length } as never)})`);
  return { created: created.length, existing, failed: problems.length, ids: created.map((c) => c.id), problems };
}
