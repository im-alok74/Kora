import { createParty, listParties, type PartyInput } from '@kora/core';
import { created, page, v1Route } from '../../../../lib/apiV1';

export const GET = v1Route({}, async ({ t, sql, req }) => {
  const { q, limit, offset } = page(req);
  return { data: await listParties(sql, t, { q: q.get('q') ?? undefined, limit, offset }), limit, offset };
});

/** Body: { name, gstin?, stateCode?, phone?, email?, billingAddress?: { line1, city, pincode }, currency? }. A state is needed unless a GSTIN gives it. */
export const POST = v1Route({ write: true }, async ({ t, sql, req }) => created({ id: await createParty(sql, t, { kind: 'customer', ...((await req.json()) as Omit<PartyInput, 'kind'>) }) }));
