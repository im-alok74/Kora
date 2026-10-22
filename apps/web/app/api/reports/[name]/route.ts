import {
  CUSTOMER_COLUMNS, ITEM_COLUMNS, MONTH_COLUMNS, PAYABLE_COLUMNS, PAYMENT_COLUMNS, PNL_COLUMNS, SALES_COLUMNS, STATEMENT_COLUMNS, TDS_COLUMNS, TDS_PAYABLE_COLUMNS,
  customerStatement, paymentsReceived, payablesRows, profitAndLoss, reportToXlsx, salesByCustomer, salesByItem, salesByMonth, salesRegister, tdsPayable, tdsReceivable,
  toCsv, ValidationError, assertCan, type Column,
} from '@kora/core';
import { json, tenantRoute } from '../../../../lib/server';

/** CSV or Excel when asked for, otherwise null so the caller sends JSON. */
function file(format: string | null, name: string, columns: Column<any>[], rows: any[]) {
  if (format === 'xlsx') {
    return new Response(new Uint8Array(reportToXlsx(columns, rows, name.slice(0, 31))), {
      headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="${name}.xlsx"`, 'cache-control': 'no-store' },
    });
  }
  if (format === 'csv') {
    return new Response(toCsv(columns, rows), {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}.csv"`, 'cache-control': 'no-store' },
    });
  }
  return null;
}

/** Reports by name. Add format=csv or format=xlsx for a spreadsheet file (needs the export right). */
export const GET = tenantRoute(async ({ t, sql, req, params }) => {
  const q = new URL(req.url).searchParams;
  const range = { from: q.get('from') ?? undefined, to: q.get('to') ?? undefined };
  const format = q.get('format');
  if (format === 'csv' || format === 'xlsx') assertCan(t.role, 'report.export');
  else if (format) throw new ValidationError('Choose csv or xlsx.', 'format');
  switch (params.name) {
    case 'sales': { const r = await salesRegister(sql, t, range); return file(format, `sales_${r.from}_${r.to}`, SALES_COLUMNS, r.rows) ?? r; }
    case 'customers': { const r = await salesByCustomer(sql, t, range); return file(format, `customers_${r.from}_${r.to}`, CUSTOMER_COLUMNS, r.rows) ?? r; }
    case 'items': { const r = await salesByItem(sql, t, range); return file(format, `items_${r.from}_${r.to}`, ITEM_COLUMNS, r.rows) ?? r; }
    case 'months': { const r = await salesByMonth(sql, t, range); return file(format, `months_${r.from}_${r.to}`, MONTH_COLUMNS, r.rows) ?? r; }
    case 'pnl': { const r = await profitAndLoss(sql, t, range); return file(format, `profit_and_loss_${r.from}_${r.to}`, PNL_COLUMNS, r.rows) ?? r; }
    case 'payables': { const r = await payablesRows(sql, t); return file(format, `payables_${r.asOf}`, PAYABLE_COLUMNS, r.rows) ?? r; }
    case 'payments': { const r = await paymentsReceived(sql, t, range); return file(format, `payments_${r.from}_${r.to}`, PAYMENT_COLUMNS, r.rows) ?? r; }
    case 'tds': { const r = await tdsReceivable(sql, t, range); return file(format, `tds_${r.from}_${r.to}`, TDS_COLUMNS, r.rows) ?? r; }
    case 'tdspayable': { const r = await tdsPayable(sql, t, range); return file(format, `tds_payable_${r.from}_${r.to}`, TDS_PAYABLE_COLUMNS, r.rows) ?? r; }
    case 'statement': {
      const r = await customerStatement(sql, t, q.get('party') ?? '', range);
      return file(format, `statement_${r.from}_${r.to}`, STATEMENT_COLUMNS, r.rows) ?? r;
    }
    default: throw new ValidationError('Unknown report.');
  }
}) as (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
void json;
