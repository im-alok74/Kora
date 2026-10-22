import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gstinValid } from '@kora/tax';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  combineSteps, createBusiness, createDemoBusiness, createParty, demoGstin, findDemoBusiness, isDemoBusiness, listBusinesses, onboardingState,
  removeDemoBusiness, resolveTenant, saveDraft, setOnboardingStep, type TenantSession,
} from '../src/index.js';

describe('demoGstin and combineSteps (pure)', () => {
  it('makes GSTINs that pass the checksum for several states', () => {
    for (const [s, d, x] of [['27', '1234', 'M'], ['07', '5678', 'S'], ['29', '9012', 'I'], ['27', '4821', 'Z']] as const) expect(gstinValid(demoGstin(s, d, x))).toBe(true);
  });
  it('lets a record win over "skipped", and finishes when nothing is left to do', () => {
    const none = { business: false, logo: false, look: false, customer: false, invoice: false };
    expect(combineSteps(none, {}).next).toBe('business');
    const s = combineSteps({ ...none, customer: true }, { customer: 'skipped', logo: 'skipped' });
    expect(s.steps.find((x) => x.key === 'customer')!.state).toBe('done');
    expect(s.steps.find((x) => x.key === 'logo')!.state).toBe('skipped');
    expect(combineSteps(none, { business: 'skipped', logo: 'skipped', look: 'skipped', customer: 'skipped', invoice: 'skipped' }).finished).toBe(true);
  });
});

describe('onboarding and demo business (database)', () => {
  let db: TestDb; let userId: string; let otherUser: string; let real: TenantSession;
  beforeAll(async () => {
    db = await makeTestDb();
    const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
    userId = await mk('new@e.test'); otherUser = await mk('other@e.test');
    real = await resolveTenant(db.web, userId, await createBusiness(db.web, userId, { legalName: 'Real Traders', gstin: null, stateCode: '27', registrationType: 'unregistered' }));
  }, 60_000);
  afterAll(async () => { await db?.drop(); });

  it('remembers skipped steps, and a real customer completes the customer step by itself', async () => {
    expect((await onboardingState(db.web, real)).next).toBe('business');
    await setOnboardingStep(db.web, real, 'logo', 'skipped');
    await setOnboardingStep(db.web, real, 'look', 'done');
    let s = await onboardingState(db.web, real);
    expect(s.steps.find((x) => x.key === 'logo')!.state).toBe('skipped');
    expect(s.steps.find((x) => x.key === 'look')!.state).toBe('done');
    await createParty(db.web, real, { kind: 'customer', name: 'Asha Stores', stateCode: '27' });
    s = await onboardingState(db.web, real);
    expect(s.steps.find((x) => x.key === 'customer')!.state).toBe('done');
    await setOnboardingStep(db.web, real, 'logo', 'todo');
    expect((await onboardingState(db.web, real)).steps.find((x) => x.key === 'logo')!.state).toBe('todo');
    await expect(setOnboardingStep(db.web, real, 'nonsense', 'done')).rejects.toThrow();
  });

  it('makes a labelled demo business once, with a mix of paid, part paid, overdue, draft and quotes', async () => {
    const first = await createDemoBusiness(db.web, userId);
    expect(first.created).toBe(true);
    const again = await createDemoBusiness(db.web, userId);
    expect(again).toEqual({ businessId: first.businessId, created: false });
    expect(await findDemoBusiness(db.web, userId)).toBe(first.businessId);
    expect(await isDemoBusiness(db.web, first.businessId)).toBe(true);
    expect(await isDemoBusiness(db.web, real.businessId)).toBe(false);

    const t = await resolveTenant(db.web, userId, first.businessId);
    const docs = await db.owner`select doc_type, status, payment_status, due_date < current_date as late from document where business_id = ${first.businessId}`;
    expect(docs.filter((d) => d.doc_type === 'tax_invoice' && d.status === 'issued')).toHaveLength(6);
    expect(docs.filter((d) => d.doc_type === 'tax_invoice' && d.status === 'draft')).toHaveLength(1);
    expect(docs.filter((d) => d.doc_type === 'estimate')).toHaveLength(2);
    const pay = docs.filter((d) => d.status === 'issued' && d.doc_type === 'tax_invoice').map((d) => d.payment_status);
    expect(pay.filter((p) => p === 'paid')).toHaveLength(3);
    expect(pay).toContain('part_paid');
    expect(docs.some((d) => d.status === 'issued' && d.doc_type === 'tax_invoice' && d.payment_status === 'unpaid' && d.late)).toBe(true);
    expect(t.role).toBe('owner');
    // the real business was not touched
    expect((await db.owner`select count(*)::int as n from document where business_id = ${real.businessId}`)[0]!.n).toBe(0);
  });

  it('removes only a demo business, only for its owner, and leaves the real one in the list', async () => {
    const demo = (await findDemoBusiness(db.web, userId))!;
    expect(await removeDemoBusiness(db.web, otherUser, demo)).toBe(false);
    expect(await removeDemoBusiness(db.web, userId, real.businessId)).toBe(false);
    expect(await removeDemoBusiness(db.web, userId, demo)).toBe(true);
    const list = await listBusinesses(db.web, userId);
    expect(list.map((b) => b.businessId)).toEqual([real.businessId]);
    expect(await findDemoBusiness(db.web, userId)).toBeNull();
    await expect(resolveTenant(db.web, userId, demo)).rejects.toThrow();
    // the member guard is back on: a real business still cannot lose its last owner
    await expect(db.owner`delete from member where business_id = ${real.businessId}`).rejects.toThrow(/at least one owner/);
  });
});
