import { voidPayment } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

/** Removes a manual payment entered by mistake (owner only). */
export const DELETE = tenantRoute(async ({ t, sql, params }) => { await voidPayment(sql, t, params.id!); });
