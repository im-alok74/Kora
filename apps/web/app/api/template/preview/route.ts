import { getBusiness, sanitiseTemplate } from '@kora/core';
import { renderDocumentHtml } from '@kora/pdf';
import { tenantRoute } from '../../../../lib/server';

/** Renders a sample invoice with the template being edited, so changes show before saving. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const template = sanitiseTemplate(await req.json());
  const supplier = await getBusiness(sql, t);
  const html = renderDocumentHtml({
    doc: {
      doc_type: 'tax_invoice', status: 'issued', number: 'INV/26-27/0001', doc_date: '2026-10-18', due_date: '2026-11-17',
      place_of_supply: supplier.state_code, reverse_charge: false, taxable_paise: '200000', cgst_paise: '18000', sgst_paise: '18000',
      igst_paise: '0', cess_paise: '0', tcs_paise: '0', round_off_paise: '0', grand_total_paise: '236000',
      notes: 'Sample note', terms: 'Sample terms: payment within 30 days.',
    },
    lines: [{
      item_name: 'Sample item', hsn_sac: '8471', quantity: '2.000', unit: 'NOS', rate_paise: '100000', discount_paise: '0',
      taxable_paise: '200000', tax_rate_bp: 1800, cgst_paise: '18000', sgst_paise: '18000', igst_paise: '0', cess_paise: '0',
    }],
    supplier, recipient: { name: 'Sample Customer', gstin: null, billing_address: { line1: '1 Sample Street', city: 'Pune' } }, template,
  });
  return { html };
});
