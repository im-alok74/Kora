import { deleteDraft, getDocument, saveDraft, type DocIn } from '@kora/core';
import { json, tenantRoute } from '../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => (await getDocument(sql, t, params.id!)) ?? json({ error: 'Document not found.' }, 404));
export const PUT = tenantRoute(async ({ t, sql, req, params }) => {
  const b = (await req.json()) as DocIn & { clientRef?: string; baseRev?: number };
  const { clientRef, baseRev, ...doc } = b;
  return saveDraft(sql, t, doc as DocIn, params.id!, { clientRef, baseRev });
});
export const DELETE = tenantRoute(async ({ t, sql, params }) => { await deleteDraft(sql, t, params.id!); });
