import { setItcStatus } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../lib/server';

/** Body: { status: 'eligible' | 'blocked', reason? } */
export const PATCH = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Bill not found.' }, 404);
  const b = await readJson(req);
  await setItcStatus(sql, t, params.id!, String(b.status ?? '') as 'eligible', b.reason == null ? null : String(b.reason));
});
