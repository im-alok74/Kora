import { createRecurring, listRecurring, type RecurringIn } from '@kora/core';
import { readJson, tenantRoute } from '../../../lib/server';

export const GET = tenantRoute(async ({ t, sql }) => ({ recurring: await listRecurring(sql, t) }));
export const POST = tenantRoute(async ({ t, sql, req }) => createRecurring(sql, t, (await readJson(req)) as unknown as RecurringIn));
