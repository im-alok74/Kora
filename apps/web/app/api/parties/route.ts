import { createParty, listParties, type PartyInput } from '@kora/core';
import { tenantRoute } from '../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, req }) => {
  const u = new URL(req.url);
  return { parties: await listParties(sql, t, { q: u.searchParams.get('q') ?? undefined, kind: u.searchParams.get('kind') ?? undefined }) };
});
export const POST = tenantRoute(async ({ t, sql, req }) => ({ id: await createParty(sql, t, (await req.json()) as PartyInput) }));
