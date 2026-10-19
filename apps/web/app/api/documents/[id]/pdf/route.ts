// Starting the serverless Chromium takes a few seconds the first time.
export const maxDuration = 30;
import { paperFor, renderDocumentHtml, renderPdf } from '@kora/pdf';
import { json, renderInputFor, tenantRoute } from '../../../../../lib/server';

export const runtime = 'nodejs';

/** ?layout=thermal prints this one document as an 80 mm receipt, whatever the business's usual layout is. */
export const GET = tenantRoute(async ({ t, sql, params, req }) => {
  const input = await renderInputFor(sql, t, params.id!);
  if (!input) return json({ error: 'Document not found.' }, 404);
  const asked = new URL(req.url).searchParams.get('layout');
  if (asked === 'thermal') input.template = { ...input.template, layout: 'thermal' };
  const pdf = await renderPdf(renderDocumentHtml(input), paperFor(input.template));
  const name = String(input.doc.number ?? 'draft').replace(/[^A-Za-z0-9-]/g, '-');
  return new Response(new Uint8Array(pdf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${name}.pdf"`, 'cache-control': 'no-store' },
  });
});
