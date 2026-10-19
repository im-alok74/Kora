// Starting the serverless Chromium takes a few seconds the first time.
export const maxDuration = 30;
import { getPublicDocument } from '@kora/core';
import { paperFor, renderDocumentHtml, renderPdf } from '@kora/pdf';
import { irnBlock, services, withUpi } from '../../../../lib/server';

export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const d = await getPublicDocument(services().sql, token);
  if (!d) return new Response('Not found', { status: 404 });
  const html = renderDocumentHtml({ ...(await withUpi({ doc: d, lines: d.lines, supplier: d.supplier_snapshot ?? {}, recipient: d.recipient_snapshot ?? null, template: d.template })), irn: await irnBlock(d.einvoice) });
  const pdf = await renderPdf(html, paperFor(d.template));
  const name = String(d.number ?? 'document').replace(/[^A-Za-z0-9-]/g, '-');
  return new Response(new Uint8Array(pdf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${name}.pdf"`, 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  });
}
