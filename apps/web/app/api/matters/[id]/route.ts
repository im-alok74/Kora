import { getMatter, updateMatter } from '@kora/core';
import { isUuid, json, readJson, tenantRoute } from '../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Matter not found.' }, 404);
  const m = await getMatter(sql, t, params.id!);
  return m ?? json({ error: 'Matter not found.' }, 404);
});
/** Body: any of { title, reference, rate, sac, reverseCharge, tdsBp, notes, status }. */
export const PATCH = tenantRoute(async ({ t, sql, req, params }) => {
  if (!isUuid(params.id!)) return json({ error: 'Matter not found.' }, 404);
  const b = await readJson(req);
  const pick = <T,>(k: string, f: (v: unknown) => T) => (k in b ? { [k]: b[k] == null ? null : f(b[k]) } : {});
  await updateMatter(sql, t, params.id!, {
    ...pick('title', String), ...pick('reference', String), ...pick('rate', String), ...pick('sac', String), ...pick('notes', String),
    ...('reverseCharge' in b ? { reverseCharge: b.reverseCharge === true } : {}), ...('tdsBp' in b ? { tdsBp: Number(b.tdsBp) } : {}),
    ...('status' in b ? { status: b.status === 'closed' ? 'closed' as const : b.status === 'open' ? 'open' as const : (b.status as never) } : {}),
  });
});
