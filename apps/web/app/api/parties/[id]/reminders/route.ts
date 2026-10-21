import { getCustomerReminder, previewReminder, reminderHistory, saveCustomerReminder } from '@kora/core';
import { isUuid, json, tenantRoute } from '../../../../../lib/server';

/** The customer's reminder schedule (their own, or the business's), what is coming up, what was sent, and a preview of the message. */
export const GET = tenantRoute(async ({ t, sql, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Customer not found.' }, 404);
  const [schedule, history, preview] = await Promise.all([getCustomerReminder(sql, t, params.id!), reminderHistory(sql, t, { partyId: params.id!, limit: 50 }), previewReminder(sql, t, { partyId: params.id! })]);
  return { ...schedule, history, preview };
});
/** Body: { enabled, channel, offsets } to use their own schedule, or null to follow the business's. */
export const PUT = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Customer not found.' }, 404);
  return saveCustomerReminder(sql, t, params.id!, await req.json());
});
/** Body: { enabled, channel, offsets } to preview a schedule before saving it. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Customer not found.' }, 404);
  return previewReminder(sql, t, { partyId: params.id!, config: await req.json() });
});
