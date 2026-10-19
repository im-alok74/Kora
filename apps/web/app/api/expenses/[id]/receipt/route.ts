import { getReceipt, removeReceipt, setReceipt } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

/** The receipt file. The type was checked when it was saved, so it is served as that type and never sniffed. */
export const GET = tenantRoute(async ({ t, sql, params }) => {
  const r = await getReceipt(sql, t, params.id!);
  if (!r) return new Response('No receipt', { status: 404 });
  return new Response(new Uint8Array(r.data), {
    headers: { 'content-type': r.type, 'content-disposition': `inline; filename="${r.name.replace(/"/g, '')}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' },
  });
});
/** Body: { name, type, data } with the file as base64. */
export const PUT = tenantRoute(async ({ t, sql, req, params }) => {
  const b = await readJson(req);
  await setReceipt(sql, t, params.id!, { name: String(b.name ?? ''), type: String(b.type ?? ''), dataBase64: String(b.data ?? '') });
});
export const DELETE = tenantRoute(async ({ t, sql, params }) => { await removeReceipt(sql, t, params.id!); });
