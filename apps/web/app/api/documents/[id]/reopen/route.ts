import { reopenDocument } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

export const POST = tenantRoute(async ({ t, sql, req, params }) =>
  reopenDocument(sql, t, params.id!, String((await readJson(req)).reason ?? '')));
