import { stockLevels } from '@kora/core';
import { tenantRoute } from '../../../lib/server';

/** Stock levels for items that track stock. ?q=tea&low=1 */
export const GET = tenantRoute(async ({ t, sql, req }) => {
  const u = new URL(req.url).searchParams;
  return { items: await stockLevels(sql, t, { q: u.get('q') ?? undefined, lowOnly: u.get('low') === '1' }) };
});
