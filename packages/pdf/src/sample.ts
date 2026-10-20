import { renderDocumentHtml, type RenderInput } from './render.js';

/** The looks a business can choose from, with a line on what each is for. The thermal receipt is chosen per document, not here. */
export const LAYOUTS: { key: string; label: string; about: string }[] = [
  { key: 'classic', label: 'Classic', about: 'A colour bar, bordered blocks and a filled total. The default.' },
  { key: 'modern', label: 'Modern', about: 'A solid colour header and table heading. Bold, for a brand that wants to be seen.' },
  { key: 'minimal', label: 'Minimal', about: 'Black and white with fine lines. Prints cleanly on any printer.' },
  { key: 'compact', label: 'Compact', about: 'Smaller type and tighter spacing, for invoices with many lines.' },
  { key: 'narrative', label: 'Professional fees', about: 'Particulars and a single fee column, for lawyers and consultants.' },
];

/** A sample invoice drawn with the given look, the business's own details and its template settings. */
export function sampleInput(supplier: Record<string, any>, template: RenderInput['template']): RenderInput {
  return {
    doc: {
      doc_type: 'tax_invoice', status: 'issued', number: 'INV/26-27/0001', doc_date: '2026-10-18', due_date: '2026-11-17',
      place_of_supply: supplier.state_code, reverse_charge: false, taxable_paise: '200000', cgst_paise: '18000', sgst_paise: '18000',
      igst_paise: '0', cess_paise: '0', tcs_paise: '0', round_off_paise: '0', grand_total_paise: '236000',
      notes: 'Sample note', terms: 'Sample terms: payment within 30 days.', reference: 'PO-2041',
    },
    lines: [{
      item_name: 'Sample item', hsn_sac: '8471', quantity: '2.000', unit: 'NOS', rate_paise: '100000', discount_paise: '0',
      taxable_paise: '200000', tax_rate_bp: 1800, cgst_paise: '18000', sgst_paise: '18000', igst_paise: '0', cess_paise: '0',
    }],
    supplier, recipient: { name: 'Sample Customer', gstin: null, billing_address: { line1: '1 Sample Street', city: 'Pune' } }, template,
  };
}

export const renderSample = (supplier: Record<string, any>, template: RenderInput['template']) => renderDocumentHtml(sampleInput(supplier, template));
