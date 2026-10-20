import { ValidationError } from './validation.js';

/**
 * Customers from a Tally ledger export (Masters, as XML). Only ledgers under Sundry Debtors become customers. The result is CSV text
 * with the headings the importer already knows, so it gets the same preview, duplicate check and plain-words errors as any other file.
 * This reads text only; it never runs anything from the file.
 */
const MAX_XML = 5_000_000;

const unescapeXml = (s: string) => s
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? unescapeXml(m[1]!.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() : '';
};

const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function parseTallyLedgers(xml: string): string {
  if (xml.length > MAX_XML) throw new ValidationError('The Tally file is larger than 5 MB. Export only the ledgers you need.', 'file');
  if (!/<LEDGER[\s>]/i.test(xml)) throw new ValidationError('No ledgers were found. In Tally choose Export, Masters, XML, and include the ledgers.', 'file');
  const rows: string[][] = [];
  for (const m of xml.matchAll(/<LEDGER\b([^>]*)>([\s\S]*?)<\/LEDGER>/gi)) {
    const body = m[2]!;
    if (!/sundry\s+debtors/i.test(tag(body, 'PARENT'))) continue;
    const name = unescapeXml(/\bNAME="([^"]*)"/i.exec(m[1]!)?.[1] ?? '') || tag(body, 'NAME');
    if (!name) continue;
    const lines = [...(/<ADDRESS\.LIST[^>]*>([\s\S]*?)<\/ADDRESS\.LIST>/i.exec(body)?.[1] ?? '').matchAll(/<ADDRESS[^>]*>([\s\S]*?)<\/ADDRESS>/gi)].map((a) => unescapeXml(a[1]!).trim()).filter(Boolean);
    rows.push([name, (tag(body, 'PARTYGSTIN') || tag(body, 'GSTIN')).toUpperCase(), tag(body, 'LEDSTATENAME') || tag(body, 'STATENAME'),
      tag(body, 'LEDGERMOBILE') || tag(body, 'LEDGERPHONE'), tag(body, 'EMAIL'), lines.join(', '), tag(body, 'PINCODE')]);
  }
  if (rows.length === 0) throw new ValidationError('The file has ledgers, but none are under Sundry Debtors. Only customers are imported from Tally.', 'file');
  return [['Name', 'GSTIN', 'State', 'Phone', 'Email', 'Address', 'Pincode'], ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
