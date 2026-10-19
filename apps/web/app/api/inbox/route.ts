import { addToInbox, listInbox } from '@kora/core';
import { readJson, tenantRoute } from '../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, req }) => ({ items: await listInbox(sql, t, { status: new URL(req.url).searchParams.get('status') ?? undefined }) }));
/** Body: { title, note?, name, type, data } with the file as base64. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson(req);
  return addToInbox(sql, t, { title: String(b.title ?? ''), note: b.note == null ? null : String(b.note), name: String(b.name ?? ''), type: String(b.type ?? ''), dataBase64: String(b.data ?? '') });
});
