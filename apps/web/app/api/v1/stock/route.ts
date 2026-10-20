import { stockLevels } from '@kora/core';
import { v1Route } from '../../../../lib/apiV1';

/** Query: q, low=1 to list only items at or under their reorder level. */
export const GET = v1Route({}, async ({ t, sql, req }) => {
  const q = new URL(req.url).searchParams;
  return { data: await stockLevels(sql, t, { q: q.get('q') ?? undefined, lowOnly: q.get('low') === '1' }) };
});
