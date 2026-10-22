import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  convertDocument, createBusiness, createParty, createShareLink, decideEstimate, getDocument, issueDocument, publicAnswerEstimate, publicEstimateInfo,
  resolveTenant, reviseEstimate, saveDraft, type DocIn, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession;
let buyer: string;

const line = (over = {}) => ({ name: 'Design work', hsnSac: '998313', quantity: '2', rate: '1000.00', taxRateBp: 1800, kind: 'service' as const, ...over });
const quote = (over: Partial<DocIn> = {}): DocIn => ({ docType: 'estimate', partyId: buyer, lines: [line()], ...over });
const issued = async (over: Partial<DocIn> = {}) => { const { id } = await saveDraft(db.web, owner, quote(over)); await issueDocument(db.web, owner, id); return id; };
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('owner@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  buyer = await createParty(db.web, owner, { kind: 'customer', name: 'Local Buyer', stateCode: '27', phone: '9876543210' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('answering a quote', () => {
  it('keeps the comment and the name the customer gave', async () => {
    const id = await issued();
    const out = await decideEstimate(db.web, owner, id, 'declined', 'staff', { comment: 'Too expensive this quarter', name: 'Meera' });
    expect(out.estimate).toMatchObject({ status: 'declined', decision_comment: 'Too expensive this quarter', decided_by_name: 'Meera' });
  });

  it('lets the customer answer from the shared link, and a decline needs a reason', async () => {
    const id = await issued();
    const { token } = await createShareLink(db.web, owner, id);
    expect((await publicEstimateInfo(db.web, token))?.status).toBe('open');
    expect((await fails(publicAnswerEstimate(db.web, token, 'declined', { name: 'Ravi' }))).message).toMatch(/briefly why/);
    expect((await fails(publicAnswerEstimate(db.web, token, 'accepted', { comment: 'ok' }))).message).toMatch(/type your name/);
    expect(await publicAnswerEstimate(db.web, token, 'accepted', { name: 'Ravi', comment: 'Go ahead' })).toEqual({ status: 'accepted' });
    const info = await publicEstimateInfo(db.web, token);
    expect(info).toMatchObject({ status: 'accepted', comment: 'Go ahead', name: 'Ravi' });
    expect((await getDocument(db.web, owner, id))!.estimate).toMatchObject({ decided_via: 'portal', decided_by_name: 'Ravi' });
  });

  it('refuses a bad token and a document that is not a quote', async () => {
    expect(await publicEstimateInfo(db.web, 'nope')).toBeNull();
    expect(await publicAnswerEstimate(db.web, 'not-a-real-token-123456', 'accepted', { name: 'X' })).toBeNull();
    const inv = (await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: buyer, lines: [line()] })).id;
    await issueDocument(db.web, owner, inv);
    const { token } = await createShareLink(db.web, owner, inv);
    expect(await publicEstimateInfo(db.web, token)).toBeNull();
  });
});

describe('quote versions', () => {
  it('issuing version 2 withdraws version 1 and links them', async () => {
    const v1 = await issued({ reference: 'PO-77' });
    const r = await reviseEstimate(db.web, owner, v1);
    expect(r.version).toBe(2);
    expect((await reviseEstimate(db.web, owner, v1)).alreadyStarted).toBe(true);
    const draft = (await getDocument(db.web, owner, r.id))!;
    expect(draft.document).toMatchObject({ version: 2, previous_version_id: v1, reference: 'PO-77', status: 'draft' });
    await issueDocument(db.web, owner, r.id);
    const old = (await getDocument(db.web, owner, v1))!;
    expect(old.document.status).toBe('cancelled');
    expect(old.versions.map((v: { version: number }) => v.version)).toEqual([1, 2]);
    expect((await fails(reviseEstimate(db.web, owner, v1))).message).toMatch(/Only an issued quote|newer version/);
  });

  it('will not revise a quote the customer accepted', async () => {
    const id = await issued();
    await decideEstimate(db.web, owner, id, 'accepted');
    expect((await fails(reviseEstimate(db.web, owner, id))).message).toMatch(/accepted/);
  });
});

describe('sales orders and the document chain', () => {
  it('has its own number series and chains quote to order to challan to invoice', async () => {
    const q = await issued();
    const so = await convertDocument(db.web, owner, q, 'sales_order');
    expect(so.alreadyConverted).toBe(false);
    expect((await convertDocument(db.web, owner, q, 'sales_order')).id).toBe(so.id);
    // the quote counts as accepted once an order exists
    expect((await getDocument(db.web, owner, q))!.estimate).toMatchObject({ status: 'accepted' });
    await issueDocument(db.web, owner, so.id);
    const orderDoc = (await getDocument(db.web, owner, so.id))!;
    expect(orderDoc.document.number).toMatch(/^SO\//);
    expect(orderDoc.source).toMatchObject({ id: q });
    const dc = await convertDocument(db.web, owner, so.id, 'delivery_challan');
    await issueDocument(db.web, owner, dc.id);
    expect((await getDocument(db.web, owner, dc.id))!.document.number).toMatch(/^DC\//);
    const inv = await convertDocument(db.web, owner, dc.id, 'invoice');
    const invoice = (await getDocument(db.web, owner, inv.id))!;
    expect(invoice.document).toMatchObject({ doc_type: 'tax_invoice', status: 'draft', source_document_id: dc.id });
    expect(invoice.lines).toHaveLength(1);
    expect((await getDocument(db.web, owner, so.id))!.children.map((c) => c.doc_type)).toEqual(['delivery_challan']);
  });

  it('only converts forwards, and only from an issued document', async () => {
    const so = (await saveDraft(db.web, owner, quote({ docType: 'sales_order' }))).id;
    expect((await fails(convertDocument(db.web, owner, so, 'invoice'))).message).toMatch(/Issue this document/);
    await issueDocument(db.web, owner, so);
    expect((await fails(convertDocument(db.web, owner, so, 'estimate'))).message).toMatch(/cannot be turned/);
  });

  it('keeps a foreign currency on an order but turns it into rupees on the invoice', async () => {
    const q = await issued({ currency: 'USD', exchangeRate: '80', lines: [line({ quantity: '1', rate: '100.00', taxRateBp: 0, hsnSac: '998313' })] });
    const so = await convertDocument(db.web, owner, q, 'sales_order');
    const d = (await getDocument(db.web, owner, so.id))!;
    expect(d.document).toMatchObject({ currency: 'USD', doc_type: 'sales_order' });
    await issueDocument(db.web, owner, so.id);
    const inv = await convertDocument(db.web, owner, so.id, 'proforma');
    expect((await getDocument(db.web, owner, inv.id))!.document.currency).toBe('USD');
  });

  it('a declined quote cannot be converted', async () => {
    const q = await issued();
    await decideEstimate(db.web, owner, q, 'declined', 'staff', { comment: 'no' });
    expect((await fails(convertDocument(db.web, owner, q, 'sales_order'))).message).toMatch(/declined/);
  });
});
