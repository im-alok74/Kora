import { describe, expect, it } from 'vitest';
import { renderStatementHtml, type StatementInput } from '../src/index.js';

const base: StatementInput = {
  supplier: { legal_name: 'Acme Traders Pvt Ltd', trade_name: 'Acme', gstin: '27AAPFU0939F1ZV', phone: '9800000000', address: { line1: '1 Main Road', city: 'Pune', pincode: '411001' } },
  customer: { name: 'Asha <Stores>', gstin: null },
  from: '2026-04-01', to: '2026-10-22', opening: '0', closing: '118000',
  rows: [
    { date: '2026-09-01', description: 'Tax invoice INV/0001', debit: '236000', credit: '0', balance: '236000' },
    { date: '2026-09-20', description: 'Payment (upi)', debit: '0', credit: '118000', balance: '118000' },
  ],
  ageing: { not_due: '0', d1_30: '118000', d31_60: '0', d61_90: '0', d90_plus: '0' },
};

describe('statement page', () => {
  it('shows the entries, the amount due and the ageing, and escapes what the customer name holds', () => {
    const h = renderStatementHtml(base);
    expect(h).toContain('Statement of Account');
    expect(h).toContain('Tax invoice INV/0001');
    expect(h).toContain('Amount due');
    expect(h).toContain('1,180.00');
    expect(h).toContain('1 to 30 days late');
    expect(h).toContain('Asha &lt;Stores&gt;');
    expect(h).not.toContain('<Stores>');
  });
  it('says so when the customer is in credit or owes nothing', () => {
    expect(renderStatementHtml({ ...base, closing: '-5000' })).toContain('Credit in your favour');
    expect(renderStatementHtml({ ...base, closing: '0' })).toContain('Nothing due');
  });
});
