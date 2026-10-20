import { inflateRawSync } from 'node:zlib';
import { ValidationError } from './validation.js';

/**
 * Reads the first sheet of an .xlsx workbook into rows of text, so a spreadsheet can be imported without saving it as CSV first.
 * Only what an import needs: text, numbers, booleans and dates. Formulas are read as the value Excel last stored, never evaluated.
 * The file is untrusted: size, entry count and output are all capped before anything is expanded.
 */
const MAX_FILE = 10 * 1024 * 1024;
const MAX_ENTRY = 30 * 1024 * 1024;
const MAX_ENTRIES = 500;
const MAX_ROWS = 5000;
const MAX_COLS = 200;

interface Entry { method: number; compressed: number; size: number; offset: number }

function entriesOf(buf: Buffer): Map<string, Entry> {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new ValidationError('This does not look like an Excel (.xlsx) file. Save it as .xlsx, or as CSV, and try again.', 'file');
  const count = buf.readUInt16LE(end + 10);
  if (count > MAX_ENTRIES) throw new ValidationError('This Excel file has too many parts to be an ordinary spreadsheet.', 'file');
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, Entry>();
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ValidationError('The Excel file is damaged.', 'file');
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    out.set(name, { method: buf.readUInt16LE(p + 10), compressed: buf.readUInt32LE(p + 20), size: buf.readUInt32LE(p + 24), offset: buf.readUInt32LE(p + 42) });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

function read(buf: Buffer, e: Entry): string {
  if (e.size > MAX_ENTRY) throw new ValidationError('A part of this Excel file is far larger than a spreadsheet should be.', 'file');
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== 0x04034b50) throw new ValidationError('The Excel file is damaged.', 'file');
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const raw = buf.subarray(start, start + e.compressed);
  if (e.method === 0) return raw.toString('utf8');
  if (e.method !== 8) throw new ValidationError('This Excel file uses a compression Kora does not read. Save it again from Excel as .xlsx.', 'file');
  try { return inflateRawSync(raw, { maxOutputLength: MAX_ENTRY }).toString('utf8'); }
  catch { throw new ValidationError('The Excel file is damaged or too large.', 'file'); }
}

const unescapeXml = (s: string) => s
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** All the text in a fragment, joining rich-text runs. */
const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]!)).join('');

const colIndex = (ref: string) => { let n = 0; for (const ch of /^[A-Z]+/.exec(ref)?.[0] ?? '') n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** Excel's day count (1900 system, with its famous leap-year slip) as YYYY-MM-DD. */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const days = Math.floor(serial) - (serial >= 61 ? 1 : 0);
  const at = new Date(Date.UTC(1899, 11, 31) + days * 86_400_000);
  return at.toISOString().slice(0, 10);
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function dateStyles(styles: string | null): Set<number> {
  const out = new Set<number>();
  if (!styles) return out;
  const custom = new Set<number>();
  for (const m of styles.matchAll(/<numFmt\s[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    const code = unescapeXml(m[2]!).replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    if (/[dmyhs]/i.test(code) && !/^0|#/.test(code)) custom.add(Number(m[1]));
  }
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  [...xfs.matchAll(/<xf\s[^>]*?numFmtId="(\d+)"/g)].forEach((m, i) => { const id = Number(m[1]); if (BUILTIN_DATE_FORMATS.has(id) || custom.has(id)) out.add(i); });
  return out;
}

export function readXlsx(buf: Buffer): string[][] {
  if (buf.length > MAX_FILE) throw new ValidationError('The Excel file is larger than 10 MB. Split it into smaller files.', 'file');
  const parts = entriesOf(buf);
  const get = (name: string) => { const e = parts.get(name); return e ? read(buf, e) : null; };
  const wb = get('xl/workbook.xml');
  if (!wb) throw new ValidationError('This does not look like an Excel (.xlsx) file. Save it as .xlsx, or as CSV, and try again.', 'file');
  const rels = get('xl/_rels/workbook.xml.rels') ?? '';
  const first = /<sheet\s[^>]*?r:id="([^"]+)"/.exec(wb)?.[1];
  const relTarget = first ? [...rels.matchAll(/<Relationship\s[^>]*>/g)].map((m) => m[0]).find((r) => new RegExp(`Id="${first}"`).test(r)) : undefined;
  const target = relTarget ? /Target="([^"]+)"/.exec(relTarget)?.[1] : undefined;
  const sheetPath = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`) : 'xl/worksheets/sheet1.xml';
  const sheet = get(sheetPath);
  if (!sheet) throw new ValidationError('The first sheet of the Excel file could not be found.', 'file');

  const sst = get('xl/sharedStrings.xml');
  const shared = sst ? [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!)) : [];
  const dates = dateStyles(get('xl/styles.xml'));

  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*?(?:\sr="(\d+)")?[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowIndex = rm[1] ? Number(rm[1]) - 1 : rows.length;
    if (rowIndex >= MAX_ROWS) throw new ValidationError(`The sheet has more than ${MAX_ROWS} rows. Split it into smaller files.`, 'file');
    const cells: string[] = [];
    for (const cm of rm[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]!, body = cm[2] ?? '';
      const ref = /\sr="([A-Z]+\d+)"/.exec(` ${attrs}`)?.[1];
      const col = ref ? colIndex(ref) : cells.length;
      if (col >= MAX_COLS) throw new ValidationError('The sheet has more than 200 columns. Is it a spreadsheet of a list?', 'file');
      const type = /\st="([^"]+)"/.exec(` ${attrs}`)?.[1];
      const style = Number(/\ss="(\d+)"/.exec(` ${attrs}`)?.[1] ?? -1);
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let text = '';
      if (type === 's') text = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') text = textOf(body);
      else if (type === 'b') text = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) {
        text = unescapeXml(v);
        if (type !== 'str' && dates.has(style)) text = excelSerialToIso(Number(text)) ?? text;
      }
      while (cells.length < col) cells.push('');
      cells[col] = text;
    }
    while (rows.length < rowIndex) rows.push([]);
    rows[rowIndex] = cells;
  }
  while (rows.length && rows[rows.length - 1]!.every((c) => c === '')) rows.pop();
  return rows;
}

/** Rows as CSV text, so a spreadsheet can go through the same reading and checking as a CSV file. */
export function rowsToCsv(rows: string[][]): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
