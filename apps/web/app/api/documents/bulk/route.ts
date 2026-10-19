import { bulkDocuments, type BulkAction } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

/** Body: { action: 'issue' | 'delete' | 'cancel' | 'remind', ids: string[], reason?, channel? }. Up to 50 documents; each result is reported on its own. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson(req);
  return bulkDocuments(sql, t, {
    action: String(b.action ?? '') as BulkAction, ids: Array.isArray(b.ids) ? b.ids.map(String) : [], reason: b.reason == null ? undefined : String(b.reason),
    channel: b.channel === 'email' || b.channel === 'sms' ? b.channel : 'whatsapp',
  });
});
