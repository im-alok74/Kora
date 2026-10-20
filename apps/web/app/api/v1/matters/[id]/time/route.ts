import { addTime } from '@kora/core';
import { created, v1Route } from '../../../../../../lib/apiV1';

/** Body: { duration ("1:30" or "1.5"), description, date?, rate?, billable? }. */
export const POST = v1Route({ write: true }, async ({ t, sql, req, params }) =>
  created(await addTime(sql, t, params.id!, (await req.json()) as Parameters<typeof addTime>[3])));
