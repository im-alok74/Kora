// Renders long and multi-language sample invoices to PDF so each look can be checked by eye. Usage: pnpm exec tsx scripts/fidelity.ts outdir
import { mkdirSync, writeFileSync } from 'node:fs';
import { closePdfBrowser, LAYOUTS, paperFor, renderDocumentHtml, renderPdf, sampleInput } from '../src/index.js';

const out = process.argv[2] ?? 'fidelity-out';
mkdirSync(out, { recursive: true });
const supplier = { legal_name: 'Kapoor and Sons Services LLP', trade_name: 'Kapoor Services', gstin: '27AAPFU0939F1ZV', state_code: '27', address: { line1: '14 Gokhale Road, Shivaji Nagar', city: 'Pune', pincode: '411005' }, phone: '98765 43210',
  bank_details: { accountName: 'Kapoor', accountNumber: '50200012345678', ifsc: 'HDFC0001234', bankName: 'HDFC Bank' }, upi_vpa: 'kapoor@okhdfc' };
const base = { accent: '#0b5d4f', font: 'sans', layout: 'classic', paper: 'A4', logoDataUrl: null, showBank: true, showTerms: true, showNotes: true, showSignature: true, showAmountInWords: true, footerText: 'Subject to Pune jurisdiction.' };

function long(layout: string, language: string, n: number) {
  const input = sampleInput(supplier, { ...base, layout, language });
  const line = (i: number) => ({ item_name: `Item number ${i + 1} with a reasonably long description to wrap the line`, hsn_sac: '8471', quantity: '2.000', unit: 'NOS', rate_paise: '100000', discount_paise: '0',
    taxable_paise: '200000', tax_rate_bp: 1800, cgst_paise: '18000', sgst_paise: '18000', igst_paise: '0', cess_paise: '0', line_total_paise: '236000' });
  input.lines = Array.from({ length: n }, (_, i) => line(i));
  const tot = BigInt(n) * 200000n, tax = BigInt(n) * 18000n;
  input.doc = { ...input.doc, taxable_paise: String(tot), cgst_paise: String(tax), sgst_paise: String(tax), grand_total_paise: String(tot + 2n * tax) };
  return input;
}
const pages = (b: Buffer) => (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

for (const l of [...LAYOUTS.map((x) => x.key), 'thermal']) {
  for (const [lang, n] of [['en', 70], ['en', 3]] as const) {
    const input = long(l, lang, n);
    const pdf = await renderPdf(renderDocumentHtml(input), paperFor(input.template));
    writeFileSync(`${out}/${l}-${lang}-${n}.pdf`, pdf);
    console.log(l.padEnd(10), lang, String(n).padStart(3), 'lines ->', pages(pdf), 'page(s)');
  }
}
for (const lang of ['hi', 'mr', 'gu']) {
  const input = long('classic', lang, 3);
  writeFileSync(`${out}/lang-${lang}.pdf`, await renderPdf(renderDocumentHtml(input), 'A4'));
}
await closePdfBrowser();
