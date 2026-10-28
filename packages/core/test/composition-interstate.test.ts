import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { createBusiness, createParty, resolveTenant, saveDraft, type TenantSession } from '../src/index.js';

// Audit finding C-19: a composition dealer cannot sell goods to another state (CGST Act s10(2)). Refused when the draft is saved.
let db: TestDb;
let t: TenantSession;
let same: string, other: string;
beforeAll(async () => {
  db = await makeTestDb();
  const [u] = await db.owner`insert into app_user (email) values ('comp@example.test') returning id`;
  const bid = await createBusiness(db.web, u!.id as string, { legalName: 'Small Trader', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'composition' });
  t = await resolveTenant(db.web, u!.id as string, bid);
  same = await createParty(db.web, t, { kind: 'customer', name: 'Local', stateCode: '27' });
  other = await createParty(db.web, t, { kind: 'customer', name: 'Far', stateCode: '29' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

const draft = (partyId: string, kind: 'goods' | 'service') => saveDraft(db.web, t, {
  docType: 'bill_of_supply', partyId, docDate: '2026-10-01', lines: [{ name: 'Item', hsnSac: kind === 'goods' ? '1006' : '998313', quantity: '1', rate: '100', taxRateBp: 0, kind }],
});

describe('composition dealer', () => {
  it('can sell goods in its own state', async () => { await expect(draft(same, 'goods')).resolves.toBeTruthy(); });
  it('cannot sell goods to another state, and is told when saving', async () => {
    await expect(draft(other, 'goods')).rejects.toThrow(/another state/);
  });
});
