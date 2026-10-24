import { renderDocumentHtml, sampleInput } from '@kora/pdf';

export const LOOKS: [string, string][] = [
  ['classic', 'Classic'],
  ['modern', 'Modern'],
  ['minimal', 'Minimal'],
  ['compact', 'Compact'],
];

/** The sample invoice for one look, as a full HTML document. The landing page loads it on demand instead of carrying all of them. */
export function invoiceSampleHtml(key: string): string | null {
  if (!LOOKS.some(([k]) => k === key)) return null;
  const input = sampleInput({ legal_name: 'Studio North · Sample business', state_code: '27', address: { line1: '24 Park Road', city: 'Pune', pincode: '411001' } }, { layout: key, accent: '#1268d3', showHsn: true });
  input.recipient = { name: 'Maple Works · Sample customer', billing_address: { line1: '18 Lake Road', city: 'Pune', pincode: '411004' } };
  input.doc.notes = 'Demonstration invoice. No payment is due.';
  input.doc.terms = 'Payment within 30 days of the invoice date.';
  input.lines = [ ['Brand consultation', 100000], ['Presentation design', 60000], ['Artwork preparation', 40000] ].map(([name, amount]) => ({ ...input.lines[0], item_name: name, hsn_sac: '9983', quantity: '1.000', unit: 'service', rate_paise: String(amount), taxable_paise: String(amount), cgst_paise: String(Number(amount) * .09), sgst_paise: String(Number(amount) * .09) }));
  return renderDocumentHtml(input);
}
