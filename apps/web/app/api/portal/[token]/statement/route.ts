import { portalStatement, STATEMENT_COLUMNS, toCsv } from '@kora/core';
import { errorResponse, json, services } from '../../../../../lib/server';

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const q = new URL(req.url).searchParams;
    const s = await portalStatement(services().sql, token, { from: q.get('from') ?? undefined, to: q.get('to') ?? undefined });
    if (!s) return json({ error: 'This link is not valid any more. Ask the business for a new one.' }, 404);
    if (q.get('format') === 'csv') {
      return new Response(toCsv(STATEMENT_COLUMNS, s.rows), {
        headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="statement_${s.from}_${s.to}.csv"`, 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
      });
    }
    return json(s, 200, { 'x-robots-tag': 'noindex' });
  } catch (e) { return errorResponse(e); }
}
