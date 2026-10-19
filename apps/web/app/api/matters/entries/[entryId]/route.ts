import { removeEntry, setEntryBillable } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../lib/server';

/** Body: { billable: boolean }. Entries already on an invoice are locked. */
export const PATCH = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.entryId!)) return json({ error: 'Entry not found.' }, 404);
  await setEntryBillable(sql, t, params.entryId!, (await readJson(req)).billable === true);
});
export const DELETE = tenantRoute(async ({ t, sql, params }) => {
  if (!isUuid(params.entryId!)) return json({ error: 'Entry not found.' }, 404);
  await removeEntry(sql, t, params.entryId!);
});
