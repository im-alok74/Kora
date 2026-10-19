import { notifications } from '@kora/core';
import { tenantRoute } from '../../../lib/server';

/** What needs attention now, worked out from the data each time. */
export const GET = tenantRoute(async ({ t, sql }) => notifications(sql, t));
