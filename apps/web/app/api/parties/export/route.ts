import { assertCan, PARTY_EXPORT_COLUMNS, partiesExport, tableToXlsx, toCsv } from '@kora/core';
import { tenantRoute } from '../../../../lib/server';

/** ?format=csv|xlsx&kind=customer|vendor. Every active customer or vendor, in the columns the import reads back. Needs the export right. */
export const GET = tenantRoute(async ({ t, sql, req }) => {
  assertCan(t.role, 'report.export');
  const q = new URL(req.url).searchParams;
  const kind = q.get('kind') === 'vendor' ? 'vendor' : q.get('kind') === 'customer' ? 'customer' : undefined;
  const rows = await partiesExport(sql, t, { kind });
  const name = kind ? `${kind}s` : 'customers_and_vendors';
  if (q.get('format') === 'xlsx') {
    const body = tableToXlsx(PARTY_EXPORT_COLUMNS.map((c) => c.label), rows.map((r) => PARTY_EXPORT_COLUMNS.map((c) => (r as Record<string, string>)[c.key as string])), 'Parties');
    return new Response(new Uint8Array(body), { headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="${name}.xlsx"`, 'cache-control': 'no-store' } });
  }
  return new Response(toCsv(PARTY_EXPORT_COLUMNS, rows), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}.csv"`, 'cache-control': 'no-store' } });
}) as (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
