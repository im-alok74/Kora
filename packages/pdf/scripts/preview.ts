// Writes a sample invoice to HTML so the layout can be looked at. Usage: pnpm exec tsx scripts/preview.ts out.html
import { writeFileSync } from 'node:fs';
import { renderDocumentHtml } from '../src/index.js';

const lines = [
  ['Monthly retainer, accounts and GST returns', '998221', '1', 'MON', 1200000, 0, 1800],
  ['Cabling work, 24 port patch panel installation with labelling', '995463', '2', 'NOS', 225000, 5000, 1800],
  ['Printed stationery', '4820', '40', 'PCS', 1250, 0, 1200],
].map(([name, hsn, q, unit, rate, disc, bp]) => {
  const taxable = Math.round(Number(q) * Number(rate)) - Number(disc);
  const tax = Math.round((taxable * Number(bp)) / 10000);
  return { item_name: name, hsn_sac: hsn, quantity: q, unit, rate_paise: String(rate), discount_paise: String(disc), taxable_paise: String(taxable),
    tax_rate_bp: bp, cgst_paise: String(tax / 2), sgst_paise: String(tax / 2), igst_paise: '0', cess_paise: '0', line_total_paise: String(taxable + tax) };
});
const taxable = lines.reduce((a, l) => a + Number(l.taxable_paise), 0);
const half = lines.reduce((a, l) => a + Number(l.cgst_paise), 0);
const out = renderDocumentHtml({
  doc: { doc_type: 'tax_invoice', status: 'issued', number: 'INV/26-27/0042', doc_date: '2026-10-18', due_date: '2026-11-17', place_of_supply: '27',
    reverse_charge: false, taxable_paise: String(taxable), cgst_paise: String(half), sgst_paise: String(half), igst_paise: '0', cess_paise: '0', tcs_paise: '0',
    round_off_paise: '0', grand_total_paise: String(taxable + 2 * half), notes: 'Thank you for your business.', terms: 'Payment due within 30 days. Interest at 18% a year on late payment.' },
  lines,
  supplier: { legal_name: 'Kapoor and Sons Services LLP', trade_name: 'Kapoor Services', gstin: '27AAPFU0939F1ZV', state_code: '27',
    address: { line1: '14 Gokhale Road, Shivaji Nagar', city: 'Pune', pincode: '411005' }, phone: '98765 43210', email: 'accounts@kapoorservices.in',
    bank_details: { accountName: 'Kapoor and Sons Services LLP', accountNumber: '50200012345678', ifsc: 'HDFC0001234', bankName: 'HDFC Bank, Pune' }, upi_vpa: 'kapoor@okhdfc' },
  recipient: { name: 'Mehta Textiles Pvt Ltd', gstin: '27AABCM1234F1Z5', billing_address: { line1: '221 Textile Market', city: 'Mumbai', pincode: '400002' }, phone: '99887 76655',
    shipping_address: { line1: 'Godown 4, Bhiwandi Road', city: 'Thane', pincode: '421302' } },
  upi: { qrDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', vpa: 'kapoor@okhdfc', amountText: 'Rs 19,971.00' },
  template: { accent: '#0b5d4f', font: 'sans', layout: 'classic', paper: 'A4', logoDataUrl: null, showBank: true, showTerms: true, showNotes: true, showSignature: true,
    showAmountInWords: true, footerText: 'Subject to Pune jurisdiction. This is a computer generated invoice.' },
});
writeFileSync(process.argv[2] ?? 'preview.html', out);
