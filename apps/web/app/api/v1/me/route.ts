import { inTenant } from '@kora/core';
import { v1Route } from '../../../../lib/apiV1';

/** Which business this key belongs to, and what it may do. A good first call to check a key works. */
export const GET = v1Route({}, async ({ t, sql, scope }) => {
  const [b] = await inTenant(sql, t, 'document.read', (tx) => tx`select id, legal_name, trade_name, gstin, state_code from business where id = ${t.businessId}`);
  return { business: b, access: scope };
});
