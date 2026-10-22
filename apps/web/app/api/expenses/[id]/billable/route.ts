import { setBillable } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../lib/server';

/** Body: { partyId } to bill this expense to a customer, or { partyId: null } to clear it. */
export const PUT = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Expense not found.' }, 404);
  const b = await readJson(req);
  await setBillable(sql, t, params.id!, b.partyId ? String(b.partyId) : null);
});
