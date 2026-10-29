import type { Sql, Tx } from '@kora/db';
import { gstinValid } from '@kora/tax';
import { parseCsv } from './importer.js';
import { inFirm, type FirmSession } from './firmtenancy.js';
import { ValidationError } from './validation.js';

export type RegistrationType = 'regular' | 'composition' | 'sez' | 'isd';
export type FilingFrequency = 'monthly' | 'quarterly';

export interface NewRegistration { gstin: string; registrationType?: RegistrationType; filingFrequency?: FilingFrequency }
export interface NewClient {
  legalName: string; pan?: string; sourceSoftware?: string; contactName?: string; contactEmail?: string; contactPhone?: string;
  registrations: NewRegistration[];
}

const TYPES: RegistrationType[] = ['regular', 'composition', 'sez', 'isd'];
const FREQ: FilingFrequency[] = ['monthly', 'quarterly'];
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const MAX_ROWS = 500;
const MAX_CSV = 1_000_000;

/** Checks one client and returns a clean copy, or a message saying what is wrong. */
function clean(c: NewClient): { ok: NewClient } | { error: string } {
  const legalName = (c.legalName ?? '').trim();
  if (!legalName || legalName.length > 200) return { error: 'Enter the client name (up to 200 characters).' };
  const pan = c.pan?.trim().toUpperCase() || undefined;
  if (pan && !PAN.test(pan)) return { error: `PAN ${pan} is not valid.` };
  if (!c.registrations.length) return { error: 'Add at least one GSTIN.' };
  const seen = new Set<string>();
  const registrations: NewRegistration[] = [];
  for (const r of c.registrations) {
    const gstin = (r.gstin ?? '').trim().toUpperCase();
    if (!gstinValid(gstin)) return { error: `GSTIN ${gstin || '(blank)'} is not valid.` };
    if (seen.has(gstin)) return { error: `GSTIN ${gstin} is listed twice.` };
    seen.add(gstin);
    const registrationType = r.registrationType ?? 'regular';
    const filingFrequency = r.filingFrequency ?? 'monthly';
    if (!TYPES.includes(registrationType)) return { error: `Registration type ${registrationType} is not one of ${TYPES.join(', ')}.` };
    if (!FREQ.includes(filingFrequency)) return { error: `Filing frequency ${filingFrequency} is not monthly or quarterly.` };
    registrations.push({ gstin, registrationType, filingFrequency });
  }
  const t = (v: string | undefined, n: number) => (v ?? '').trim().slice(0, n);
  return { ok: { legalName, pan, sourceSoftware: t(c.sourceSoftware, 60), contactName: t(c.contactName, 120), contactEmail: t(c.contactEmail, 200), contactPhone: t(c.contactPhone, 30), registrations } };
}

async function existingGstins(tx: Tx, firmId: string, gstins: string[]): Promise<Set<string>> {
  if (!gstins.length) return new Set();
  const rows = await tx`select gstin from client_registration where firm_id = ${firmId} and gstin = any(${gstins})`;
  return new Set(rows.map((r) => r.gstin as string));
}

async function insertClient(tx: Tx, firmId: string, c: NewClient): Promise<string> {
  const [e] = await tx`
    insert into client_entity (firm_id, legal_name, pan, source_software, contact_name, contact_email, contact_phone)
    values (${firmId}, ${c.legalName}, ${c.pan ?? null}, ${c.sourceSoftware ?? ''}, ${c.contactName ?? ''}, ${c.contactEmail ?? ''}, ${c.contactPhone ?? ''})
    returning id`;
  for (const r of c.registrations) {
    await tx`insert into client_registration (firm_id, client_id, gstin, registration_type, filing_frequency, state_code)
             values (${firmId}, ${e!.id}, ${r.gstin}, ${r.registrationType!}, ${r.filingFrequency!}, ${r.gstin.slice(0, 2)})`;
  }
  return e!.id as string;
}

export async function addClient(sql: Sql, s: FirmSession, input: NewClient): Promise<string> {
  const c = clean(input);
  if ('error' in c) throw new ValidationError(c.error);
  return inFirm(sql, s, 'client.write', async (tx) => {
    const dupe = await existingGstins(tx, s.firmId, c.ok.registrations.map((r) => r.gstin));
    if (dupe.size) throw new ValidationError(`GSTIN ${[...dupe][0]} is already one of your clients.`);
    return insertClient(tx, s.firmId, c.ok);
  });
}

export interface ClientRow {
  id: string; legalName: string; pan: string | null; sourceSoftware: string; contactName: string; contactEmail: string; contactPhone: string; status: string;
  registrations: { id: string; gstin: string; registrationType: string; filingFrequency: string; stateCode: string }[];
}

/** One page of clients, with their registrations. `total` is the whole count so the page can say when it is showing part. */
export async function listClients(sql: Sql, s: FirmSession, opts: { limit?: number; offset?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  return inFirm(sql, s, 'client.read', async (tx) => {
    const [{ n }] = (await tx`select count(*)::int as n from client_entity where firm_id = ${s.firmId} and status = 'active'`) as unknown as [{ n: number }];
    const ents = await tx`select * from client_entity where firm_id = ${s.firmId} and status = 'active' order by legal_name, id limit ${limit} offset ${offset}`;
    const ids = ents.map((e) => e.id as string);
    const regs = ids.length ? await tx`select * from client_registration where client_id = any(${ids}) order by gstin` : [];
    const clients: ClientRow[] = ents.map((e) => ({
      id: e.id, legalName: e.legal_name, pan: e.pan, sourceSoftware: e.source_software, contactName: e.contact_name, contactEmail: e.contact_email, contactPhone: e.contact_phone, status: e.status,
      registrations: regs.filter((r) => r.client_id === e.id).map((r) => ({ id: r.id, gstin: r.gstin, registrationType: r.registration_type, filingFrequency: r.filing_frequency, stateCode: r.state_code })),
    }));
    return { total: n, limit, offset, clients };
  });
}

// ---------------------------------------------------------------- CSV import

const HEADERS = ['legal_name', 'gstin', 'pan', 'source_software', 'contact_name', 'contact_email', 'contact_phone', 'registration_type', 'filing_frequency'] as const;

export interface ImportLine { line: number; legalName: string; gstin: string; status: 'new' | 'exists' | 'error'; message: string }
export interface ClientImportPreview { lines: ImportLine[]; counts: { new: number; exists: number; error: number }; clients: NewClient[] }

/** Reads the file and says what would happen, without writing. Rows with the same name become one client with several GSTINs. */
export function planImport(csv: string, known: Set<string>): ClientImportPreview {
  if (csv.length > MAX_CSV) throw new ValidationError('That file is too large. Split it into smaller files.');
  const rows = parseCsv(csv);
  const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  for (const need of ['legal_name', 'gstin']) if (!head.includes(need)) throw new ValidationError(`The first row must name the columns, including ${need}. Known columns: ${HEADERS.join(', ')}.`);
  if (rows.length > MAX_ROWS) throw new ValidationError(`A file can have at most ${MAX_ROWS} rows. Split it.`);
  const col = (r: string[], n: string) => (r[head.indexOf(n)] ?? '').trim();
  const lines: ImportLine[] = [];
  const byName = new Map<string, NewClient>();
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const line = i + 2;
    const legalName = col(r, 'legal_name');
    const gstin = col(r, 'gstin').toUpperCase();
    const one = clean({
      legalName, pan: col(r, 'pan'), sourceSoftware: col(r, 'source_software'), contactName: col(r, 'contact_name'), contactEmail: col(r, 'contact_email'), contactPhone: col(r, 'contact_phone'),
      registrations: [{ gstin, registrationType: (col(r, 'registration_type').toLowerCase() || undefined) as RegistrationType | undefined, filingFrequency: (col(r, 'filing_frequency').toLowerCase() || undefined) as FilingFrequency | undefined }],
    });
    if ('error' in one) { lines.push({ line, legalName, gstin, status: 'error', message: one.error }); return; }
    if (seen.has(gstin)) { lines.push({ line, legalName, gstin, status: 'error', message: `GSTIN ${gstin} appears twice in this file.` }); return; }
    seen.add(gstin);
    if (known.has(gstin)) { lines.push({ line, legalName, gstin, status: 'exists', message: 'Already one of your clients; skipped.' }); return; }
    const key = legalName.toLowerCase();
    const have = byName.get(key);
    if (have) have.registrations.push(...one.ok.registrations); else byName.set(key, one.ok);
    lines.push({ line, legalName, gstin, status: 'new', message: '' });
  });
  const count = (st: ImportLine['status']) => lines.filter((l) => l.status === st).length;
  return { lines, counts: { new: count('new'), exists: count('exists'), error: count('error') }, clients: [...byName.values()] };
}

async function preview(tx: Tx, s: FirmSession, csv: string): Promise<ClientImportPreview> {
  const [head = [], ...rows] = parseCsv(csv);
  const at = head.map((h) => h.trim().toLowerCase()).indexOf('gstin');
  const gstins = at < 0 ? [] : rows.slice(0, MAX_ROWS).map((r) => (r[at] ?? '').trim().toUpperCase()).filter(Boolean);
  return planImport(csv, await existingGstins(tx, s.firmId, gstins));
}

export async function previewClientImport(sql: Sql, s: FirmSession, csv: string): Promise<Omit<ClientImportPreview, 'clients'>> {
  const p = await inFirm(sql, s, 'client.write', (tx) => preview(tx, s, csv));
  return { lines: p.lines, counts: p.counts };
}

/** Adds every new row. Refuses the whole file if any row has an error, so a half-read file never leaves a half-built list. Running it again adds nothing. */
export async function importClients(sql: Sql, s: FirmSession, csv: string): Promise<{ added: number; skipped: number }> {
  return inFirm(sql, s, 'client.write', async (tx) => {
    const p = await preview(tx, s, csv);
    if (p.counts.error) throw new ValidationError(`${p.counts.error} row(s) have problems. Fix them and upload again; nothing was added.`);
    for (const c of p.clients) await insertClient(tx, s.firmId, c);
    return { added: p.clients.length, skipped: p.counts.exists };
  });
}
