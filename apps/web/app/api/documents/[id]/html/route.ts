import { renderDocumentHtml } from '@kora/pdf';
import { json, renderInputFor, tenantRoute } from '../../../../../lib/server';

/** The document as the PDF will print it. Used for the preview pane. */
export const GET = tenantRoute(async ({ t, sql, params }) => {
  const input = await renderInputFor(sql, t, params.id!);
  if (!input) return json({ error: 'Document not found.' }, 404);
  return json({ html: renderDocumentHtml(input) });
});
