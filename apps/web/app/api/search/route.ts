import { globalSearch } from '@kora/core';
import { tenantRoute } from '../../../lib/server';

/** One search over documents, customers, items, matters, bills and expenses. ?q=asha */
export const GET = tenantRoute(async ({ t, sql, req }) => globalSearch(sql, t, new URL(req.url).searchParams.get('q') ?? ''));
