import { listDocuments, saveDraft, type DocIn } from '@kora/core';
import { tenantRoute } from '../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, req }) => {
  const q = new URL(req.url).searchParams;
  return {
    documents: await listDocuments(sql, t, {
      type: q.get('type') ?? undefined, status: q.get('status') ?? undefined, q: q.get('q') ?? undefined,
      limit: Number(q.get('limit') ?? 50), offset: Number(q.get('offset') ?? 0),
    }),
  };
});
/** Body is the document. For devices that sync later, clientRef and baseRev make retries and conflicts safe. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = (await req.json()) as DocIn & { clientRef?: string; baseRev?: number };
  const { clientRef, baseRev, ...doc } = b;
  return saveDraft(sql, t, doc as DocIn, null, { clientRef, baseRev });
});
