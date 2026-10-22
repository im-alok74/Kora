import { portalStatement, portalStatementPdfData, STATEMENT_COLUMNS, toCsv } from '@kora/core';
import { renderPdf, renderStatementHtml, type StatementInput } from '@kora/pdf';
import { errorResponse, json, services } from '../../../../../lib/server';
import { portalGate } from '../../../../../lib/portal';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const gate = await portalGate(token);
    if (gate) return gate;
    const q = new URL(req.url).searchParams;
    if (q.get('format') === 'pdf') {
      const d = await portalStatementPdfData(services().sql, token, { from: q.get('from') ?? undefined, to: q.get('to') ?? undefined });
      if (!d) return json({ error: 'This link is not valid any more. Ask the business for a new one.' }, 404);
      const st = d.statement;
      const html = renderStatementHtml({ supplier: d.supplier, customer: st.party as StatementInput['customer'], from: st.from, to: st.to, opening: st.opening, closing: st.closing, rows: st.rows, ageing: d.ageing, accent: d.accent });
      const pdf = await renderPdf(html, 'A4');
      return new Response(new Uint8Array(pdf), { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="statement_${st.from}_${st.to}.pdf"`, 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
    }
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
