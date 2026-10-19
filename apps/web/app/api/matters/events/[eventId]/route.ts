import { removeEvent, setEventDone } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../lib/server';

/** Body: { done: boolean } */
export const PATCH = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.eventId!)) return json({ error: 'That date was not found.' }, 404);
  await setEventDone(sql, t, params.eventId!, (await readJson(req)).done === true);
});
export const DELETE = tenantRoute(async ({ t, sql, params }) => {
  if (!isUuid(params.eventId!)) return json({ error: 'That date was not found.' }, 404);
  await removeEvent(sql, t, params.eventId!);
});
