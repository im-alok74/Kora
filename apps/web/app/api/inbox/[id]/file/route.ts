import { getInboxFile } from '@kora/core';
import { tenantRoute } from '../../../../../lib/server';

/** Served as the type that was checked on upload, never sniffed. */
export const GET = tenantRoute(async ({ t, sql, params }) => {
  const r = await getInboxFile(sql, t, params.id!);
  if (!r) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(r.data), {
    headers: { 'content-type': r.type, 'content-disposition': `inline; filename="${r.name.replace(/"/g, '')}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' },
  });
});
