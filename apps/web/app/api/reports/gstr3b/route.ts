import { gstr3b } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

/** GSTR-3B data for a month. With ?download=1 it returns just the JSON file. */
export const GET = tenantRoute(async ({ t, sql, req }) => {
  const u = new URL(req.url);
  const r = await gstr3b(sql, t, u.searchParams.get('period') ?? '');
  if (u.searchParams.get('download') === '1') {
    return new Response(JSON.stringify(r.json, null, 2), {
      headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="GSTR3B_${r.period}.json"`, 'cache-control': 'no-store' },
    });
  }
  return r;
});
