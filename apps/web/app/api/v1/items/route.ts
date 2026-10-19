import { createItem, listItems, type ItemInput } from '@kora/core';
import { created, page, v1Route } from '../../../../lib/apiV1';

export const GET = v1Route({}, async ({ t, sql, req }) => {
  const { q, limit, offset } = page(req);
  return { data: await listItems(sql, t, { q: q.get('q') ?? undefined, limit, offset }), limit, offset };
});

/** Body: { name, kind?: "goods"|"service", hsnSac?, unit?, defaultRateBp (1800 = 18%), price? (rupees as text) }. */
export const POST = v1Route({ write: true }, async ({ t, sql, req }) => created({ id: await createItem(sql, t, (await req.json()) as ItemInput) }));
