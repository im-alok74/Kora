import { auditLog } from '@kora/core';
import { tenantRoute } from '../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, req }) => {
  const q = new URL(req.url).searchParams;
  return { entries: await auditLog(sql, t, { table: q.get('table') ?? undefined, rowId: q.get('row') ?? undefined, limit: Number(q.get('limit') ?? 100) }) };
});
