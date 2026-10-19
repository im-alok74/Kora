import { reconcileGstr2b } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

/** Body: { period }. Matches new bills to the statement, then returns matched, differing, statement-only and books-only lines. */
export const POST = tenantRoute(async ({ t, sql, req }) => reconcileGstr2b(sql, t, String((await readJson(req)).period ?? '')));
