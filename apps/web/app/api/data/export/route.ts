import { exportBackup, exportWorkbook } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

/**
 * format=xlsx: one Excel workbook (datasets=customers,items,... and from/to are optional).
 * format=backup: a ZIP of everything, as CSV files plus one JSON file.
 */
export const GET = tenantRoute(async ({ t, sql, req }) => {
  const q = new URL(req.url).searchParams;
  const headers = (type: string, filename: string) => ({ 'content-type': type, 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'no-store' });
  if (q.get('format') === 'backup') {
    const b = await exportBackup(sql, t);
    return new Response(new Uint8Array(b.buffer), { headers: headers('application/zip', b.filename) });
  }
  const sets = q.get('datasets');
  const x = await exportWorkbook(sql, t, { datasets: sets ? sets.split(',').filter(Boolean) : undefined, from: q.get('from') || undefined, to: q.get('to') || undefined });
  return new Response(new Uint8Array(x.buffer), { headers: headers('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', x.filename) });
}) as (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
