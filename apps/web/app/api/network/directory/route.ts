import { networkDirectory } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

/** Businesses that chose to be listed. ?q=steel */
export const GET = tenantRoute(async ({ t, sql, req }) => ({ businesses: await networkDirectory(sql, t, new URL(req.url).searchParams.get('q') ?? undefined) }));
