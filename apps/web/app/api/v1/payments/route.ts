import { paymentsReceived } from '@kora/core';
import { v1Route } from '../../../../lib/apiV1';

/** Payments received between from and to (YYYY-MM-DD). This month by default. */
export const GET = v1Route({}, async ({ t, sql, req }) => {
  const q = new URL(req.url).searchParams;
  const r = await paymentsReceived(sql, t, { from: q.get('from') ?? undefined, to: q.get('to') ?? undefined });
  return { data: r.rows, from: r.from, to: r.to, total: r.total };
});
