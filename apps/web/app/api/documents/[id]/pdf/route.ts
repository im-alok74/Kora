import { renderDocumentHtml, renderPdf } from '@kora/pdf';
import { json, renderInputFor, tenantRoute } from '../../../../../lib/server';

export const runtime = 'nodejs';

export const GET = tenantRoute(async ({ t, sql, params }) => {
  const input = await renderInputFor(sql, t, params.id!);
  if (!input) return json({ error: 'Document not found.' }, 404);
  const pdf = await renderPdf(renderDocumentHtml(input), input.template.paper);
  const name = String(input.doc.number ?? 'draft').replace(/[^A-Za-z0-9-]/g, '-');
  return new Response(new Uint8Array(pdf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${name}.pdf"`, 'cache-control': 'no-store' },
  });
});
