import { listReminders, sendReminderNow, ValidationError, type SendChannel } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => ({ reminders: await listReminders(sql, t, params.id!) }));
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  const b = await readJson<{ channel?: string; to?: string }>(req);
  if (!['whatsapp', 'email', 'sms'].includes(String(b.channel))) throw new ValidationError('Choose WhatsApp, email or SMS.', 'channel');
  return sendReminderNow(sql, t, { documentId: params.id!, channel: b.channel as SendChannel, to: String(b.to ?? '') });
});
