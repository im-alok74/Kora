import { getDelivery } from '@kora/core';
import { json, tenantRoute } from '../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => (await getDelivery(sql, t, params.id!)) ?? json({ error: 'Not found.' }, 404));
