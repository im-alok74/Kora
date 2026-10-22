import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockGateway, createMockOtpSender, mockPaidEventBody, signMockWebhook } from '@kora/adapters';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  applyGatewayEvent, createBusiness, createParty, createPortalLink, getDocument, issueDocument, listAttachments, listPortalActivity, portalAccess, portalAddComment,
  portalAttachPo, portalBulkPaymentLink, portalCodeHash, portalComments, portalLoginInfo, portalSendCode, portalSignOut, portalStatementPdfData, portalVerifyCode,
  replyPortalComment, resolveTenant, saveDraft, setPortalCodeLogin, type DocIn, type TenantSession,
} from '../src/index.js';

const SECRET = 'portal-accounts-secret-0123456789ab';
const GW_SECRET = 'gateway-secret-0123456789';
let db: TestDb;
let owner: TenantSession;
let asha: string, bimal: string, ashaToken: string;
const gateway = createMockGateway({ secret: GW_SECRET, baseUrl: 'http://localhost:3000' });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const line = (rate: string) => ({ name: 'Service', hsnSac: '998313', quantity: '1', rate, taxRateBp: 0, kind: 'service' as const });
const issue = async (partyId: string, rate: string, over: Partial<DocIn> = {}) => {
  const { id } = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId, docDate: today(), lines: [line(rate)], ...over });
  await issueDocument(db.web, owner, id);
  return id;
};
const pdf = Buffer.from('%PDF-1.4 fake purchase order').toString('base64');
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const resetCooldown = () => db.owner`update portal_code set created_at = created_at - interval '1 minute'`;

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('o@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  owner = await resolveTenant(db.web, u!.id as string, bid);
  asha = await createParty(db.web, owner, { kind: 'customer', name: 'Asha Stores', stateCode: '27', phone: '9876543210', email: 'asha@stores.test' });
  bimal = await createParty(db.web, owner, { kind: 'customer', name: 'Bimal Traders', stateCode: '27' });
  ashaToken = (await createPortalLink(db.web, owner, asha)).token;
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('signing in with a code', () => {
  it('lets the link alone in until the business asks for a code', async () => {
    expect(await portalAccess(db.web, ashaToken)).toBe('ok');
    expect(await portalAccess(db.web, 'not-a-real-token-at-all')).toBe('invalid');
    await setPortalCodeLogin(db.web, owner, asha, true);
    expect(await portalAccess(db.web, ashaToken)).toBe('code_needed');
    expect(await portalAccess(db.web, ashaToken, 'made-up-session')).toBe('code_needed');
  });
  it('says where a code can go, masked, and refuses a customer with nowhere to send it', async () => {
    expect(await portalLoginInfo(db.web, ashaToken)).toEqual({ codeRequired: true, destinations: { sms: '+91 ******3210', email: 'as**@stores.test' } });
    const lone = (await createPortalLink(db.web, owner, bimal)).token;
    await setPortalCodeLogin(db.web, owner, bimal, true);
    expect((await fails(portalSendCode(db.web, createMockOtpSender(() => {}), SECRET, lone))).message).toMatch(/no email or mobile number on record/);
  });
  it('sends a code to the address on record, accepts it once, and opens a session', async () => {
    const sender = createMockOtpSender(() => {});
    const sent = await portalSendCode(db.web, sender, SECRET, ashaToken, 'email');
    expect(sent).toMatchObject({ channel: 'email', to: 'as**@stores.test' });
    expect(sender.outbox).toHaveLength(1);
    expect(sender.outbox[0]).toMatchObject({ channel: 'email', to: 'asha@stores.test' });
    const code = sender.outbox[0]!.code;
    expect((await fails(portalVerifyCode(db.web, SECRET, ashaToken, code === '000000' ? '111111' : '000000'))).message).toMatch(/not right or has expired/);
    const ok = await portalVerifyCode(db.web, SECRET, ashaToken, code);
    expect(ok!.hours).toBe(12);
    expect(await portalAccess(db.web, ashaToken, ok!.session)).toBe('ok');
    expect((await fails(portalVerifyCode(db.web, SECRET, ashaToken, code))).message).toMatch(/not right or has expired/);   // single use
    await portalSignOut(db.web, ashaToken, ok!.session);
    expect(await portalAccess(db.web, ashaToken, ok!.session)).toBe('code_needed');
  });
  it('a session made for one link does not open another', async () => {
    const sender = createMockOtpSender(() => {});
    await resetCooldown();
    await portalSendCode(db.web, sender, SECRET, ashaToken, 'sms');
    const s = await portalVerifyCode(db.web, SECRET, ashaToken, sender.outbox[0]!.code);
    const other = (await createPortalLink(db.web, owner, bimal)).token;
    expect(await portalAccess(db.web, other, s!.session)).toBe('code_needed');
  });
  it('limits guesses to five and spaces out requests', async () => {
    const sender = createMockOtpSender(() => {});
    await resetCooldown();
    await portalSendCode(db.web, sender, SECRET, ashaToken, 'email');
    expect((await fails(portalSendCode(db.web, sender, SECRET, ashaToken, 'email'))).message).toMatch(/Wait 30 seconds/);
    const real = sender.outbox[0]!.code;
    const wrong = real === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) await fails(portalVerifyCode(db.web, SECRET, ashaToken, wrong));
    expect((await fails(portalVerifyCode(db.web, SECRET, ashaToken, real))).message).toMatch(/not right or has expired/);   // used up by the wrong guesses
  });
  it('stores only a hash of the code', async () => {
    const rows = await db.owner`select code_hash from portal_code limit 1`;
    expect(Buffer.isBuffer(rows[0]!.code_hash)).toBe(true);
    expect(portalCodeHash(SECRET, 'x', '123456')).toHaveLength(32);
  });
  it('turning the step off lets the link alone in again', async () => {
    await setPortalCodeLogin(db.web, owner, asha, false);
    expect(await portalAccess(db.web, ashaToken)).toBe('ok');
  });
});

describe('paying several invoices at once', () => {
  it('makes one payment link for the total and spreads the money over the invoices, oldest first', async () => {
    const a = await issue(asha, '1000.00', { docDate: '2026-09-01' });
    const b = await issue(asha, '500.00', { docDate: '2026-09-05' });
    const c = await issue(asha, '250.00', { docDate: '2026-09-10' });
    const link = await portalBulkPaymentLink(db.web, ashaToken, gateway, [c, a, b]);
    expect(link).toMatchObject({ amountPaise: '175000', count: 3, reused: false });
    expect(await portalBulkPaymentLink(db.web, ashaToken, gateway, [a, b, c])).toMatchObject({ reused: true });
    const [row] = await db.owner`select id, gateway_link_id from payment_link where url = ${link!.url}`;
    // the customer pays only Rs 1,200: the two oldest are cleared, the third is untouched
    const body = mockPaidEventBody({ linkId: row!.gateway_link_id as string, paymentId: 'pay_bulk1', amountPaise: 120000n });
    const evt = gateway.parseWebhook(body, { 'x-mock-signature': signMockWebhook(GW_SECRET, body), 'x-mock-event-id': 'evt_bulk1' });
    const r = await applyGatewayEvent(db.web, 'mock', evt, JSON.parse(body));
    expect(r.applied).toMatchObject({ allocatedPaise: '120000', unallocatedPaise: '0' });
    const state = async (id: string) => (await getDocument(db.web, owner, id))!.document;
    expect(await state(a)).toMatchObject({ amount_settled_paise: '100000', payment_status: 'paid' });
    expect(await state(b)).toMatchObject({ amount_settled_paise: '20000', payment_status: 'part_paid' });
    expect(await state(c)).toMatchObject({ amount_settled_paise: '0' });
  });
  it('refuses another customer\'s invoice, one invoice, too many, and paid ones', async () => {
    const mine = await issue(asha, '100.00');
    const theirs = await issue(bimal, '100.00');
    expect((await fails(portalBulkPaymentLink(db.web, ashaToken, gateway, [mine, theirs]))).message).toMatch(/not found/);
    expect((await fails(portalBulkPaymentLink(db.web, ashaToken, gateway, [mine]))).message).toMatch(/at least two/);
    expect((await fails(portalBulkPaymentLink(db.web, ashaToken, gateway, Array.from({ length: 21 }, () => mine).map((_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`)))).message).toMatch(/at most 20/);
    expect((await fails(portalBulkPaymentLink(db.web, ashaToken, gateway, [mine, 'nope']))).message).toMatch(/not found/);
  });
});

describe('comments and purchase orders on an estimate', () => {
  let est: string;
  beforeAll(async () => { est = await issue(asha, '5000.00', { docType: 'estimate' }); });
  it('the customer comments, the business replies, and both show', async () => {
    await portalAddComment(db.web, ashaToken, est, 'Can you do 10 percent less?');
    await replyPortalComment(db.web, owner, est, 'We can do 5 percent.');
    const t = await portalComments(db.web, ashaToken, est);
    expect(t!.comments.map((c) => [c.author, c.body])).toEqual([['customer', 'Can you do 10 percent less?'], ['business', 'We can do 5 percent.']]);
    const act = await listPortalActivity(db.web, owner, asha);
    expect(act.comments).toHaveLength(2);
    expect((await fails(portalAddComment(db.web, ashaToken, est, '   '))).message).toMatch(/Comment/);
  });
  it('cannot comment on another customer\'s document', async () => {
    const theirs = await issue(bimal, '100.00', { docType: 'estimate' });
    expect((await fails(portalAddComment(db.web, ashaToken, theirs, 'hello'))).message).toMatch(/not found/);
    expect((await fails(portalComments(db.web, ashaToken, theirs))).message).toMatch(/not found/);
  });
  it('keeps a purchase order, checks the file, caps the count, and keeps it apart from the team files', async () => {
    await portalAttachPo(db.web, ashaToken, est, { name: 'PO-77.pdf', type: 'application/pdf', dataBase64: pdf });
    expect((await fails(portalAttachPo(db.web, ashaToken, est, { name: 'x.pdf', type: 'application/pdf', dataBase64: Buffer.from('not a pdf').toString('base64') }))).message).toMatch(/does not look like/);
    expect((await fails(portalAttachPo(db.web, ashaToken, est, { name: 'x.exe', type: 'application/x-msdownload', dataBase64: pdf }))).message).toMatch(/JPEG or PNG/);
    for (let i = 0; i < 2; i++) await portalAttachPo(db.web, ashaToken, est, { name: `PO-${i}.pdf`, type: 'application/pdf', dataBase64: pdf });
    expect((await fails(portalAttachPo(db.web, ashaToken, est, { name: 'PO-4.pdf', type: 'application/pdf', dataBase64: pdf }))).message).toMatch(/up to 3 files/);
    expect((await listAttachments(db.web, owner, est)).filter((f) => f.from_customer)).toHaveLength(3);
    expect((await listPortalActivity(db.web, owner, asha)).files).toHaveLength(3);
    const inv = await issue(asha, '10.00');
    expect((await fails(portalAttachPo(db.web, ashaToken, inv, { name: 'PO.pdf', type: 'application/pdf', dataBase64: pdf }))).message).toMatch(/Estimate not found/);
  });
});

describe('statement as a PDF', () => {
  it('returns the figures with ageing, and renders a page that shows them', async () => {
    const d = await portalStatementPdfData(db.web, ashaToken, { from: '2026-01-01', to: '2099-12-31' });
    expect(d!.statement.rows.length).toBeGreaterThan(0);
    expect(Object.keys(d!.ageing)).toEqual(['not_due', 'd1_30', 'd31_60', 'd61_90', 'd90_plus']);
    expect(await portalStatementPdfData(db.web, 'not-a-real-token-at-all')).toBeNull();
  });
});
