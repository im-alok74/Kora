import { getPartyExtras, setPartyExtras, type PartyExtrasInput } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../lib/server';

/** Tags, credit limit and opening balance, with how much is owed against the limit. */
export const GET = tenantRoute(async ({ t, sql, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Customer not found.' }, 404);
  return getPartyExtras(sql, t, params.id!);
});

/** Body: { tags?, creditLimit?, openingBalance?, openingBalanceOn? }. A field left out is not changed. */
export const PUT = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Customer not found.' }, 404);
  await setPartyExtras(sql, t, params.id!, (await readJson(req)) as PartyExtrasInput);
  return { ok: true };
});
