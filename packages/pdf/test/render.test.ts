import { afterAll, describe, expect, it } from 'vitest';
import { closePdfBrowser, esc, renderDocumentHtml, renderPdf, type RenderInput } from '../src/index.js';

const TEMPLATE = { accent: '#0b5d4f', font: 'sans', layout: 'classic', paper: 'A4', logoDataUrl: null, showBank: true, showTerms: true,
  showNotes: true, showSignature: true, showAmountInWords: true, footerText: '' };

function sample(over: Partial<RenderInput> = {}, docOver: Record<string, any> = {}): RenderInput {
  return {
    doc: { doc_type: 'tax_invoice', status: 'issued', number: 'INV/26-27/0001', doc_date: '2026-10-18', due_date: '2026-11-17', place_of_supply: '27',
      reverse_charge: false, taxable_paise: '100000', cgst_paise: '9000', sgst_paise: '9000', igst_paise: '0', cess_paise: '0', tcs_paise: '0',
      round_off_paise: '0', grand_total_paise: '118000', notes: 'Thank you', terms: 'Net 30', ...docOver },
    lines: [{ item_name: 'Widget', hsn_sac: '8471', quantity: '1.000', unit: 'NOS', rate_paise: '100000', discount_paise: '0', taxable_paise: '100000',
      tax_rate_bp: 1800, cgst_paise: '9000', sgst_paise: '9000', igst_paise: '0', cess_paise: '0' }],
    supplier: { legal_name: 'Acme Traders', gstin: '27AAPFU0939F1ZV', state_code: '27', address: { line1: '1 Main Road', city: 'Pune', pincode: '411001' },
      phone: '9876543210', bank_details: { accountName: 'Acme', accountNumber: '1234567890', ifsc: 'HDFC0001234' }, upi_vpa: 'acme@okhdfc' },
    recipient: { name: 'Local Buyer', gstin: null, billing_address: { line1: '5 Lane' } },
    template: TEMPLATE, ...over,
  };
}

afterAll(async () => { await closePdfBrowser(); });

describe('renderDocumentHtml', () => {
  it('prints every statutory field', () => {
    const h = renderDocumentHtml(sample());
    for (const needle of ['Tax Invoice', 'INV/26-27/0001', '2026-10-18', 'GSTIN:</b> 27AAPFU0939F1ZV', 'Maharashtra (27)', '8471',
      'CGST', 'SGST', '1,180.00', 'Rupees One Thousand One Hundred Eighty Only', 'Acme Traders', 'Local Buyer']) expect(h).toContain(needle);
  });
  it('the professional services layout drops quantity and rate but keeps every statutory field', () => {
    const h = renderDocumentHtml(sample({ template: { ...TEMPLATE, layout: 'narrative' } }, { notes: 'Matter: CS-102/2026' }));
    expect(h).toContain('Particulars of professional services');
    expect(h).toContain('<th>SAC</th>');
    expect(h).toContain('<th class="n">Fee</th>');
    expect(h).not.toContain('<th class="n">Qty</th>');
    expect(h).not.toContain('<th class="n">Rate</th>');
    for (const needle of ['Tax Invoice', 'INV/26-27/0001', 'GSTIN:</b> 27AAPFU0939F1ZV', 'Maharashtra (27)', 'CGST', 'SGST', 'Taxable value', '1,180.00', 'Matter: CS-102/2026']) expect(h).toContain(needle);
    const row = h.match(/<tbody>(.*?)<\/tbody>/s)![1]!;
    expect((row.match(/<td/g) ?? []).length).toBe(4 + 2);   // number, particulars, SAC, fee, CGST, SGST
  });
  it('the template cannot remove statutory fields', () => {
    const t = { ...TEMPLATE, showBank: false, showTerms: false, showNotes: false, showSignature: false, showAmountInWords: false };
    const h = renderDocumentHtml(sample({ template: t }));
    expect(h).toContain('27AAPFU0939F1ZV');
    expect(h).toContain('Maharashtra (27)');
    expect(h).toContain('HSN/SAC');
    expect(h).toContain('Taxable value');
    expect(h).not.toContain('Net 30');
    expect(h).not.toContain('A/c no');
  });
  it('inter-state shows IGST only; bill of supply shows no tax columns', () => {
    const inter = renderDocumentHtml(sample({}, { place_of_supply: '29', cgst_paise: '0', sgst_paise: '0', igst_paise: '18000' }));
    expect(inter).toContain('<th class="n">IGST</th>');
    expect(inter).not.toContain('<th class="n">CGST</th>');
    const bos = renderDocumentHtml(sample({}, { doc_type: 'bill_of_supply', cgst_paise: '0', sgst_paise: '0', grand_total_paise: '100000' }));
    expect(bos).toContain('Bill of Supply');
    expect(bos).not.toContain('<th class="n">CGST</th>');
  });
  it('states reverse charge and relabels the total', () => {
    const h = renderDocumentHtml(sample({}, { reverse_charge: true, grand_total_paise: '100000' }));
    expect(h).toContain('Tax is payable on reverse charge.');
    expect(h).toContain('Amount due');
  });
  it('marks drafts and cancelled documents', () => {
    expect(renderDocumentHtml(sample({}, { status: 'draft', number: null }))).toContain('>DRAFT<');
    expect(renderDocumentHtml(sample({}, { status: 'cancelled' }))).toContain('>CANCELLED<');
  });
  it('escapes everything a user can type', () => {
    const evil = '<script>alert(1)</script>"\'&';
    const i = sample();
    i.lines[0]!.item_name = evil; i.recipient!.name = evil; i.doc.notes = evil; i.supplier.legal_name = evil;
    i.template = { ...TEMPLATE, footerText: evil, accent: 'red;}</style><script>x</script>' };
    const h = renderDocumentHtml(i);
    expect(h).not.toContain('<script>');
    expect(h).toContain('&lt;script&gt;');
    expect(h).toContain('#0b5d4f'); // bad accent falls back to the default
    expect(esc(`a"b`)).toBe('a&quot;b');
  });
  it('refuses a logo that is not a PNG or JPEG data URL', () => {
    const h = renderDocumentHtml(sample({ template: { ...TEMPLATE, logoDataUrl: 'https://evil.example/x.png' } }));
    expect(h).not.toContain('evil.example');
    const ok = renderDocumentHtml(sample({ template: { ...TEMPLATE, logoDataUrl: 'data:image/png;base64,AAAA' } }));
    expect(ok).toContain('class="logo"');
  });
  it('prints the IRN block only when there is one', () => {
    expect(renderDocumentHtml(sample())).not.toContain('IRN');
    expect(renderDocumentHtml(sample({ irn: { irn: 'abc123', ackNo: '1', ackDate: '2026-10-18' } }))).toContain('abc123');
  });
});

describe('renderPdf', () => {
  it('produces a PDF, A4 and A5', async () => {
    const a4 = await renderPdf(renderDocumentHtml(sample()), 'A4');
    expect(a4.subarray(0, 5).toString()).toBe('%PDF-');
    expect(a4.length).toBeGreaterThan(2000);
    const a5 = await renderPdf(renderDocumentHtml(sample({ template: { ...TEMPLATE, paper: 'A5' } })), 'A5');
    expect(a5.subarray(0, 5).toString()).toBe('%PDF-');
  }, 60_000);
  it('does not run scripts or fetch anything', async () => {
    const html = '<html><body><img src="http://127.0.0.1:9/x.png"><script>document.title="ran"</script>hello</body></html>';
    const pdf = await renderPdf(html);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  }, 60_000);
});
