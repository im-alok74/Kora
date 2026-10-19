import { payablesAgeing } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

/** What is owed to vendors, oldest first, in age buckets. */
export const GET = tenantRoute(async ({ t, sql }) => payablesAgeing(sql, t));
