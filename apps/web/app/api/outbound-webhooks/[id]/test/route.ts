import { testWebhook } from '@kora/core';
import { tenantRoute } from '../../../../../lib/server';

/** Sends one signed test event now and says what the other server answered. */
export const POST = tenantRoute(async ({ t, sql, params }) => testWebhook(sql, t, params.id!));
