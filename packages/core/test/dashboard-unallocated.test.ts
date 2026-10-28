import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { createBusiness, dashboardSummary, resolveTenant, type TenantSession } from '../src/index.js';

// Audit finding C-16: gateway money that cannot be applied to an invoice is shown on the dashboard.
let db: TestDb;
let t: TenantSession;
beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('dash@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Acme', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  t = await resolveTenant(db.web, u!.id as string, bid);
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('dashboard: money not applied to an invoice', () => {
  it('is zero at first, then counts a gateway payment with nothing allocated, and ignores manual ones', async () => {
    expect((await dashboardSummary(db.web, t)).unallocated).toEqual({ count: 0, amount: '0' });
    await db.owner`insert into payment (business_id, amount_paise, method, received_on, gateway, gateway_event_id, gateway_payment_id) values (${t.businessId}, 250000, 'upi', current_date, 'razorpay', 'evt_test_1', 'pay_test_1')`;
    await db.owner`insert into payment (business_id, amount_paise, method, received_on) values (${t.businessId}, 99900, 'cash', current_date)`;
    expect((await dashboardSummary(db.web, t)).unallocated).toEqual({ count: 1, amount: '250000' });
  });
});
