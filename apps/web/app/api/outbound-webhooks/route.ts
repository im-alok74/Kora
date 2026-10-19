import { createWebhook, listWebhooks, WEBHOOK_EVENTS } from '@kora/core';
import { readJson, tenantRoute } from '../../../lib/server';

export const GET = tenantRoute(async ({ t, sql }) => ({ webhooks: await listWebhooks(sql, t), events: WEBHOOK_EVENTS }));
/** Body: { url, events: [...] or ["*"], description? }. The signing secret is in the answer once. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson<{ url?: string; events?: string[]; description?: string }>(req);
  return createWebhook(sql, t, { url: String(b.url ?? ''), events: b.events ?? [], description: b.description });
});
