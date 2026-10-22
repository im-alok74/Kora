import { msmeDue } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

/** Unpaid bills from micro and small vendors, most urgent first, with the 45-day last day. */
export const GET = tenantRoute(async ({ t, sql }) => msmeDue(sql, t));
