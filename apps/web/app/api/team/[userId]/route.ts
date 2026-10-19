import { changeRole, removeMember } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

export const PUT = tenantRoute(async ({ t, sql, req, params }) => {
  await changeRole(sql, t, params.userId!, String((await readJson(req)).role ?? ''));
});
export const DELETE = tenantRoute(async ({ t, sql, params }) => { await removeMember(sql, t, params.userId!); });
