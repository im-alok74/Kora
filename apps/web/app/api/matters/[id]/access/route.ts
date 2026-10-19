import { getMatterAccess, setMatterAccess } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../lib/server';

/** Owner only. Who is in the business and whether this matter is private to chosen people. */
export const GET = tenantRoute(async ({ t, sql, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Matter not found.' }, 404);
  return (await getMatterAccess(sql, t, params.id!)) ?? json({ error: 'Matter not found.' }, 404);
});
/** Body: { restricted: boolean, userIds?: string[] } */
export const PUT = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Matter not found.' }, 404);
  const b = await readJson(req);
  const userIds = Array.isArray(b.userIds) ? b.userIds.map(String).filter(isUuid) : [];
  await setMatterAccess(sql, t, params.id!, { restricted: b.restricted === true, userIds });
});
