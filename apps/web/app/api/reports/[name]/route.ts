import {
  CUSTOMER_COLUMNS, PAYMENT_COLUMNS, SALES_COLUMNS, STATEMENT_COLUMNS, customerStatement, paymentsReceived, salesByCustomer, salesRegister,
  toCsv, ValidationError, assertCan, type Column,
} from '@kora/core';
import { json, tenantRoute } from '../../../../lib/server';

function csv(name: string, columns: Column<any>[], rows: any[]) {
  return new Response(toCsv(columns, rows), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}.csv"`, 'cache-control': 'no-store' },
  });
}

/** sales, customers, payments and statement. Add format=csv for a spreadsheet file (needs the export right). */
export const GET = tenantRoute(async ({ t, sql, req, params }) => {
  const q = new URL(req.url).searchParams;
  const range = { from: q.get('from') ?? undefined, to: q.get('to') ?? undefined };
  const wantCsv = q.get('format') === 'csv';
  if (wantCsv) assertCan(t.role, 'report.export');
  switch (params.name) {
    case 'sales': { const r = await salesRegister(sql, t, range); return wantCsv ? csv(`sales_${r.from}_${r.to}`, SALES_COLUMNS, r.rows) : r; }
    case 'customers': { const r = await salesByCustomer(sql, t, range); return wantCsv ? csv(`customers_${r.from}_${r.to}`, CUSTOMER_COLUMNS, r.rows) : r; }
    case 'payments': { const r = await paymentsReceived(sql, t, range); return wantCsv ? csv(`payments_${r.from}_${r.to}`, PAYMENT_COLUMNS, r.rows) : r; }
    case 'statement': {
      const r = await customerStatement(sql, t, q.get('party') ?? '', range);
      return wantCsv ? csv(`statement_${r.from}_${r.to}`, STATEMENT_COLUMNS, r.rows) : r;
    }
    default: throw new ValidationError('Unknown report.');
  }
}) as (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
void json;
