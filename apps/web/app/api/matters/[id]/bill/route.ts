import { billMatter } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../lib/server';

/** Body: { upTo? } Makes a draft invoice from the unbilled entries. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Matter not found.' }, 404);
  const b = await readJson(req);
  return billMatter(sql, t, params.id!, { upTo: b.upTo ? String(b.upTo) : undefined });
});
