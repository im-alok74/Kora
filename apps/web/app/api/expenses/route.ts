import { assertCan, EXPENSE_COLUMNS, listExpenses, saveExpense, toCsv, type ExpenseIn } from '@kora/core';
import { readJson, tenantRoute } from '../../../lib/server';

/** Expenses for a period (this month by default). Add format=csv for a spreadsheet (needs the export right). */
export const GET = tenantRoute(async ({ t, sql, req }) => {
  const q = new URL(req.url).searchParams;
  const r = await listExpenses(sql, t, { from: q.get('from') ?? undefined, to: q.get('to') ?? undefined, category: q.get('category') ?? undefined, q: q.get('q') ?? undefined });
  if (q.get('format') === 'csv') {
    assertCan(t.role, 'report.export');
    return new Response(toCsv(EXPENSE_COLUMNS, r.rows as any[]), {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="expenses_${r.from}_${r.to}.csv"`, 'cache-control': 'no-store' },
    });
  }
  return r;
});
export const POST = tenantRoute(async ({ t, sql, req }) => saveExpense(sql, t, (await readJson(req)) as unknown as ExpenseIn));
