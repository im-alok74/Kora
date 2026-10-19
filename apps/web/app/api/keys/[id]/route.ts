import { revokeApiKey } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

export const DELETE = tenantRoute(async ({ t, sql, params }) => { await revokeApiKey(sql, t, params.id!); });
