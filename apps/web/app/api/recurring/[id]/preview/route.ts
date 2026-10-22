import { recurringPreview } from '@kora/core';
import { tenantRoute } from '../../../../../lib/server';

/** The next few runs of a saved schedule and what each invoice would come to. */
export const GET = tenantRoute(async ({ t, sql, params, req }) => recurringPreview(sql, t, params.id!, Number(new URL(req.url).searchParams.get('count') ?? 6) || 6));
