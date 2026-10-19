import { dashboardSummary } from '@kora/core';
import { tenantRoute } from '../../../lib/server';

export const GET = tenantRoute(async ({ t, sql }) => dashboardSummary(sql, t));
