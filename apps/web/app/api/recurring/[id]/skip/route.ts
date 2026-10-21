import { skipNextRecurring } from '@kora/core';
import { tenantRoute } from '../../../../../lib/server';

/** Skips the next date of a running schedule. No invoice is made for it. */
export const POST = tenantRoute(async ({ t, sql, params }) => skipNextRecurring(sql, t, params.id!));
