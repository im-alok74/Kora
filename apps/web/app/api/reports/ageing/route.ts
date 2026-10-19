import { ageingReport, assertCan, toCsv } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, req }) => {
  const q = new URL(req.url).searchParams;
  const r = await ageingReport(sql, t, { asOf: q.get('asOf') ?? undefined });
  if (q.get('format') !== 'csv') return r;
  assertCan(t.role, 'report.export');
  const rows = r.rows.map((x) => ({ customer: x.partyName, ...x.buckets, total: x.totalPaise }));
  const cols = [{ key: 'customer', label: 'Customer' }, { key: 'not_due', label: 'Not due', money: true }, { key: 'd1_30', label: '1-30 days', money: true },
    { key: 'd31_60', label: '31-60 days', money: true }, { key: 'd61_90', label: '61-90 days', money: true }, { key: 'd90_plus', label: 'Over 90 days', money: true },
    { key: 'total', label: 'Total', money: true }] as const;
  return new Response(toCsv([...cols] as never, rows), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="ageing_${r.asOf}.csv"`, 'cache-control': 'no-store' },
  });
});
