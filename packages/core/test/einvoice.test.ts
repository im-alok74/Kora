import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { computeIrn, createHttpGsp, createMockMessenger, startMockGsp, validateIrpPayload, isGspError } from '@kora/adapters';
import { gstinCheckChar } from '@kora/tax';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, buildIrpPayload, cancelEinvoice, correctBuyer, createBusiness, createHandlers, createParty, explainGspError, getDocument, getEinvoice,
  issueDocument, rupees, resolveTenant, resubmitEinvoice, runJobsOnce, saveDraft, updateBusinessProfile, ForbiddenError, ValidationError,
  type DocIn, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, staff: TenantSession, accountant: TenantSession;
let gsp: Awaited<ReturnType<typeof startMockGsp>>;
let clock = new Date('2026-10-18T06:00:00Z');
const messenger = createMockMessenger();
let client: ReturnType<typeof createHttpGsp>;
const drain = () => runJobsOnce(db.web, createHandlers(db.web, { messenger, appUrl: 'http://localhost:3000', gsp: client }), { limit: 50 });
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const D = '2026-10-18';

const gstin = (state: string, pan: string) => { const b = `${state}${pan}1Z`; return b + gstinCheckChar(b); };
const SELLER = gstin('27', 'AAPFU0939F');
let seq = 0;
const buyerGstin = (pan = 'BBBCC1234D', state = '29') => gstin(state, pan.slice(0, 5) + String(1000 + seq++).slice(0, 4) + 'D');

async function mkParty(name: string, opts: { gstin?: string; pincode?: string | null; state?: string } = {}) {
  const g = opts.gstin ?? buyerGstin();
  return createParty(db.web, owner, {
    kind: 'customer', name, gstin: g, billingAddress: { line1: '5 Brigade Road', city: 'Bengaluru', ...(opts.pincode === null ? {} : { pincode: opts.pincode ?? '560001' }) },
  });
}
const inv = (partyId: string | null, over: Partial<DocIn> = {}): DocIn => ({
  docType: 'tax_invoice', partyId, docDate: D, dueDate: '2026-11-17',
  lines: [{ name: 'Laptop', hsnSac: '847130', quantity: '2', rate: '10000.00', taxRateBp: 1800, unit: 'NOS' }], ...over,
});
const issue = async (partyId: string | null, over: Partial<DocIn> = {}) => (await issueDocument(db.web, owner, (await saveDraft(db.web, owner, inv(partyId, over))).id)).document;
const einv = async (id: unknown) => (await getEinvoice(db.web, owner, id as string)).current as any;
const docRow = async (id: unknown) => (await getDocument(db.web, owner, id as string))!.document;

beforeAll(async () => {
  db = await makeTestDb();
  gsp = await startMockGsp(0, { now: () => clock });
  client = createHttpGsp({ baseUrl: gsp.url });
  const [u] = await db.owner`insert into app_user (email) values ('own@example.test') returning id`;
  const [s] = await db.owner`insert into app_user (email) values ('staff@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: SELLER, stateCode: '27', registrationType: 'regular' });
  const [a] = await db.owner`insert into app_user (email) values ('acct@example.test') returning id`;
  await addMember(db.web, u!.id as string, bid, s!.id as string, 'staff');
  await addMember(db.web, u!.id as string, bid, a!.id as string, 'accountant');
  owner = await resolveTenant(db.web, u!.id as string, bid);
  staff = await resolveTenant(db.web, s!.id as string, bid);
  accountant = await resolveTenant(db.web, a!.id as string, bid);
  await updateBusinessProfile(db.web, owner, { legalName: 'Acme Traders', address: { line1: '12 MG Road', city: 'Pune', pincode: '411001' }, phone: '9876543210', einvoiceEnabled: true });
}, 60_000);
afterAll(async () => { await gsp?.close(); await db?.drop(); });

describe('the payload we send', () => {
  it('converts paise to rupees exactly, including negatives', () => {
    expect([rupees('118000'), rupees('5'), rupees('0'), rupees('-47'), rupees('-100'), rupees('-1'), rupees('99999999999')]).toEqual([1180, 0.05, 0, -0.47, -1, -0.01, 999999999.99]);
  });
  it('has the IRP shape and passes every rule of the mock portal', async () => {
    const d = await issue(await mkParty('Far Buyer'));
    const full = (await getDocument(db.web, owner, d.id as string))!;
    const p = buildIrpPayload({ doc: full.document, lines: full.lines, supplier: d.supplier_snapshot, recipient: d.recipient_snapshot }) as any;
    expect(p).toMatchObject({
      Version: '1.1', TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N' }, DocDtls: { Typ: 'INV', No: d.number, Dt: '18/10/2026' },
      SellerDtls: { Gstin: SELLER, Stcd: '27', Pin: 411001, Loc: 'Pune' }, BuyerDtls: { Pos: '29', Stcd: '29', Pin: 560001 },
      ValDtls: { AssVal: 20000, IgstVal: 3600, CgstVal: 0, TotInvVal: 23600 },
    });
    expect(p.ItemList[0]).toMatchObject({ SlNo: '1', HsnCd: '847130', IsServc: 'N', Qty: 2, UnitPrice: 10000, AssAmt: 20000, GstRt: 18, IgstAmt: 3600, TotItemVal: 23600, Unit: 'NOS' });
    expect(validateIrpPayload(p)).toEqual([]);
  });
  it('P5: 150 random issued invoices all build a payload whose totals the portal accepts', async () => {
    const rnd = (n: number) => Math.floor(Math.random() * n);
    const parties = [await mkParty('Inter Buyer'), await createParty(db.web, owner, { kind: 'customer', name: 'Intra Buyer', gstin: gstin('27', 'CCCCC1234D'), billingAddress: { line1: '1 Lane', city: 'Mumbai', pincode: '400001' } })];
    const rates = [0, 500, 1200, 1800, 2800];
    let checked = 0;
    for (let i = 0; i < 150; i++) {
      const lines = Array.from({ length: 1 + rnd(5) }, (_, k) => ({
        name: `Item ${k}`, hsnSac: k % 2 ? '998313' : '847130', quantity: String(1 + rnd(20) + (rnd(2) ? 0.5 : 0)), rate: `${rnd(50000)}.${String(rnd(100)).padStart(2, '0')}`,
        discount: rnd(3) ? undefined : `${rnd(10)}.${String(rnd(100)).padStart(2, '0')}`, taxRateBp: rates[rnd(rates.length)]!, cessRateBp: rnd(6) ? 0 : 1200, unit: 'NOS',
      })).filter((l) => Number(l.rate) > 20);
      if (!lines.length) continue;
      let d;
      try { d = await issue(parties[rnd(2)]!, { lines, tcsBp: rnd(4) ? 0 : 10 }); } catch (e) { if (e instanceof ValidationError) continue; throw e; }
      const full = (await getDocument(db.web, owner, d.id as string))!;
      const p = buildIrpPayload({ doc: full.document, lines: full.lines, supplier: d.supplier_snapshot, recipient: d.recipient_snapshot });
      expect(validateIrpPayload(p), `document ${d.number} ${JSON.stringify({ v: (p as any).ValDtls, items: (p as any).ItemList.map((i: any) => [i.AssAmt, i.GstRt, i.IgstAmt, i.CgstAmt, i.SgstAmt, i.CesAmt, i.TotItemVal]) })}`).toEqual([]);
      checked++;
    }
    expect(checked).toBeGreaterThan(120);
    await db.owner`delete from job where queue = 'einvoice.register'`;
  }, 280_000);
  it('says in plain words what is missing, and where to fix it', async () => {
    const d = await issue(await mkParty('No Pin Co', { pincode: null }));
    const full = (await getDocument(db.web, owner, d.id as string))!;
    try { buildIrpPayload({ doc: full.document, lines: full.lines, supplier: d.supplier_snapshot, recipient: d.recipient_snapshot }); expect.unreachable(); }
    catch (e: any) { expect(e.problems).toEqual([expect.objectContaining({ field: 'buyer.pincode', message: 'The buyer needs a valid 6-digit pincode.' })]); }
  });
});

describe('registering with the partner', () => {
  it('queues at issue, registers in the worker, and stores the IRN, acknowledgement and QR', async () => {
    const d = await issue(await mkParty('Reg Buyer'));
    expect(d).toMatchObject({ einvoice_required: true, einvoice_status: 'pending' });
    expect((await einv(d.id)).status).toBe('pending');
    expect(await drain()).toMatchObject({ done: expect.any(Number), failed: 0 });
    const e = await einv(d.id);
    expect(e).toMatchObject({ status: 'registered', error_code: null });
    expect(e.irn).toBe(computeIrn(SELLER, 'INV', d.number as string, '18/10/2026'));
    expect(e.irn).toMatch(/^[0-9a-f]{64}$/);
    expect(e.ack_no).toMatch(/^\d+$/);
    expect(e.signed_qr).toMatch(/^mock\./);
    expect(new Date(e.cancel_deadline as string).getTime() - new Date(e.ack_date as string).getTime()).toBe(24 * 3600_000);
    expect((await docRow(d.id)).einvoice_status).toBe('registered');
  });
  it('is not required for a sale to someone without a GSTIN, or for estimates', async () => {
    const walkIn = await issue(null);
    expect(walkIn).toMatchObject({ einvoice_required: false, einvoice_status: 'none' });
    const est = await issue(await mkParty('Quote Buyer'), { docType: 'estimate' });
    expect(est.einvoice_required).toBe(false);
  });
  it('a crash after the portal answered is recovered: the duplicate answer returns the same IRN', async () => {
    const d = await issue(await mkParty('Crash Buyer'));
    const full = (await getDocument(db.web, owner, d.id as string))!;
    const direct = await client.generateIrn(buildIrpPayload({ doc: full.document, lines: full.lines, supplier: d.supplier_snapshot, recipient: d.recipient_snapshot }));
    await drain();
    expect((await einv(d.id)).irn).toBe(direct.irn);
    expect((await einv(d.id)).status).toBe('registered');
  });
  it('a rejection is final until someone acts, is shown in plain words, and is not a failed job', async () => {
    const d = await issue(await mkParty('Dormant Co', { gstin: buyerGstin('REJEC') }));
    await drain();
    const e = await einv(d.id);
    expect(e).toMatchObject({ status: 'rejected', error_code: '3029' });
    expect(e.problems[0]).toMatchObject({ message: "The buyer's GSTIN is not active on the GST portal.", fix: expect.stringContaining('current GSTIN') });
    expect((await docRow(d.id)).einvoice_status).toBe('rejected');
    const [j] = await db.owner`select status from job where queue = 'einvoice.register' and payload->>'documentId' = ${d.id as string}`;
    expect(j!.status).toBe('done');
    expect(await drain()).toMatchObject({ claimed: 0 });
  });
  it('the buyer GSTIN can be corrected within the same state, then resubmitted and registered', async () => {
    const d = await issue(await mkParty('Fix Me Ltd', { gstin: buyerGstin('REJEC') }));
    await drain();
    expect((await fails(correctBuyer(db.web, owner, d.id as string, { gstin: gstin('27', 'DDDDD1234D') }))).message).toMatch(/must be from Karnataka/);
    await correctBuyer(db.web, owner, d.id as string, { gstin: buyerGstin('FIXED') });
    expect((await docRow(d.id)).recipient_snapshot.gstin).toMatch(/^29FIXED/);
    await resubmitEinvoice(db.web, owner, d.id as string);
    expect((await docRow(d.id)).einvoice_status).toBe('pending');
    await drain();
    expect((await einv(d.id)).status).toBe('registered');
    const hist = (await getEinvoice(db.web, owner, d.id as string)).history;
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ status: 'rejected' });
    expect((await fails(correctBuyer(db.web, owner, d.id as string, { name: 'Late Edit' }))).message).toMatch(/before the invoice is registered/);
  });
  it('the rest of an issued invoice stays frozen even while the buyer can be corrected', async () => {
    const d = await issue(await mkParty('Frozen Co', { gstin: buyerGstin('REJEC') }));
    await drain();
    const { withTenant } = await import('@kora/db');
    const tryUpdate = (sqlText: string) => withTenant(db.web, { businessId: owner.businessId, userId: owner.userId }, (tx) => tx.unsafe(sqlText));
    await expect(tryUpdate(`update document set doc_date = '2026-01-01' where id = '${d.id}'`)).rejects.toThrow(/immutable/);
    await expect(tryUpdate(`update document set recipient_snapshot = jsonb_set(recipient_snapshot, '{state_code}', '"27"') where id = '${d.id}'`)).rejects.toThrow(/state cannot change/);
  });
  it('a portal outage is retried with backoff and then succeeds', async () => {
    const d = await issue(await mkParty('Flaky Co', { gstin: buyerGstin('OUTAG') }));
    expect(await drain()).toMatchObject({ retried: 1 });
    expect((await docRow(d.id)).einvoice_status).toBe('registering');
    expect((await einv(d.id))).toMatchObject({ status: 'registering', error_code: '503' });
    const [j1] = await db.owner`select run_at > now() + interval '20 seconds' as later from job where payload->>'documentId' = ${d.id as string}`;
    expect(j1!.later).toBe(true);
    await db.owner`update job set run_at = now() where payload->>'documentId' = ${d.id as string}`;
    expect(await drain()).toMatchObject({ retried: 1 });
    await db.owner`update job set run_at = now() where payload->>'documentId' = ${d.id as string}`;
    await drain();
    expect((await einv(d.id)).status).toBe('registered');
  });
  it('a portal that never recovers ends as failed, not silently stuck, and can be resubmitted', async () => {
    const d = await issue(await mkParty('Down Co', { gstin: buyerGstin('DOWNX') }));
    await drain();
    await db.owner`update job set attempts = max_attempts - 1, run_at = now() where payload->>'documentId' = ${d.id as string}`;
    expect(await drain()).toMatchObject({ failed: 1 });
    const e = await einv(d.id);
    expect(e).toMatchObject({ status: 'failed' });
    expect(e.problems[0].message).toMatch(/did not respond after repeated tries/);
    expect((await docRow(d.id)).einvoice_status).toBe('rejected');
    await resubmitEinvoice(db.web, owner, d.id as string);
    expect((await docRow(d.id)).einvoice_status).toBe('pending');
  });
  it('missing seller or buyer details are caught before anything is sent', async () => {
    const d = await issue(await mkParty('No Address Co', { pincode: null }));
    await drain();
    const e = await einv(d.id);
    expect(e).toMatchObject({ status: 'rejected', error_code: 'KORA_PRECHECK' });
    expect(e.problems[0]).toMatchObject({ field: 'buyer.pincode', fix: expect.stringContaining('the customer details') });
    expect(gsp.registered().some((r) => r.docNo === d.number)).toBe(false);
  });
  it('credit and debit notes are registered against the original invoice', async () => {
    const orig = await issue(await mkParty('Note Buyer'));
    await drain();
    const { startNote } = await import('../src/index.js');
    const n = await startNote(db.web, owner, orig.id as string, 'credit_note');
    const cn = (await issueDocument(db.web, owner, n.id)).document;
    expect(cn.einvoice_required).toBe(true);
    await drain();
    const e = await einv(cn.id);
    expect(e.status).toBe('registered');
    const reg = gsp.registered().find((r) => r.docNo === cn.number)!;
    expect(reg.docType).toBe('CRN');
    expect(reg.payload.PrecDocDtls).toEqual([{ InvNo: orig.number, InvDt: '18/10/2026' }]);
  });
  it('only staff and owners can resubmit; an accountant cannot', async () => {
    const d = await issue(await mkParty('Perm Co', { gstin: buyerGstin('REJEC') }));
    await drain();
    await expect(resubmitEinvoice(db.web, accountant, d.id as string)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(resubmitEinvoice(db.web, staff, d.id as string)).resolves.toBeDefined();
  });
});

describe('cancelling', () => {
  it('within 24 hours the e-invoice and the invoice are cancelled together', async () => {
    const d = await issue(await mkParty('Cancel Me'));
    await drain();
    await cancelEinvoice(db.web, owner, client, d.id as string, { reason: '2', remark: 'Wrong quantity' }, clock);
    expect(await docRow(d.id)).toMatchObject({ status: 'cancelled', einvoice_status: 'cancelled' });
    expect((await docRow(d.id)).cancel_reason).toContain('Data entry mistake');
    expect((await einv(d.id)).status).toBe('cancelled');
  });
  it('after 24 hours the answer is a credit note, and the portal agrees', async () => {
    const d = await issue(await mkParty('Too Late'));
    await drain();
    const later = new Date(clock.getTime() + 25 * 3600_000);
    expect((await fails(cancelEinvoice(db.web, owner, client, d.id as string, { reason: '2', remark: 'late' }, later))).message).toMatch(/Issue a credit note instead/);
    // even if our own check were skipped, the portal refuses
    const e = await einv(d.id);
    const saved = clock; clock = later;
    try { await client.cancelIrn({ irn: e.irn, reason: '2', remark: 'late' }); expect.unreachable(); }
    catch (err) { expect(isGspError(err) && err.code === '2142').toBe(true); }
    clock = saved;
    expect((await docRow(d.id)).status).toBe('issued');
  });
  it('needs a reason, an owner, and a registered e-invoice', async () => {
    const d = await issue(await mkParty('Perm Cancel'));
    await drain();
    expect((await fails(cancelEinvoice(db.web, owner, client, d.id as string, { reason: '9', remark: 'x' }, clock))).message).toMatch(/Choose a reason/);
    expect((await fails(cancelEinvoice(db.web, owner, client, d.id as string, { reason: '1', remark: '' }, clock))).message).toMatch(/Remark is required/);
    await expect(cancelEinvoice(db.web, staff, client, d.id as string, { reason: '1', remark: 'dup' }, clock)).rejects.toBeInstanceOf(ForbiddenError);
    const walkIn = await issue(null);
    expect((await fails(cancelEinvoice(db.web, owner, client, walkIn.id as string, { reason: '1', remark: 'dup' }, clock))).message).toMatch(/no registered e-invoice/);
  });
  it('a registered invoice cannot be cancelled the ordinary way', async () => {
    const { cancelDocument } = await import('../src/index.js');
    const d = await issue(await mkParty('Plain Cancel'));
    await drain();
    expect((await fails(cancelDocument(db.web, owner, d.id as string, 'oops'))).message).toMatch(/cancel the e-invoice first/);
  });
});

describe('the HTTP client', () => {
  it('maps outages, auth failures and garbage to the right kinds', async () => {
    const kind = async (f: typeof fetch) => { try { await createHttpGsp({ baseUrl: 'http://x', fetch: f }).generateIrn({}); } catch (e) { return isGspError(e) ? e.kind : 'other'; } return 'ok'; };
    expect(await kind((async () => { throw new Error('ECONNRESET'); }) as never)).toBe('transient');
    expect(await kind((async () => new Response('', { status: 503 })) as never)).toBe('transient');
    expect(await kind((async () => new Response('', { status: 429 })) as never)).toBe('transient');
    expect(await kind((async () => new Response('', { status: 401 })) as never)).toBe('auth');
    expect(await kind((async () => new Response('<html>', { status: 200 })) as never)).toBe('transient');
    expect(await kind((async () => Response.json({ Status: 0, ErrorCode: '3029', ErrorMessage: 'no' })) as never)).toBe('validation');
    expect(await kind((async () => Response.json({ Status: 0, ErrorCode: '5001', ErrorMessage: 'busy' })) as never)).toBe('transient');
  });
  it('explains unknown codes with the portal\'s own words', () => {
    expect(explainGspError('9999', 'Something odd')).toMatchObject({ title: 'Something odd' });
    expect(explainGspError('9999', '').title).toMatch(/rejected this invoice/);
  });
});
