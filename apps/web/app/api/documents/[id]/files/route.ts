import { addAttachment, listAttachments } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => ({ files: await listAttachments(sql, t, params.id!) }));
/** Body: { name, type, data } with the file as base64. At most three files of 2 MB each, JPEG, PNG or PDF. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  const b = await readJson(req);
  return addAttachment(sql, t, params.id!, { name: String(b.name ?? ''), type: String(b.type ?? ''), dataBase64: String(b.data ?? '') });
});
