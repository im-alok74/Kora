import { getAttachment, removeAttachment } from '@kora/core';
import { tenantRoute } from '../../../../../../lib/server';

/** The file, served as the type it was checked to be and never sniffed. */
export const GET = tenantRoute(async ({ t, sql, params }) => {
  const f = await getAttachment(sql, t, params.id!, params.fileId!);
  if (!f) return new Response('No such file', { status: 404 });
  return new Response(new Uint8Array(f.data), {
    headers: { 'content-type': f.type, 'content-disposition': `inline; filename="${f.name.replace(/"/g, '')}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' },
  });
});
export const DELETE = tenantRoute(async ({ t, sql, params }) => { await removeAttachment(sql, t, params.id!, params.fileId!); });
