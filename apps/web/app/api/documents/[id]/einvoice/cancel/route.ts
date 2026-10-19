import { cancelEinvoice } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../../lib/server';

export const POST = tenantRoute(async ({ t, sql, req, params, svc }) => {
  const b = await readJson<{ reason?: string; remark?: string }>(req);
  await cancelEinvoice(sql, t, svc.gsp, params.id!, { reason: String(b.reason ?? ''), remark: String(b.remark ?? '') });
  return { ok: true };
});
