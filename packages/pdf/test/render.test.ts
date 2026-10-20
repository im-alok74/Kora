import { afterAll, describe, expect, it } from 'vitest';
import { closePdfBrowser, esc, paperFor, renderDocumentHtml, renderPdf, type RenderInput } from '../src/index.js';

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
  it('prints extra details and the salesperson under the header, escaped', () => {
    const h = renderDocumentHtml(sample({}, { salesperson: 'Asha', extra: [{ label: 'Vehicle no.', value: 'MH12 <i>AB</i>' }, { label: 'Project', value: 'P-9' }] }));
    expect(h).toContain('>Salesperson<');
    expect(h).toContain('Asha');
    expect(h).toContain('Vehicle no.');
    expect(h).toContain('MH12 &lt;i&gt;AB&lt;/i&gt;');
    expect(h).toContain('class="meta4 extra"');
    const plain = renderDocumentHtml(sample());
    expect(plain).not.toContain('class="meta4 extra"');
    expect(plain).not.toContain('>Salesperson<');
  });

  it('prints the order reference and the subject when there are some, and nothing when there are not', () => {
    const h = renderDocumentHtml(sample({}, { reference: 'PO-7781', subject: 'Website <b>redesign</b>' }));
    expect(h).toContain('PO-7781');
    expect(h).toContain('Website &lt;b&gt;redesign&lt;/b&gt;');                 // escaped, never raw HTML
    expect(h).toContain('>Reference<');
    const plain = renderDocumentHtml(sample());
    expect(plain).not.toContain('>Reference<');
    expect(plain).not.toContain('class="subj"');
  });

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

describe('languages, receipts and prices that include GST', () => {
  it('prints the fixed words in Hindi, with the English title beside it, and leaves statutory terms alone', () => {
    const h = renderDocumentHtml(sample({ template: { ...TEMPLATE, language: 'hi' } }));
    expect(h).toContain('कर चालान / Tax Invoice');
    expect(h).toContain('बिल प्राप्तकर्ता');
    expect(h).toContain('आपूर्ति का स्थान');
    expect(h).toContain('देय तिथि');
    for (const kept of ['GSTIN:', 'HSN/SAC', 'CGST', 'SGST', '27AAPFU0939F1ZV', '1,180.00']) expect(h).toContain(kept);
    expect(h).not.toContain('>Bill to<');
    expect(renderDocumentHtml(sample({ template: { ...TEMPLATE, language: 'gu' } }))).toContain('કર ઇન્વૉઇસ / Tax Invoice');
    expect(renderDocumentHtml(sample({ template: { ...TEMPLATE, language: 'mr' } }))).toContain('कर बीजक / Tax Invoice');
    expect(renderDocumentHtml(sample({ template: { ...TEMPLATE, language: 'xx' } }))).toContain('Tax Invoice');   // unknown falls back to English
  });
  it('marks a line whose price already includes GST', () => {
    const base = sample();
    const h = renderDocumentHtml({ ...base, lines: [{ ...base.lines[0]!, price_includes_tax: true }] });
    expect(h).toContain('incl. GST');
    expect(renderDocumentHtml(sample())).not.toContain('incl. GST');
  });
  it('lays out an 80 mm receipt with the tax split by rate, and every statutory field', () => {
    const base = sample({ template: { ...TEMPLATE, layout: 'thermal' } });
    const lines = [base.lines[0]!, { ...base.lines[0]!, item_name: 'Biscuits', tax_rate_bp: 500, quantity: '2.000', rate_paise: '2000', taxable_paise: '4000', cgst_paise: '100', sgst_paise: '100', line_total_paise: '4200', hsn_sac: '1905' }];
    const h = renderDocumentHtml({ ...base, lines });
    expect(h).toContain('size: 80mm auto');
    for (const needle of ['Acme Traders', 'GSTIN: 27AAPFU0939F1ZV', 'Tax Invoice', 'INV/26-27/0001', '2026-10-18', 'Widget', 'Biscuits', '8471', '18%', '5%', 'CGST + SGST', '1,180.00', 'Thank you']) expect(h).toContain(needle);
    expect(h).toContain('2 NOS x 20.00');                                   // quantity times rate
    expect(h).not.toContain('<th>Description</th>');                         // no wide table
  });
  it('a receipt with a footer, in another language, for a bill of supply, still renders every part', () => {
    const base = sample({ template: { ...TEMPLATE, layout: 'thermal', language: 'hi', footerText: 'Exchange within 7 days' } }, { doc_type: 'bill_of_supply', status: 'draft' });
    const h = renderDocumentHtml(base);
    expect(h).toContain('Exchange within 7 days');
    expect(h).toContain('DRAFT');
    expect(h).toContain('आपूर्ति का बिल / Bill of Supply');
    expect(h).not.toContain('CGST + SGST');                                   // a bill of supply shows no tax split
  });
  it('picks the roll for a receipt layout and a normal page otherwise', () => {
    expect(paperFor({ layout: 'thermal', paper: 'A4' })).toBe('THERMAL');
    expect(paperFor({ layout: 'classic', paper: 'A5' })).toBe('A5');
    expect(paperFor(undefined)).toBe('A4');
  });
  it('makes a narrow, short PDF for a receipt', async () => {
    const pdf = await renderPdf(renderDocumentHtml(sample({ template: { ...TEMPLATE, layout: 'thermal' } })), 'THERMAL');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const mb = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString('latin1'));
    expect(mb).not.toBeNull();
    const [w, hgt] = [Number(mb![1]) / 2.8346, Number(mb![2]) / 2.8346];      // points to millimetres
    expect(w).toBeGreaterThan(78); expect(w).toBeLessThan(82);
    expect(hgt).toBeGreaterThan(60); expect(hgt).toBeLessThan(250);
  }, 60_000);
});
