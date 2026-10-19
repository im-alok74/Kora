import { acceptGstr2bEntry } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../lib/server';

/** Body: { entryId }. Makes a bill from a statement line you do not have. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson(req);
  if (!isUuid(String(b.entryId ?? ''))) return json({ error: 'Choose a statement line.' }, 400);
  return acceptGstr2bEntry(sql, t, String(b.entryId));
});
