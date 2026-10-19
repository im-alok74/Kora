import { queueDocumentSend, ValidationError, type SendChannel } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

/** Queues the send. The worker delivers it and retries on failure; poll /api/deliveries/:id for the result. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  const b = await readJson<{ channel?: string; to?: string }>(req);
  if (!['whatsapp', 'email', 'sms'].includes(String(b.channel))) throw new ValidationError('Choose WhatsApp, email or SMS.', 'channel');
  return queueDocumentSend(sql, t, { documentId: params.id!, channel: b.channel as SendChannel, to: String(b.to ?? '') });
});
