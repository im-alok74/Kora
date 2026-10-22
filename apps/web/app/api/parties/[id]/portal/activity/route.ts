import { listPortalActivity, replyPortalComment } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../../lib/server';

/** What the customer has said or sent through their portal: comments, and purchase orders they attached. */
export const GET = tenantRoute(async ({ t, sql, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Customer not found.' }, 404);
  return listPortalActivity(sql, t, params.id!);
});

/** Body: { documentId, body }. A reply that shows on their portal under the document. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson(req);
  return replyPortalComment(sql, t, String(b.documentId ?? ''), String(b.body ?? ''));
});
