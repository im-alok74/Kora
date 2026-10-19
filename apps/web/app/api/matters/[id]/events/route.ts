import { addEvent } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../lib/server';

/** Body: { date, title, kind?: 'hearing' | 'deadline' | 'other', notes? } */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Matter not found.' }, 404);
  const b = await readJson(req);
  return addEvent(sql, t, params.id!, { date: String(b.date ?? ''), title: String(b.title ?? ''), kind: b.kind ? String(b.kind) : undefined, notes: b.notes == null ? null : String(b.notes) });
});
