import { writeOffInvoice } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

export const POST = tenantRoute(async ({ t, sql, req, params }) =>
  writeOffInvoice(sql, t, params.id!, String((await readJson(req)).reason ?? '')));
