import { mergeParties } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../lib/server';

/** Body: { keepId, dropId }. Folds the second into the first. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson(req);
  if (!isUuid(String(b.keepId ?? '')) || !isUuid(String(b.dropId ?? ''))) return json({ error: 'Choose two parties to merge.' }, 400);
  return mergeParties(sql, t, String(b.keepId), String(b.dropId));
});
