import { setRecurringActive } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

export const POST = tenantRoute(async ({ t, sql, req, params }) => setRecurringActive(sql, t, params.id!, (await readJson(req)).active === true));
