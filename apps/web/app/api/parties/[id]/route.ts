import { archiveParty, getParty, updateParty, type PartyInput } from '@kora/core';
import { json, tenantRoute } from '../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => {
  const p = await getParty(sql, t, params.id!);
  return p ? { party: p } : json({ error: 'Customer not found.' }, 404);
});
export const PUT = tenantRoute(async ({ t, sql, req, params }) => { await updateParty(sql, t, params.id!, (await req.json()) as PartyInput); });
export const DELETE = tenantRoute(async ({ t, sql, params }) => { await archiveParty(sql, t, params.id!); });
