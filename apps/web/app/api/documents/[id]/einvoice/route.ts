import { getEinvoice } from '@kora/core';
import { tenantRoute } from '../../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => getEinvoice(sql, t, params.id!));
