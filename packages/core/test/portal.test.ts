import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockGateway } from '@kora/adapters';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, createBusiness, createParty, createPortalLink, customerStatement, getPublicDocument, issueDocument, portalAnswerEstimate,
  portalDocumentLink, portalOverview, portalPaymentLink, portalStatement, portalStatus, recordPayment, resolvePortal, revokePortalLink,
  resolveTenant, saveDraft, ForbiddenError, ValidationError, type DocIn, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, staff: TenantSession, accountant: TenantSession;
let asha: string, bimal: string;
const gateway = createMockGateway({ secret: 'portal-test-secret-portal-test-secret', baseUrl: 'http://localhost:3000' });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number) as [number, number, number]; return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); };
const line = (rate: string) => ({ name: 'Service', hsnSac: '998313', quantity: '1', rate, taxRateBp: 1800, kind: 'service' as const });
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as Error; } throw new Error('expected a failure'); };
const issued = async (partyId: string, over: Partial<DocIn> = {}) => {
  const { id } = await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId, docDate: today(), lines: [line('1000.00')], ...over });
  await issueDocument(db.web, owner, id);
  return id;
};

beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('o@example.test') returning id`;
  const [s] = await db.owner`insert into app_user (email) values ('s@example.test') returning id`;
  const [a] = await db.owner`insert into app_user (email) values ('a@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  await addMember(db.web, u!.id as string, bid, s!.id as string, 'staff');
  await addMember(db.web, u!.id as string, bid, a!.id as string, 'accountant');
  owner = await resolveTenant(db.web, u!.id as string, bid);
  staff = await resolveTenant(db.web, s!.id as string, bid);
  accountant = await resolveTenant(db.web, a!.id as string, bid);
  asha = await createParty(db.web, owner, { kind: 'customer', name: 'Asha Stores', stateCode: '27', phone: '9876543210' });
  bimal = await createParty(db.web, owner, { kind: 'customer', name: 'Bimal Traders', stateCode: '27' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('portal links', () => {
  it('opens for the right customer, counts views, and a new link replaces the old one', async () => {
    const a = await createPortalLink(db.web, owner, asha);
    expect(await resolvePortal(db.web, a.token)).toMatchObject({ partyId: asha, businessId: owner.businessId });
    expect(await portalStatus(db.web, owner, asha)).toMatchObject({ active: true, view_count: 0 });
    await portalOverview(db.web, a.token); await portalOverview(db.web, a.token);
    expect(await portalStatus(db.web, owner, asha)).toMatchObject({ active: true, view_count: 2 });

    const b = await createPortalLink(db.web, staff, asha);                   // staff may make one
    expect(await resolvePortal(db.web, a.token)).toBeNull();                 // the old link stopped
    expect(await resolvePortal(db.web, b.token)).toMatchObject({ partyId: asha });
    expect((await db.owner`select count(*)::int as n from portal_link where party_id = ${asha} and revoked_at is null`)[0]!.n).toBe(1);

    await revokePortalLink(db.web, owner, asha);
    expect(await resolvePortal(db.web, b.token)).toBeNull();
    expect(await portalOverview(db.web, b.token)).toBeNull();
    expect(await portalStatus(db.web, owner, asha)).toEqual({ active: false });
  });

  it('stores only a hash, and refuses guesses, junk and an accountant', async () => {
    const { token } = await createPortalLink(db.web, owner, bimal);
    const stored = await db.owner`select encode(token_hash, 'hex') as h from portal_link where party_id = ${bimal} and revoked_at is null`;
    expect(stored[0]!.h).not.toContain(token);
    expect(token.length).toBeGreaterThanOrEqual(24);
    for (const bad of ['', 'short', 'x'.repeat(65), 'has spaces in it', "' or 1=1 --", token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')]) {
      expect(await resolvePortal(db.web, bad)).toBeNull();
    }
    expect(await fails(createPortalLink(db.web, accountant, bimal))).toBeInstanceOf(ForbiddenError);
    expect(await fails(createPortalLink(db.web, owner, '00000000-0000-0000-0000-000000000000'))).toBeInstanceOf(ValidationError);
    await revokePortalLink(db.web, owner, bimal);
  });
});

describe('what the customer sees', () => {
  it('shows only their own documents, what they owe and what is overdue', async () => {
    const inv1 = await issued(asha, { docDate: addDays(today(), -40), dueDate: addDays(today(), -10) });   // overdue, 1,180
    await issued(asha, { dueDate: addDays(today(), 20) });                                                  // not yet due, 1,180
    await issued(bimal, { lines: [line('9999.00')] });                                                      // someone else's
    await saveDraft(db.web, owner, { docType: 'tax_invoice', partyId: asha, lines: [line('5.00')] });        // a draft is never shown
    await recordPayment(db.web, owner, { documentId: inv1, amount: '180.00', method: 'cash' });

    const { token } = await createPortalLink(db.web, owner, asha);
    const o = (await portalOverview(db.web, token))!;
    expect(o.customer.name).toBe('Asha Stores');
    expect(o.business.name).toBe('Acme Traders');
    expect(o.invoices).toHaveLength(2);
    expect(o.invoices.every((i) => !JSON.stringify(i).includes('9999'))).toBe(true);
    expect(o.totals).toEqual({ outstanding: '218000', overdue: '100000' });          // 1,000 left on the old one, 1,180 on the new
    expect(o.invoices.find((i) => i.overdue)).toMatchObject({ outstanding_paise: '100000' });
    expect(o.payments).toHaveLength(1);
    expect(o.payments[0]).toMatchObject({ method: 'cash', amount_paise: '18000' });
    await revokePortalLink(db.web, owner, asha);
  });

  it('shows the same statement the business sees', async () => {
    const { token } = await createPortalLink(db.web, owner, asha);
    const mine = await customerStatement(db.web, owner, asha, {});
    const theirs = (await portalStatement(db.web, token))!;
    expect(theirs.rows).toEqual(mine.rows);
    expect([theirs.opening, theirs.closing]).toEqual([mine.opening, mine.closing]);
    expect(BigInt(theirs.closing)).toBeGreaterThan(0n);
    expect(await portalStatement(db.web, 'not-a-real-token-at-all')).toBeNull();
    await revokePortalLink(db.web, owner, asha);
  });
});

describe('what the customer can do', () => {
  it('answers an estimate from the portal, and cannot touch another customer\'s estimate or an invoice', async () => {
    const est = await issued(asha, { docType: 'estimate', dueDate: addDays(today(), 10) });
    const bimalEst = await issued(bimal, { docType: 'estimate' });
    const inv = await issued(asha);
    const { token } = await createPortalLink(db.web, owner, asha);

    expect(await portalAnswerEstimate(db.web, token, est, 'accepted')).toEqual({ status: 'accepted' });
    expect((await db.owner`select decision, decided_via, decided_by from estimate_state where document_id = ${est}`)[0]).toEqual({ decision: 'accepted', decided_via: 'portal', decided_by: null });
    expect((await portalOverview(db.web, token))!.estimates.find((e) => e.id === est)).toMatchObject({ status: 'accepted' });

    expect(await fails(portalAnswerEstimate(db.web, token, bimalEst, 'accepted'))).toBeInstanceOf(ValidationError);   // not theirs
    expect(await fails(portalAnswerEstimate(db.web, token, inv, 'accepted'))).toBeInstanceOf(ValidationError);         // not an estimate
    expect(await fails(portalAnswerEstimate(db.web, token, 'not-a-uuid', 'accepted'))).toBeInstanceOf(ValidationError);
    expect((await db.owner`select count(*)::int as n from estimate_state where document_id = ${bimalEst}`)[0]!.n).toBe(0);
    await revokePortalLink(db.web, owner, asha);
  });

  it('gets a payment link for their own unpaid invoice only', async () => {
    const own = await issued(asha);
    const theirs = await issued(bimal);
    const paid = await issued(asha);
    await recordPayment(db.web, owner, { documentId: paid, amount: '1180.00', method: 'cash' });
    const { token } = await createPortalLink(db.web, owner, asha);
    const link = (await portalPaymentLink(db.web, token, gateway, own))!;
    expect(link.url).toMatch(/^http/);
    expect((await db.owner`select amount_paise from payment_link where document_id = ${own}`)[0]!.amount_paise).toBe('118000');
    expect(await fails(portalPaymentLink(db.web, token, gateway, theirs))).toBeInstanceOf(ValidationError);
    expect(await fails(portalPaymentLink(db.web, token, gateway, paid))).toBeInstanceOf(ValidationError);
    expect(await portalPaymentLink(db.web, 'wrong-token-wrong-token', gateway, own)).toBeNull();
    await revokePortalLink(db.web, owner, asha);
  });

  it('opens a document page and PDF for their own documents only', async () => {
    const own = await issued(asha);
    const theirs = await issued(bimal);
    const { token } = await createPortalLink(db.web, owner, asha);
    const link = (await portalDocumentLink(db.web, token, own))!;
    const pub = await getPublicDocument(db.web, link.token);
    expect(pub).toMatchObject({ id: own, party_id: asha });
    expect(await fails(portalDocumentLink(db.web, token, theirs))).toBeInstanceOf(ValidationError);
    await revokePortalLink(db.web, owner, asha);
  });
});
