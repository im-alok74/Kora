import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatMoney, parseExchangeRate } from '@kora/tax';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  convertEstimate, createBusiness, createParty, getDocument, issueDocument, listParties, messageText, previewTotals, resolveTenant, saveDraft,
  ValidationError, type DocIn, type TenantSession,
} from '../src/index.js';

describe('money in other currencies', () => {
  it('formats with a code and thousands grouping, and rupees as before', () => {
    expect(formatMoney(11859n, 'USD')).toBe('USD 118.59');
    expect(formatMoney(123456789n, 'EUR')).toBe('EUR 1,234,567.89');
    expect(formatMoney(-5n, 'GBP')).toBe('-GBP 0.05');
    expect(formatMoney(123456789n, 'INR')).toBe('Rs 12,34,567.89');
    expect(formatMoney(100000n)).toBe('Rs 1,000.00');
  });
  it('reads an exchange rate to six decimals and refuses anything else', () => {
    expect(parseExchangeRate('83.25')).toBe(83_250_000n);
    expect(parseExchangeRate('1')).toBe(1_000_000n);
    expect(parseExchangeRate('0.000001')).toBe(1n);
    expect(parseExchangeRate('104.123456')).toBe(104_123_456n);
    for (const bad of ['', 'abc', '0', '0.0', '-1', '1e3', '1,5', '83.1234567', '1234567']) expect(() => parseExchangeRate(bad)).toThrow();
  });
  it('words a foreign message in its own currency', () => {
    const m = messageText({ label: 'Estimate', number: 'EST/26-27/0001', total: 11859n, currency: 'USD', from: 'Acme', url: 'http://x/i/t' });
    expect(m).toContain('USD 118.59');
    expect(m).not.toContain('Rs');
    expect(messageText({ label: 'Tax invoice', number: 'INV/1', total: 118000n, from: 'Acme', url: 'u' })).toContain('Rs 1,180.00');
  });
});

describe('estimates and proforma invoices in another currency', () => {
  let db: TestDb;
  let owner: TenantSession;
  let domestic: string, abroad: string;
  const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
  const line = (rate = '100.50', over = {}) => ({ name: 'Design work', hsnSac: '998391', quantity: '1', rate, taxRateBp: 1800, kind: 'service' as const, ...over });
  const quote = (over: Partial<DocIn> = {}): DocIn => ({ docType: 'estimate', partyId: abroad, currency: 'USD', exchangeRate: '83.25', lines: [line()], ...over });

  beforeAll(async () => {
    db = await makeTestDb();
    const [u] = await db.owner`insert into app_user (email) values ('o@example.test') returning id`;
    const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
    owner = await resolveTenant(db.web, u!.id as string, bid);
    domestic = await createParty(db.web, owner, { kind: 'customer', name: 'Mumbai Studio', stateCode: '27', currency: 'USD' });
    abroad = await createParty(db.web, owner, { kind: 'customer', name: 'Berlin GmbH', stateCode: '96', currency: 'EUR' });
  }, 60_000);
  afterAll(async () => { await db?.drop(); });

  it('keeps the exact total, with no rounding to a whole unit, and stores the currency and rate', async () => {
    const p = await previewTotals(db.web, owner, quote());
    expect(p).toMatchObject({ currency: 'USD', grandTotal: '11859', roundOff: '0', placeOfSupply: '96' });   // 100.50 + 18% = 118.59, not 119
    const { id } = await saveDraft(db.web, owner, quote({ currency: 'usd' }));                                 // lower case is accepted
    expect((await getDocument(db.web, owner, id))!.document).toMatchObject({ currency: 'USD', exchange_rate_micro: '83250000', grand_total_paise: '11859', round_off_paise: '0', place_of_supply: '96' });
    expect(await fails(previewTotals(db.web, owner, { ...quote(), currency: 'INR' }))).toBeInstanceOf(ValidationError);   // in rupees, an overseas customer is an export
  });

  it('is refused for a tax invoice, a bill of supply, an unknown currency, or a missing or bad rate', async () => {
    for (const docType of ['tax_invoice', 'bill_of_supply', 'delivery_challan'] as const) {
      expect((await fails(saveDraft(db.web, owner, quote({ docType, partyId: domestic })))).message).toMatch(/always in rupees/);
    }
    expect(await fails(saveDraft(db.web, owner, quote({ currency: 'XYZ' })))).toBeInstanceOf(ValidationError);
    for (const exchangeRate of [undefined, '', '0', 'abc', '83.1234567']) {
      expect(await fails(saveDraft(db.web, owner, quote({ exchangeRate })))).toBeInstanceOf(ValidationError);
    }
    expect((await saveDraft(db.web, owner, quote({ docType: 'proforma' }))).id).toBeTruthy();                  // proforma is allowed
  });

  it('still refuses an export in rupees, and a database rule backs up the application', async () => {
    expect((await fails(saveDraft(db.web, owner, { docType: 'estimate', partyId: abroad, lines: [line()] }))).message).toMatch(/Exports are not supported/);
    const { id } = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: domestic, lines: [line('100.00')] });
    await expect(db.owner`update document set currency = 'USD' where id = ${id}`).rejects.toMatchObject({ message: expect.stringContaining('document_currency_scope') });
  });

  it('issues with the normal estimate number and keeps the rate it was issued at', async () => {
    const { id } = await saveDraft(db.web, owner, quote({ partyId: domestic }));
    const d = (await issueDocument(db.web, owner, id)).document;
    expect(d.number).toMatch(/^EST\//);
    expect(d).toMatchObject({ currency: 'USD', exchange_rate_micro: '83250000' });
    await expect(db.owner`update document set currency = 'EUR' where id = ${id}`).rejects.toBeTruthy();         // frozen once issued
  });

  it('turns into a rupee invoice at the quoted rate, discount included', async () => {
    const { id } = await saveDraft(db.web, owner, quote({ partyId: domestic, lines: [line('100.00', { quantity: '2', discount: '10.00' })] }));
    await issueDocument(db.web, owner, id);
    const out = await convertEstimate(db.web, owner, id);
    const inv = (await getDocument(db.web, owner, out.id))!;
    expect(inv.document).toMatchObject({ doc_type: 'tax_invoice', currency: 'INR', exchange_rate_micro: '1000000', status: 'draft' });
    expect(inv.lines[0]).toMatchObject({ rate_paise: '832500', discount_paise: '83250' });                       // 100.00 USD and 10.00 USD at 83.25
    // (2 x 8,325.00 - 832.50) = 15,817.50 taxable; plus 18% = 18,664.65; rounded to the rupee
    expect(inv.document).toMatchObject({ taxable_paise: '1581750', grand_total_paise: '1866500', place_of_supply: '27' });
    expect((await issueDocument(db.web, owner, out.id)).document.number).toMatch(/^INV\//);
  });

  it('will not turn a quote to a customer abroad into an invoice, since exports are not supported', async () => {
    const { id } = await saveDraft(db.web, owner, quote());
    await issueDocument(db.web, owner, id);
    const e = await fails(convertEstimate(db.web, owner, id));
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.message).toMatch(/Exports are not supported/);
    expect((await db.owner`select count(*)::int as n from estimate_state where document_id = ${id} and converted_to_id is not null`)[0]!.n).toBe(0);
  });

  it('remembers a customer\'s usual currency and refuses an unknown one', async () => {
    expect((await listParties(db.web, owner, { q: 'Berlin' }))[0]).toMatchObject({ currency: 'EUR', state_code: '96' });
    expect(await fails(createParty(db.web, owner, { kind: 'customer', name: 'X', stateCode: '27', currency: 'BTC' }))).toBeInstanceOf(ValidationError);
    expect((await listParties(db.web, owner, { q: 'Mumbai' }))[0]).toMatchObject({ currency: 'USD' });
  });
});
