import { crc32 } from 'node:zlib';

/**
 * Two small file writers, so exports need no extra libraries: a ZIP (files stored, not compressed) and an XLSX workbook
 * (a ZIP of XML parts). Both are written to be opened by Excel, LibreOffice and Google Sheets.
 */

// ---------------------------------------------------------------- zip
export interface ZipEntry { name: string; data: Buffer | string }

/** A ZIP file with the given entries, stored without compression. Names are UTF-8. */
export function makeZip(entries: ZipEntry[], now = new Date()): Buffer {
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = (((now.getFullYear() - 1980) & 0x7f) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt16LE(dosTime, 12); c.writeUInt16LE(dosDate, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += local.length + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

// ---------------------------------------------------------------- xlsx
export interface SheetColumn { key: string; label: string; /** paise as a string, written as a number with two decimals */ money?: boolean }
export interface Sheet { name: string; columns: SheetColumn[]; rows: Record<string, unknown>[] }

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Characters XML 1.0 cannot hold are dropped, so one odd byte in a customer name cannot make the whole file unreadable. */
export const xmlText = (s: string) => xmlEscape(s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, ''));
const colLetter = (i: number) => { let n = i + 1, s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };
const money = (p: unknown) => { const n = BigInt(String(p)); const neg = n < 0n; const a = neg ? -n : n; return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`; };

/** Sheet names: at most 31 characters, none of []:*?/\ , not empty, and unique within the workbook. */
export function sheetName(raw: string, taken: Set<string>): string {
  let base = raw.replace(/[\[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Sheet';
  let name = base, i = 2;
  while (taken.has(name.toLowerCase())) { const suffix = ` ${i++}`; name = base.slice(0, 31 - suffix.length) + suffix; }
  taken.add(name.toLowerCase());
  return name;
}

function sheetXml(s: Sheet): string {
  const rows: string[] = [];
  const header = s.columns.map((c, i) => `<c r="${colLetter(i)}1" t="inlineStr" s="1"><is><t>${xmlText(c.label)}</t></is></c>`).join('');
  rows.push(`<row r="1">${header}</row>`);
  s.rows.forEach((r, ri) => {
    const cells = s.columns.map((c, ci) => {
      const v = r[c.key];
      if (v === null || v === undefined || v === '') return '';
      const ref = `${colLetter(ci)}${ri + 2}`;
      // Text goes in as a string cell, never as a formula, so a customer named =HYPERLINK(...) stays plain text.
      if (c.money) return `<c r="${ref}" s="2"><v>${money(v)}</v></c>`;
      const text = String(v);
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
    }).join('');
    rows.push(`<row r="${ri + 2}">${cells}</row>`);
  });
  const widths = s.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(40, Math.max(10, c.label.length + 4))}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + `<cols>${widths}</cols><sheetData>${rows.join('')}</sheetData></worksheet>`;
}

/** An .xlsx workbook with one sheet per dataset: a bold frozen header row, money as real numbers with two decimals. */
export function makeXlsx(sheets: Sheet[]): Buffer {
  if (sheets.length === 0) throw new Error('A workbook needs at least one sheet.');
  const taken = new Set<string>();
  const names = sheets.map((s) => sheetName(s.name, taken));
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files: ZipEntry[] = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets>`
      + names.map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + `</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="${NS}">`
      + `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>`
      + `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>`
      + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
      + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
      + `<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
      + `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>`
      + `<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  return makeZip(files);
}

/** Reads a stored ZIP back into its entries. For tests and for verifying what we write; not a general unzip. */
export function readStoredZip(buf: Buffer): { name: string; data: Buffer }[] {
  const out: { name: string; data: Buffer }[] = [];
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('Not a ZIP file.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad ZIP directory.');
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (method !== 0) throw new Error('Only stored entries are supported.');
    const lNameLen = buf.readUInt16LE(lho + 26), lExtraLen = buf.readUInt16LE(lho + 28);
    const data = buf.subarray(lho + 30 + lNameLen + lExtraLen, lho + 30 + lNameLen + lExtraLen + size);
    if (crc32(data) !== crc) throw new Error(`Checksum mismatch in ${name}.`);
    out.push({ name, data: Buffer.from(data) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
