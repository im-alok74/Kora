import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpGsp, createMockMessenger } from '@kora/adapters';
import { gstinCheckChar } from '@kora/tax';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, archiveParty, cancelDocument, createBusiness, createItem, createParty, createShareLink, deleteDraft, getDocument,
  getPublicDocument, getTemplate, isValidationError, issueDocument, listDocuments, listParties, previewTotals, resolveTenant,
  revokeShareLinks, saveDraft, saveTemplate, sanitiseTemplate, queueDocumentSend, runJobsOnce, createHandlers, shareStats, startNote, updateBusinessProfile,
  ForbiddenError, ValidationError, type DocIn, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, staff: TenantSession, accountant: TenantSession;
let customerKA: string, customerMH: string;
const messenger = createMockMessenger();
const APP = 'http://localhost:3000';
const D = '2026-10-18'; // FY 2026-27

const mkGstin = (state: string, mid: string) => { const b = `${state}${mid}1Z`; return b + gstinCheckChar(b); };
const line = (over = {}) => ({ name: 'Widget', hsnSac: '8471', quantity: '1', rate: '1000.00', taxRateBp: 1800, ...over });
const inv = (over: Partial<DocIn> = {}): DocIn => ({ docType: 'tax_invoice', partyId: customerMH, docDate: D, lines: [line()], ...over });
const issueNew = async (over: Partial<DocIn> = {}, t = owner) => {
  const { id } = await saveDraft(db.web, t, inv(over));
  return (await issueDocument(db.web, t, id)).document;
};
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };

async function newUser(email: string) {
  const [u] = await db.owner`insert into app_user (email) values (${email}) returning id`;
  return u!.id as string;
}
async function mkBusiness(email: string, gstin: string, state: string, type: 'regular' | 'composition' = 'regular') {
  const uid = await newUser(email);
  const bid = await createBusiness(db.web, uid, { legalName: 'Acme Traders', gstin, stateCode: state, registrationType: type });
  return { uid, bid, t: await resolveTenant(db.web, uid, bid) };
}

beforeAll(async () => {
  db = await makeTestDb();
  const o = await mkBusiness('owner@example.test', '27AAPFU0939F1ZV', '27');
  owner = o.t;
  const su = await newUser('staff@example.test'), au = await newUser('acct@example.test');
  await addMember(db.web, owner.userId, owner.businessId, su, 'staff');
  await addMember(db.web, owner.userId, owner.businessId, au, 'accountant');
  staff = await resolveTenant(db.web, su, owner.businessId);
  accountant = await resolveTenant(db.web, au, owner.businessId);
  customerMH = await createParty(db.web, owner, { kind: 'customer', name: 'Local Buyer', stateCode: '27' });
  customerKA = await createParty(db.web, owner, { kind: 'customer', name: 'Far Buyer', gstin: '29BBBCC1234D1Z4' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('parties and validation', () => {
  it('rejects a GSTIN with a bad checksum or the wrong state', async () => {
    expect(await fails(createParty(db.web, owner, { kind: 'customer', name: 'X', gstin: '29BBBCC1234D1Z5' }))).toBeInstanceOf(ValidationError);
    const e = await fails(createParty(db.web, owner, { kind: 'customer', name: 'X', gstin: '29BBBCC1234D1Z4', stateCode: '27' }));
    expect(e.message).toMatch(/belongs to state 29/);
  });
  it('takes the state from the GSTIN, and needs a state when there is no GSTIN', async () => {
    const list = await listParties(db.web, owner, { q: 'Far' });
    expect(list[0]).toMatchObject({ name: 'Far Buyer', state_code: '29' });
    expect(await fails(createParty(db.web, owner, { kind: 'customer', name: 'No state' }))).toBeInstanceOf(ValidationError);
  });
  it('archived customers drop out of the list', async () => {
    const id = await createParty(db.web, owner, { kind: 'customer', name: 'Temp Co', stateCode: '27' });
    await archiveParty(db.web, owner, id);
    expect(await listParties(db.web, owner, { q: 'Temp Co' })).toHaveLength(0);
  });
  it('items validate HSN and the tax rate list', async () => {
    expect(await fails(createItem(db.web, owner, { name: 'A', hsnSac: '12', defaultRateBp: 1800 }))).toBeInstanceOf(ValidationError);
    expect(await fails(createItem(db.web, owner, { name: 'A', defaultRateBp: 1700 }))).toBeInstanceOf(ValidationError);
    expect(typeof (await createItem(db.web, owner, { name: 'Laptop', hsnSac: '8471', defaultRateBp: 1800, price: '55000' }))).toBe('string');
  });
});

describe('totals are computed on the server', () => {
  it('intra-state splits CGST and SGST; inter-state uses IGST', async () => {
    const a = await previewTotals(db.web, owner, inv());
    expect(a).toMatchObject({ supply: 'intra', cgst: '9000', sgst: '9000', igst: '0', grandTotal: '118000' });
    const b = await previewTotals(db.web, owner, inv({ partyId: customerKA }));
    expect(b).toMatchObject({ supply: 'inter', placeOfSupply: '29', igst: '18000', cgst: '0', grandTotal: '118000' });
  });
  it('ship-to state decides the place of supply for goods', async () => {
    const r = await previewTotals(db.web, owner, inv({ partyId: customerMH, shipToState: '29' }));
    expect(r.supply).toBe('inter');
  });
  it('a saved draft stores what the library computed, not what the client says', async () => {
    const { id } = await saveDraft(db.web, owner, inv({ lines: [line({ quantity: '3', rate: '333.33', discount: '100', total: '1' } as never)] }));
    const { document: d, lines } = (await getDocument(db.web, owner, id))!;
    expect(d.status).toBe('draft');
    expect(lines[0]).toMatchObject({ gross_paise: '99999', discount_paise: '10000', taxable_paise: '89999' });
    expect(d.grand_total_paise).toBe('106200');
  });
  it('turns library errors into messages a person can read', async () => {
    expect((await fails(saveDraft(db.web, owner, inv({ lines: [line({ taxRateBp: 1700 })] })))).message).toMatch(/not in the allowed list/);
    expect((await fails(saveDraft(db.web, owner, inv({ lines: [line({ quantity: '0' })] })))).message).toMatch(/Quantity/);
    expect((await fails(saveDraft(db.web, owner, inv({ lines: [] })))).message).toMatch(/at least one line/);
  });
});

describe('issuing and numbering', () => {
  it('numbers follow the series and financial year', async () => {
    const a = await issueNew();
    const b = await issueNew();
    expect(a.number).toBe('INV/26-27/0001');
    expect(b.number).toBe('INV/26-27/0002');
    expect(a.financial_year).toBe('2026-27');
    expect(a.supplier_snapshot.legal_name).toBe('Acme Traders');
    expect(a.recipient_snapshot.name).toBe('Local Buyer');
  });
  it('a new financial year restarts the sequence', async () => {
    const x = await issueNew({ docDate: '2027-04-02' });
    expect(x.number).toBe('INV/27-28/0001');
    const y = await issueNew({ docDate: '2027-03-31' }); // still FY 2026-27
    expect(y.financial_year).toBe('2026-27');
  });
  it('each document type has its own series', async () => {
    const e = await issueNew({ docType: 'estimate' });
    expect(e.number).toBe('EST/26-27/0001');
  });
  it('concurrent issues are gapless and unique', async () => {
    const ids = await Promise.all(Array.from({ length: 25 }, () => saveDraft(db.web, owner, inv({ docType: 'proforma' })).then((r) => r.id)));
    const results = await Promise.all(ids.map((id) => issueDocument(db.web, owner, id)));
    const nums = results.map((r) => Number(r.document.number!.split('/').pop())).sort((a, b) => a - b);
    expect(nums).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  }, 60_000);
  it('a double submit of the same draft issues once and consumes one number', async () => {
    const { id } = await saveDraft(db.web, owner, inv({ docType: 'delivery_challan' }));
    const r = await Promise.allSettled([issueDocument(db.web, owner, id), issueDocument(db.web, owner, id), issueDocument(db.web, owner, id)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rej = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(isValidationError(rej.reason)).toBe(true);
    const next = await issueNew({ docType: 'delivery_challan' });
    expect(next.number).toBe('DC/26-27/0002');
  });
  it('a failed issue does not burn a number', async () => {
    const big = await mkBusiness('big@example.test', mkGstin('29', 'BBBCC1234D'), '29');
    const p = await createParty(db.web, big.t, { kind: 'customer', name: 'C', stateCode: '29' });
    const noHsn = (await saveDraft(db.web, big.t, { docType: 'tax_invoice', partyId: p, docDate: D, lines: [line({ hsnSac: null })] })).id;
    await db.owner`update business set turnover_band = 'over_5cr' where id = ${big.bid}`;   // the rule tightens before issue
    const e = await fails(issueDocument(db.web, big.t, noHsn));
    expect(e.message).toMatch(/HSN or SAC is required/);
    const ok = (await issueDocument(db.web, big.t, (await saveDraft(db.web, big.t, { docType: 'tax_invoice', partyId: p, docDate: D, lines: [line({ hsnSac: '847130' })] })).id)).document;
    expect(ok.number).toBe('INV/26-27/0001');
    expect((await fails(saveDraft(db.web, big.t, { docType: 'tax_invoice', partyId: p, docDate: D, lines: [line({ hsnSac: null })] }))).message).toMatch(/at least 6 digits/);
  });
  it('under Rs 5 crore a missing HSN warns but still issues', async () => {
    const r = await saveDraft(db.web, owner, inv({ lines: [line({ hsnSac: null })] }));
    expect(r.warnings[0]).toMatch(/HSN or SAC needs at least 4 digits/);
  });
  it('a composition dealer cannot issue a tax invoice, but can issue a bill of supply', async () => {
    const c = await mkBusiness('comp@example.test', mkGstin('24', 'AAAAA0000A'), '24', 'composition');
    const p = await createParty(db.web, c.t, { kind: 'customer', name: 'C', stateCode: '24' });
    const e = await fails(saveDraft(db.web, c.t, { docType: 'tax_invoice', partyId: p, docDate: D, lines: [line()] }));
    expect(e.message).toMatch(/bill of supply/);
    const { id } = await saveDraft(db.web, c.t, { docType: 'bill_of_supply', partyId: p, docDate: D, lines: [line()] });
    const d = (await issueDocument(db.web, c.t, id)).document;
    expect(d).toMatchObject({ number: 'BOS/26-27/0001', cgst_paise: '0', igst_paise: '0', grand_total_paise: '100000' });
  });
});

describe('issued documents are immutable', () => {
  it('cannot be edited or deleted through the service', async () => {
    const d = await issueNew();
    expect((await fails(saveDraft(db.web, owner, inv(), d.id as string))).message).toMatch(/Only a draft can be edited/);
    expect((await fails(deleteDraft(db.web, owner, d.id as string))).message).toMatch(/Only a draft/);
  });
  it('cannot be changed by writing SQL as the app role either', async () => {
    const d = await issueNew();
    const e = await fails((async () => {
      const { withTenant } = await import('@kora/db');
      await withTenant(db.web, { businessId: owner.businessId, userId: owner.userId }, (tx) =>
        tx`update document set grand_total_paise = 1, taxable_paise = 0, cgst_paise = 0, sgst_paise = 0 where id = ${d.id}`);
    })());
    expect(e.message).toMatch(/immutable/);
  });
  it('a draft can be edited and deleted', async () => {
    const { id } = await saveDraft(db.web, owner, inv());
    await saveDraft(db.web, owner, inv({ lines: [line({ quantity: '2' })] }), id);
    expect((await getDocument(db.web, owner, id))!.document.grand_total_paise).toBe('236000');
    await deleteDraft(db.web, owner, id);
    expect(await getDocument(db.web, owner, id)).toBeNull();
  });
});

describe('credit and debit notes, cancel', () => {
  it('a credit note copies the lines, stays within the original, and is numbered in its own series', async () => {
    const orig = await issueNew({ lines: [line({ rate: '1000.00' })] });
    const { id } = await startNote(db.web, owner, orig.id as string, 'credit_note');
    const draft = (await getDocument(db.web, owner, id))!;
    expect(draft.document).toMatchObject({ doc_type: 'credit_note', original_document_id: orig.id, grand_total_paise: '118000' });
    // take back half
    await saveDraft(db.web, owner, { docType: 'credit_note', partyId: orig.party_id as string, originalDocumentId: orig.id as string,
      docDate: D, lines: [line({ rate: '500.00' })] }, id);
    const cn = (await issueDocument(db.web, owner, id)).document;
    expect(cn.number).toMatch(/^CN\/26-27\/\d{4}$/);
    expect(cn.grand_total_paise).toBe('59000');
    // the remaining half is fine, a second full credit is not
    const second = await startNote(db.web, owner, orig.id as string, 'credit_note').catch((e) => e);
    expect(second).toBeInstanceOf(ValidationError);
    expect(second.message).toMatch(/more than what is left/);
  });
  it('a debit note is not capped', async () => {
    const orig = await issueNew();
    const { id } = await startNote(db.web, owner, orig.id as string, 'debit_note');
    expect((await issueDocument(db.web, owner, id)).document.number).toMatch(/^DN\//);
  });
  it('notes need an issued invoice', async () => {
    const { id } = await saveDraft(db.web, owner, inv());
    expect((await fails(startNote(db.web, owner, id, 'credit_note'))).message).toMatch(/issued invoice/);
  });
  it('cancelling needs a reason and an owner; the number stays used', async () => {
    const d = await issueNew();
    expect((await fails(cancelDocument(db.web, owner, d.id as string, ''))).message).toMatch(/Reason is required/);
    await expect(cancelDocument(db.web, staff, d.id as string, 'wrong customer')).rejects.toBeInstanceOf(ForbiddenError);
    const c = (await cancelDocument(db.web, owner, d.id as string, 'wrong customer')).document;
    expect(c).toMatchObject({ status: 'cancelled', cancel_reason: 'wrong customer', number: d.number });
    const next = await issueNew();
    expect(Number(next.number!.split('/').pop())).toBeGreaterThan(Number(d.number!.split('/').pop()));
  });
});

describe('roles', () => {
  it('the accountant can read but not write', async () => {
    expect((await listDocuments(db.web, accountant)).length).toBeGreaterThan(0);
    await expect(saveDraft(db.web, accountant, inv())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createParty(db.web, accountant, { kind: 'customer', name: 'X', stateCode: '27' })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('staff can issue but cannot change settings', async () => {
    expect((await issueNew({}, staff)).status).toBe('issued');
    await expect(saveTemplate(db.web, staff, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateBusinessProfile(db.web, staff, { legalName: 'Hacked' })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('share links and sending', () => {
  it('a draft cannot be shared; an issued document can, and views are counted', async () => {
    const { id } = await saveDraft(db.web, owner, inv());
    expect((await fails(createShareLink(db.web, owner, id))).message).toMatch(/Issue the document/);
    const d = await issueNew();
    const { token } = await createShareLink(db.web, owner, d.id as string);
    const pub = (await getPublicDocument(db.web, token))!;
    expect(pub.number).toBe(d.number);
    expect(pub.lines).toHaveLength(1);
    expect(pub.created_by).toBeUndefined();
    await getPublicDocument(db.web, token);
    expect((await shareStats(db.web, owner, d.id as string)).views).toBe(2);
    await revokeShareLinks(db.web, owner, d.id as string);
    expect(await getPublicDocument(db.web, token)).toBeNull();
    expect(await getPublicDocument(db.web, 'not-a-real-token-at-all')).toBeNull();
  });
  const drain = () => runJobsOnce(db.web, createHandlers(db.web, { messenger, appUrl: APP, gsp: createHttpGsp({ baseUrl: 'http://127.0.0.1:9' }) }), { limit: 50 });
  it('queues a WhatsApp send; the worker sends it with a link, records it, and stamps last_sent_at', async () => {
    const d = await issueNew();
    const q = await queueDocumentSend(db.web, owner, { documentId: d.id as string, channel: 'whatsapp', to: '98765 43210' });
    expect(q.status).toBe('queued');
    expect((await getDocument(db.web, owner, d.id as string))!.deliveries[0]).toMatchObject({ status: 'queued' });
    expect(await drain()).toMatchObject({ done: 1, failed: 0 });
    const m = messenger.outbox.at(-1)!;
    expect(m).toMatchObject({ channel: 'whatsapp', to: '+919876543210' });
    expect(m.text).toContain(d.number as string);
    expect(m.text).toContain('Rs 1,180.00');
    expect(m.documentUrl).toMatch(/^http:\/\/localhost:3000\/i\/[A-Za-z0-9_-]+$/);
    const full = (await getDocument(db.web, owner, d.id as string))!;
    expect(full.deliveries[0]).toMatchObject({ channel: 'whatsapp', status: 'sent' });
    expect(full.document.last_sent_at).not.toBeNull();
  });
  it('a provider outage is retried with backoff and then succeeds, without sending twice', async () => {
    const d = await issueNew();
    await queueDocumentSend(db.web, owner, { documentId: d.id as string, channel: 'whatsapp', to: '9876543210' });
    const before = messenger.outbox.length;
    messenger.failNext('WhatsApp provider is down');
    expect(await drain()).toMatchObject({ retried: 1, done: 0 });
    expect((await getDocument(db.web, owner, d.id as string))!.deliveries[0]).toMatchObject({ status: 'queued', error_message: 'WhatsApp provider is down' });
    const [j] = await db.owner`select run_at > now() + interval '20 seconds' as later, attempts from job where payload->>'documentId' = ${d.id as string}`;
    expect(j).toMatchObject({ later: true, attempts: 1 });
    await db.owner`update job set run_at = now() where payload->>'documentId' = ${d.id as string}`;
    expect(await drain()).toMatchObject({ done: 1 });
    expect(messenger.outbox.length).toBe(before + 1);
    expect((await getDocument(db.web, owner, d.id as string))!.deliveries[0]).toMatchObject({ status: 'sent' });
  });
  it('after the last attempt the delivery is marked failed and stays visible', async () => {
    const d = await issueNew();
    await queueDocumentSend(db.web, owner, { documentId: d.id as string, channel: 'sms', to: '9876543210' });
    await db.owner`update job set attempts = max_attempts - 1 where payload->>'documentId' = ${d.id as string}`;
    messenger.failNext('SMS gateway rejected the template');
    expect(await drain()).toMatchObject({ failed: 1 });
    expect((await getDocument(db.web, owner, d.id as string))!.deliveries[0]).toMatchObject({ status: 'failed', error_message: 'SMS gateway rejected the template' });
  });
  it('a document cancelled before the worker runs is not sent', async () => {
    const d = await issueNew();
    await queueDocumentSend(db.web, owner, { documentId: d.id as string, channel: 'whatsapp', to: '9876543210' });
    const before = messenger.outbox.length;
    await cancelDocument(db.web, owner, d.id as string, 'mistake');
    await drain();
    expect(messenger.outbox.length).toBe(before);
    expect((await getDocument(db.web, owner, d.id as string))!.deliveries[0]).toMatchObject({ status: 'failed' });
  });
  it('refuses drafts, bad numbers and bad emails', async () => {
    const { id } = await saveDraft(db.web, owner, inv());
    expect((await fails(queueDocumentSend(db.web, owner, { documentId: id, channel: 'email', to: 'a@b.co' }))).message).toMatch(/issued/);
    const d = await issueNew();
    expect(await fails(queueDocumentSend(db.web, owner, { documentId: d.id as string, channel: 'whatsapp', to: '123' }))).toBeInstanceOf(ValidationError);
    expect(await fails(queueDocumentSend(db.web, owner, { documentId: d.id as string, channel: 'email', to: 'nope' }))).toBeInstanceOf(ValidationError);
  });
  it('accountants cannot send', async () => {
    const d = await issueNew();
    await expect(queueDocumentSend(db.web, accountant, { documentId: d.id as string, channel: 'sms', to: '9876543210' })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('business profile', () => {
  it('saves address, UPI and bank details, and rejects bad ones', async () => {
    await updateBusinessProfile(db.web, owner, { legalName: 'Acme Traders', address: { line1: '12 MG Road', city: 'Pune' }, upiVpa: 'acme@okhdfc',
      bank: { accountName: 'Acme', accountNumber: '123456789', ifsc: 'hdfc0001234', bankName: 'HDFC' } });
    const [b] = await db.owner`select upi_vpa, bank_details, address from business where id = ${owner.businessId}`;
    expect(b).toMatchObject({ upi_vpa: 'acme@okhdfc', address: { city: 'Pune' } });
    expect(b!.bank_details.ifsc).toBe('HDFC0001234');
    expect((await fails(updateBusinessProfile(db.web, owner, { legalName: 'Acme Traders', upiVpa: 'not a upi' }))).message).toMatch(/UPI ID/);
    expect((await fails(updateBusinessProfile(db.web, owner, { legalName: 'Acme Traders', bank: { ifsc: 'bad' } }))).message).toMatch(/IFSC/);
  });
  it('the GSTIN cannot be changed after documents are issued', async () => {
    const e = await fails(updateBusinessProfile(db.web, owner, { legalName: 'Acme Traders', gstin: mkGstin('27', 'XYZAB9876C') }));
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.message).toMatch(/cannot change after documents are issued/);
  });
});

describe('template', () => {
  it('has a safe default and keeps only allowed settings', async () => {
    expect((await getTemplate(db.web, owner)).accent).toBe('#0b5d4f');
    const saved = await saveTemplate(db.web, owner, { accent: '#112233', font: 'serif', showBank: false, hideGstin: true, evil: '<script>' });
    expect(saved).toMatchObject({ accent: '#112233', font: 'serif', showBank: false });
    expect(saved).not.toHaveProperty('hideGstin');
    expect(saved).not.toHaveProperty('evil');
    expect(await getTemplate(db.web, owner)).toMatchObject({ accent: '#112233' });
  });
  it('rejects values that could break out of the page', () => {
    expect(() => sanitiseTemplate({ accent: 'red; background:url(x)' })).toThrow(ValidationError);
    expect(() => sanitiseTemplate({ font: 'Comic Sans' })).toThrow(ValidationError);
    expect(() => sanitiseTemplate({ logoDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' })).toThrow(/PNG or JPEG/);
    expect(() => sanitiseTemplate({ logoDataUrl: 'data:image/png;base64,' + 'A'.repeat(210_000) })).toThrow(/150 KB/);
    expect(() => sanitiseTemplate({ footerText: 'x'.repeat(201) })).toThrow(ValidationError);
  });
});
