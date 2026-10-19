import { addTime } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../../lib/server';

/** Body: { duration, description, date?, rate?, billable? } */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Matter not found.' }, 404);
  const b = await readJson(req);
  return addTime(sql, t, params.id!, {
    duration: String(b.duration ?? ''), description: String(b.description ?? ''), date: b.date ? String(b.date) : undefined,
    rate: b.rate ? String(b.rate) : undefined, billable: b.billable === false ? false : true,
  });
});
