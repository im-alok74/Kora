import { cancelWriteOff } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../../lib/server';

export const POST = tenantRoute(async ({ t, sql, req, params }) =>
  cancelWriteOff(sql, t, params.id!, String((await readJson(req)).reason ?? '')));
