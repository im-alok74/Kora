import { adjustStock } from '@kora/core';
import { created, v1Route } from '../../../../../../lib/apiV1';

/** Body: { mode: "in" | "out" | "count", quantity (text), note?, date? }. "count" sets the on-hand figure after a stock take. */
export const POST = v1Route({ write: true }, async ({ t, sql, req, params }) =>
  created(await adjustStock(sql, t, params.itemId!, (await req.json()) as Parameters<typeof adjustStock>[3])));
