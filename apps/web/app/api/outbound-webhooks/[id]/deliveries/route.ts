import { listWebhookDeliveries } from '@kora/core';
import { tenantRoute } from '../../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => ({ deliveries: await listWebhookDeliveries(sql, t, params.id!) }));
