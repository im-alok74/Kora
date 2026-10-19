import { gstSummary } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, req }) => gstSummary(sql, t, new URL(req.url).searchParams.get('period') ?? ''));
