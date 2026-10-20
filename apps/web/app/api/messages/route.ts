import { getMessageTemplates, saveMessageTemplates, type MessageKind } from '@kora/core';
import { readJson, tenantRoute } from '../../../lib/server';

export const GET = tenantRoute(async ({ t, sql }) => getMessageTemplates(sql, t));
/** Body: { invoice?, reminder? }. Text with placeholders such as {customer}; an empty string goes back to Kora's wording. */
export const PUT = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson<Partial<Record<MessageKind, string | null>>>(req);
  return saveMessageTemplates(sql, t, { ...('invoice' in b ? { invoice: b.invoice } : {}), ...('reminder' in b ? { reminder: b.reminder } : {}) });
});
