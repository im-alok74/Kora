import { describe, expect, it } from 'vitest';
import { LAYOUTS, renderDocumentHtml, sampleInput } from '../src/index.js';

const supplier = { legal_name: 'Acme Traders', gstin: '27AAPFU0939F1ZV', state_code: '27', address: { line1: '1 Main Road', city: 'Pune' } };
const TPL = { accent: '#0b5d4f', font: 'sans', layout: 'classic', paper: 'A4', logoDataUrl: null, showBank: true, showTerms: true, showNotes: true,
  showSignature: true, showAmountInWords: true, footerText: '' };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('the looks', () => {
  it('offers at least ten looks to choose from', () => {
    expect(LAYOUTS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(LAYOUTS.map((l) => l.key)).size).toBe(LAYOUTS.length);
  });

  it.each(LAYOUTS.map((l) => l.key))('%s prints every statutory field', (key) => {
    const h = renderDocumentHtml(sampleInput(supplier, { ...TPL, layout: key }));
    for (const needle of ['Tax Invoice', 'INV/26-27/0001', 'GSTIN:</b> 27AAPFU0939F1ZV', 'Maharashtra (27)', key === 'narrative' ? 'SAC' : 'HSN/SAC', 'CGST', 'SGST', 'Rupees Two Thousand Three Hundred Sixty Only', 'Sample Customer']) {
      expect(h, `${key} lost ${needle}`).toContain(needle);
    }
  });

  it('the new looks are distinct from each other', () => {
    const css = new Set(['bold', 'elegant', 'ledger', 'corporate', 'soft', 'duo'].map((k) => renderDocumentHtml(sampleInput(supplier, { ...TPL, layout: k })).match(/<div class="page lay-(\w+)"/)![1]));
    expect(css.size).toBe(6);
  });

  it('applies the font, the logo size and the signature image', () => {
    const base = sampleInput(supplier, { ...TPL, font: 'mono', logoDataUrl: PNG, logoSize: 'large', signatureDataUrl: PNG });
    const h = renderDocumentHtml(base);
    expect(h).toContain('"Courier New"');
    expect(h).toContain('.logo{max-height:84px');
    expect(h).toContain(`<div class="sign"><img src="${PNG}"`);
    const without = renderDocumentHtml(sampleInput(supplier, TPL));
    expect(without).not.toContain('<div class="sign"><img');
    expect(without).toContain('.logo{max-height:58px');
  });

  it('never prints a signature that is not a PNG or JPEG data URL', () => {
    const h = renderDocumentHtml(sampleInput(supplier, { ...TPL, signatureDataUrl: 'javascript:alert(1)' }));
    expect(h).not.toContain('javascript:');
    expect(h).not.toContain('<div class="sign"><img');
  });

  it('prints the reason on a credit note, in the header block', () => {
    const input = sampleInput(supplier, TPL);
    input.doc = { ...input.doc, doc_type: 'credit_note', original_number: 'INV/26-27/0001', note_reason: 'goods_returned', note_reason_detail: '3 chairs <b>broken</b>' };
    const h = renderDocumentHtml(input);
    expect(h).toContain('>Reason<');
    expect(h).toContain('Goods returned: 3 chairs &lt;b&gt;broken&lt;/b&gt;');
  });
});

describe('custom fields on the page', () => {
  it('prints the document fields that are set to print, and the customer fields under the customer, escaped', () => {
    const input = sampleInput(supplier, TPL);
    input.doc = { ...input.doc, custom_values: [{ id: 'a', label: 'Project code', value: 'P-<9>', pdf: true }, { id: 'b', label: 'Site visit', value: '2026-11-01', pdf: false }] };
    input.recipient = { ...input.recipient!, custom_values: [{ id: 'c', label: 'Vendor code', value: 'V-204', pdf: true }] };
    const h = renderDocumentHtml(input);
    expect(h).toContain('Project code');
    expect(h).toContain('P-&lt;9&gt;');
    expect(h).not.toContain('Site visit');
    expect(h).toContain('Vendor code:</span> V-204');
  });
});
