import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { createBusiness, createParty, duplicateDocument, getDocument, issueDocument, resolveTenant, saveDraft, type TenantSession } from '../src/index.js';

let db: TestDb;
let owner: TenantSession;
let buyer: string;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const line = { name: 'Work', hsnSac: '998313', quantity: '1', rate: '10000.00', taxRateBp: 1800, kind: 'service' as const };

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('owner@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  buyer = await createParty(db.web, owner, { kind: 'customer', name: 'Local Buyer', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('a reference currency on a rupee document', () => {
  it('is kept with its rate, survives issue and a duplicate, and never changes the tax', async () => {
    const plain = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: buyer, lines: [line] });
    const withRef = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: buyer, lines: [line], displayCurrency: 'usd', displayRate: '83.25' });
    const a = (await getDocument(db.web, owner, plain.id))!.document, b = (await getDocument(db.web, owner, withRef.id))!.document;
    expect(b).toMatchObject({ display_currency: 'USD', display_rate_micro: '83250000', grand_total_paise: a.grand_total_paise, igst_paise: a.igst_paise, cgst_paise: a.cgst_paise });
    await issueDocument(db.web, owner, withRef.id);
    const copy = await duplicateDocument(db.web, owner, withRef.id);
    expect((await getDocument(db.web, owner, copy.id))!.document).toMatchObject({ display_currency: 'USD', display_rate_micro: '83250000' });
  });

  it('refuses rupees, an unknown currency, a missing or bad rate, and a document already in another currency', async () => {
    const base = { docType: 'tax_invoice' as const, partyId: buyer, lines: [line] };
    expect((await fails(saveDraft(db.web, owner, { ...base, displayCurrency: 'INR', displayRate: '1' }))).message).toMatch(/other than rupees/);
    expect((await fails(saveDraft(db.web, owner, { ...base, displayCurrency: 'XYZ', displayRate: '1' }))).message).toMatch(/other than rupees/);
    expect((await fails(saveDraft(db.web, owner, { ...base, displayCurrency: 'USD' }))).message).toMatch(/exchange rate/);
    expect((await fails(saveDraft(db.web, owner, { ...base, docType: 'estimate', currency: 'EUR', exchangeRate: '90', displayCurrency: 'USD', displayRate: '83' }))).message).toMatch(/already in another currency/);
  });
});
