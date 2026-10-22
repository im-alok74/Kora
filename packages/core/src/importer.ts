import { STATE_NAMES } from '@kora/tax';
import type { Sql } from '@kora/db';
import { createItem, validateItem, type ItemInput } from './items.js';
import { createParty, validateParty, type PartyInput } from './parties.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { isDate, isValidationError, ValidationError } from './validation.js';
import { cleanTags, setPartyExtras, type PartyExtrasInput } from './party-extras.js';
import { readXlsx, rowsToCsv } from './xlsx.js';
import { parseTallyLedgers } from './tallyimport.js';

/**
 * Bring customers and items in from a spreadsheet saved as CSV. A preview shows what would happen to every row first;
 * the import then re-checks every row itself and never trusts what the preview said. Rows that already exist are skipped, so
 * running the same file twice adds nothing the second time.
 */
export const IMPORT_MAX_BYTES = 1_000_000;
export const IMPORT_MAX_ROWS = 2000;
export type ImportKind = 'customers' | 'items';

/** RFC 4180: quoted fields, doubled quotes, and line breaks inside quotes. Handles a leading BOM and either line ending. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [], cell = '', inQuotes = false, any = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false; } else cell += c;
      continue;
    }
    if (c === '"' && cell === '') { inQuotes = true; any = true; }
    else if (c === ',') { row.push(cell); cell = ''; any = true; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      if (any || cell !== '') { row.push(cell); rows.push(row); }
      row = []; cell = ''; any = false;
    } else { cell += c; any = true; }
  }
  if (inQuotes) throw new ValidationError('The file has a quote that is never closed. Check the last row you edited.', 'file');
  if (any || cell !== '') { row.push(cell); rows.push(row); }
  return rows;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ALIASES: Record<ImportKind, Record<string, string[]>> = {
  customers: {
    name: ['name', 'customer', 'customer name', 'party', 'party name', 'company', 'display name', 'company name', 'contact name', 'ledger name'],
    gstin: ['gstin', 'gst number', 'gst no', 'gstin uin', 'gstin no', 'gstin number', 'gst identification number gstin', 'gst in', 'party gstin'],
    state: ['state', 'state code', 'state name', 'place of supply', 'place of contact', 'billing state', 'billing state code', 'state place of supply'],
    phone: ['phone', 'mobile', 'mobile number', 'phone number', 'contact', 'mobilephone', 'mobile phone', 'phone no', 'mobile no', 'contact number', 'contact no'],
    email: ['email', 'email id', 'e mail', 'email address', 'emailid', 'mail'],
    address: ['address', 'address line 1', 'line 1', 'street', 'billing address', 'billing street', 'billing address line 1', 'address line1'],
    city: ['city', 'town', 'billing city'],
    pincode: ['pincode', 'pin code', 'pin', 'zip', 'postal code', 'billing code', 'billing zip', 'billing pin code', 'billing pincode'], currency: ['currency', 'usual quote currency', 'currency code'],
    type: ['type', 'party type', 'contact type', 'customer or vendor'], tags: ['tags', 'tag', 'labels'],
    creditlimit: ['credit limit', 'credit limit rs', 'credit limit inr'], opening: ['opening balance', 'opening balance rs', 'opening balance inr', 'opening'], openingon: ['opening balance date', 'opening balance on', 'opening date'],
    udyam: ['udyam number', 'udyam', 'udyam registration number', 'udyam no'], msme: ['msme size', 'msme class', 'enterprise size'],
  },
  items: {
    name: ['name', 'item', 'item name', 'description', 'product', 'product name'], kind: ['type', 'kind', 'item type', 'goods or service', 'product type'],
    hsn: ['hsn', 'sac', 'hsn sac', 'hsn or sac', 'hsn code', 'sac code', 'hsn sac code'], unit: ['unit', 'uom', 'unit of measure', 'usage unit', 'primary unit'],
    gst: ['gst', 'gst percent', 'gst rate', 'tax', 'tax rate', 'gst %', 'intra state tax percentage', 'intra state tax rate', 'tax percentage', 'gst tax rate', 'gst rate percentage'],
    price: ['price', 'rate', 'selling price', 'sale price', 'unit price', 'sales price', 'selling rate'],
  },
};
const REQUIRED: Record<ImportKind, string[]> = { customers: ['name'], items: ['name'] };

/** Our own exports protect a cell that starts with = + - or @ by prefixing a quote. Take that quote off when the file comes back. */
const unprotect = (v: string) => (/^'[=+\-@]/.test(v) ? v.slice(1) : v);

function mapColumns(kind: ImportKind, header: string[]) {
  const mapped: Record<string, number> = {}, ignored: string[] = [];
  header.forEach((h, i) => {
    const n = norm(h);
    const field = Object.entries(ALIASES[kind]).find(([, names]) => names.includes(n))?.[0];
    if (field && !(field in mapped)) mapped[field] = i; else if (h.trim()) ignored.push(h.trim());
  });
  const missing = REQUIRED[kind].filter((f) => !(f in mapped));
  return { mapped, ignored, missing };
}

const stateByName = new Map(Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]));
/** Two-letter abbreviations as other billing software writes them, to the GST state code. */
const ABBREVIATIONS: Record<string, string> = {
  JK: '01', HP: '02', PB: '03', CH: '04', UK: '05', UT: '05', HR: '06', DL: '07', RJ: '08', UP: '09', BR: '10', SK: '11', AR: '12', NL: '13', MN: '14', MZ: '15', TR: '16', ML: '17',
  AS: '18', WB: '19', JH: '20', OD: '21', OR: '21', CG: '22', MP: '23', GJ: '24', DD: '26', DN: '26', MH: '27', KA: '29', GA: '30', LD: '31', KL: '32', TN: '33', PY: '34', AN: '35', TS: '36', AP: '37', LA: '38',
};

function resolveState(v: string | undefined): string | undefined {
  const s = (v ?? '').trim();
  if (!s) return undefined;
  if (/^[A-Za-z]{2}$/.test(s) && ABBREVIATIONS[s.toUpperCase()]) return ABBREVIATIONS[s.toUpperCase()];
  if (/^\d{1,2}$/.test(s)) { const code = s.padStart(2, '0'); if (STATE_NAMES[code]) return code; throw new ValidationError(`State code ${s} is not a state.`, 'state'); }
  const code = stateByName.get(s.toLowerCase());
  if (!code) throw new ValidationError(`"${s}" is not a state name Kora knows. Use the state's full name or its two-digit code.`, 'state');
  return code;
}

export interface ImportRow { line: number; status: 'ok' | 'duplicate' | 'error'; message: string | null; name: string }
export interface ImportPreview {
  kind: ImportKind; columns: { mapped: string[]; ignored: string[] };
  counts: { total: number; ok: number; duplicate: number; error: number }; rows: ImportRow[];
}

type Built = { party?: PartyInput; item?: ItemInput; extras?: PartyExtrasInput };

function build(kind: ImportKind, map: Record<string, number>, cells: string[]): Built {
  const get = (f: string) => { const i = map[f]; return i === undefined ? '' : unprotect((cells[i] ?? '').trim()); };
  if (kind === 'customers') {
    const gstin = get('gstin').toUpperCase();
    const typeText = get('type').toLowerCase();
    const partyKind = !typeText || typeText.startsWith('cust') ? 'customer' : typeText.startsWith('vend') || typeText.startsWith('supp') ? 'vendor' : typeText === 'both' ? 'both' : null;
    if (!partyKind) throw new ValidationError(`Type "${get('type')}" should be customer, vendor or both.`, 'type');
    const msme = get('msme').toLowerCase();
    const input: PartyInput = {
      kind: partyKind, udyamNumber: get('udyam').toUpperCase() || null, msmeClass: (msme || null) as PartyInput['msmeClass'], name: get('name'), gstin: gstin || null, stateCode: resolveState(get('state')) ?? null, phone: get('phone') || null, email: get('email') || null,
      billingAddress: { line1: get('address') || undefined, city: get('city') || undefined, pincode: get('pincode') || undefined }, currency: get('currency') || undefined,
    };
    validateParty(input);
    const extras: PartyExtrasInput = {};
    if (get('tags')) extras.tags = cleanTags(get('tags').split(/[,;]/));
    if (get('creditlimit')) extras.creditLimit = get('creditlimit').replace(/,/g, '');
    if (get('opening')) { extras.openingBalance = get('opening').replace(/,/g, ''); extras.openingBalanceOn = get('openingon') || null; }
    if (extras.openingBalance && (!extras.openingBalanceOn || !isDate(extras.openingBalanceOn))) throw new ValidationError('An opening balance needs its date as YYYY-MM-DD.', 'openingon');
    if (extras.creditLimit && !/^\d+(\.\d{1,2})?$/.test(extras.creditLimit)) throw new ValidationError(`"${get('creditlimit')}" is not an amount in rupees.`, 'creditlimit');
    return { party: input, extras };
  }
  const gst = get('gst').replace(/%$/, '').trim();
  let rateBp = 1800;
  if (gst) {
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(gst)) throw new ValidationError(`"${get('gst')}" is not a GST percentage.`, 'gst');
    rateBp = Math.round(parseFloat(gst) * 100);
  }
  const kindText = get('kind').toLowerCase();
  const itemKind = !kindText ? 'goods' : ['service', 'services'].includes(kindText) ? 'service' : ['goods', 'good', 'product', 'products'].includes(kindText) ? 'goods' : null;
  if (!itemKind) throw new ValidationError(`Type "${get('kind')}" should be goods or service.`, 'kind');
  const input: ItemInput = { name: get('name'), kind: itemKind, hsnSac: get('hsn') || null, unit: get('unit') || undefined, defaultRateBp: rateBp, price: get('price') || undefined };
  validateItem(input);
  return { item: input };
}

function read(kind: ImportKind, text: string) {
  if (text.length > IMPORT_MAX_BYTES) throw new ValidationError('The file is larger than 1 MB. Split it into smaller files.', 'file');
  const all = parseCsv(text);
  if (all.length === 0) throw new ValidationError('The file is empty.', 'file');
  if (all.some((r) => r.length > 40)) throw new ValidationError('The file has more than 40 columns. Is it a CSV?', 'file');
  const { mapped, ignored, missing } = mapColumns(kind, all[0]!);
  if (missing.length) throw new ValidationError(`The first row must have a column called ${missing.join(' and ')}. Found: ${all[0]!.filter(Boolean).join(', ') || 'nothing'}.`, 'file');
  const body = all.slice(1).map((cells, i) => ({ line: i + 2, cells })).filter((r) => r.cells.some((c) => c.trim() !== ''));
  if (body.length > IMPORT_MAX_ROWS) throw new ValidationError(`The file has ${body.length} rows. The most that can be imported at once is ${IMPORT_MAX_ROWS}.`, 'file');
  return { mapped, ignored, body };
}

async function existing(sql: Sql, t: TenantSession, kind: ImportKind) {
  return inTenant(sql, t, kind === 'customers' ? 'party.read' : 'item.read', async (tx) => {
    const rows = kind === 'customers'
      ? await tx`select lower(name) as name, upper(gstin) as gstin from party where archived_at is null`
      : await tx`select lower(name) as name, null::text as gstin from item where archived_at is null`;
    const rates = new Set((await tx`select rate_bp from tax_rate`).map((r) => r.rate_bp as number));
    return { names: new Set(rows.map((r) => r.name as string)), gstins: new Set(rows.filter((r) => r.gstin).map((r) => r.gstin as string)), rates };
  });
}

function classify(kind: ImportKind, built: Built, seen: { names: Set<string>; gstins: Set<string>; rates: Set<number> }): 'ok' | 'duplicate' {
  if (kind === 'customers') {
    const p = built.party!;
    const g = p.gstin?.toUpperCase();
    if ((g && seen.gstins.has(g)) || seen.names.has(p.name.toLowerCase())) return 'duplicate';
    seen.names.add(p.name.toLowerCase()); if (g) seen.gstins.add(g);
    return 'ok';
  }
  const it = built.item!;
  if (!seen.rates.has(it.defaultRateBp)) throw new ValidationError(`${it.defaultRateBp / 100}% is not a GST rate Kora allows.`, 'gst');
  if (seen.names.has(it.name.toLowerCase())) return 'duplicate';
  seen.names.add(it.name.toLowerCase());
  return 'ok';
}

function plan(kind: ImportKind, parsed: ReturnType<typeof read>, seen: Awaited<ReturnType<typeof existing>>) {
  const pool = { names: new Set(seen.names), gstins: new Set(seen.gstins), rates: seen.rates };
  return parsed.body.map((r) => {
    const name = unprotect((r.cells[parsed.mapped.name!] ?? '').trim());
    try {
      const built = build(kind, parsed.mapped, r.cells);
      const status = classify(kind, built, pool);
      return { line: r.line, name, status, message: status === 'duplicate' ? 'Already in Kora, so it is skipped.' : null, built } as ImportRow & { built: Built };
    } catch (e) {
      if (!isValidationError(e)) throw e;
      return { line: r.line, name, status: 'error' as const, message: e.message, built: {} } as ImportRow & { built: Built };
    }
  });
}

export async function previewImport(sql: Sql, t: TenantSession, kind: ImportKind, text: string): Promise<ImportPreview> {
  if (kind !== 'customers' && kind !== 'items') throw new ValidationError('Choose customers or items.', 'kind');
  const parsed = read(kind, text);
  const rows = plan(kind, parsed, await existing(sql, t, kind));
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  return {
    kind, columns: { mapped: Object.keys(parsed.mapped), ignored: parsed.ignored },
    counts: { total: rows.length, ok: count('ok'), duplicate: count('duplicate'), error: count('error') },
    rows: rows.map(({ built: _b, ...r }) => (void _b, r)),
  };
}

/** Creates the rows that are new and valid. Rows with a problem are left out and reported, not guessed at. */
export async function commitImport(sql: Sql, t: TenantSession, kind: ImportKind, text: string) {
  if (kind !== 'customers' && kind !== 'items') throw new ValidationError('Choose customers or items.', 'kind');
  const parsed = read(kind, text);
  const rows = plan(kind, parsed, await existing(sql, t, kind));
  let created = 0, failed = 0;
  const problems: { line: number; name: string; message: string }[] = rows.filter((r) => r.status === 'error').map((r) => ({ line: r.line, name: r.name, message: r.message! }));
  for (const r of rows) {
    if (r.status !== 'ok') continue;
    try {
      if (kind === 'customers') {
        const id = await createParty(sql, t, r.built.party!);
        if (r.built.extras && Object.keys(r.built.extras).length) await setPartyExtras(sql, t, id, r.built.extras);
      } else await createItem(sql, t, r.built.item!);
      created++;
    } catch (e) {
      if (!isValidationError(e)) throw e;
      failed++; problems.push({ line: r.line, name: r.name, message: e.message });
    }
  }
  const skipped = rows.filter((r) => r.status === 'duplicate').length;
  const out = { created, skipped, failed: failed + rows.filter((r) => r.status === 'error').length, problems: problems.sort((a, b) => a.line - b.line) };
  await inTenant(sql, t, kind === 'customers' ? 'party.write' : 'item.write', (tx) =>
    tx`insert into data_export (business_id, user_id, kind, detail) values (${t.businessId}, ${t.userId}, ${'import_' + kind}, ${tx.json({ created, skipped, failed: out.failed } as never)})`);
  return out;
}

/**
 * The file as the importer reads it: a CSV as it is, an Excel workbook (base64) turned into rows, or a Tally ledger export turned into customers.
 * Whatever arrives, it then goes through the same checks, so a spreadsheet gets the same preview and the same plain-words errors as a CSV.
 */
export function importTextFrom(input: { csv?: string; xlsxBase64?: string; tallyXml?: string }): string {
  if (input.xlsxBase64 !== undefined) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.xlsxBase64)) throw new ValidationError('The Excel file could not be read.', 'file');
    return rowsToCsv(readXlsx(Buffer.from(input.xlsxBase64, 'base64')));
  }
  if (input.tallyXml !== undefined) return parseTallyLedgers(input.tallyXml);
  return String(input.csv ?? '');
}
