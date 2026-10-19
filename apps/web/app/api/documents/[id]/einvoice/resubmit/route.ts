import { resubmitEinvoice } from '@kora/core';
import { tenantRoute } from '../../../../../../lib/server';

export const POST = tenantRoute(async ({ t, sql, params }) => resubmitEinvoice(sql, t, params.id!));
