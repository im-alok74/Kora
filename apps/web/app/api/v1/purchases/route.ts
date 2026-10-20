import { createBill, listBills } from '@kora/core';
import { created, page, v1Route } from '../../../../lib/apiV1';

/** Query: q, state, from, to (dates), limit. */
export const GET = v1Route({}, async ({ t, sql, req }) => {
  const { q, limit } = page(req);
  return { data: await listBills(sql, t, { q: q.get('q') ?? undefined, state: q.get('state') ?? undefined, from: q.get('from') ?? undefined, to: q.get('to') ?? undefined, limit }), limit };
});

/** Body as in the app's "Add a bill" form: vendor, bill number and date, lines with rate and tax. Returns { id, totalPaise }. */
export const POST = v1Route({ write: true }, async ({ t, sql, req }) => created(await createBill(sql, t, (await req.json()) as Parameters<typeof createBill>[2])));
