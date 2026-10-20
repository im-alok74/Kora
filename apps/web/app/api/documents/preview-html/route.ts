import { getTemplate, previewDocumentData, type DocIn } from '@kora/core';
import { renderDocumentHtml } from '@kora/pdf';
import { readJson, tenantRoute } from '../../../../lib/server';

/** The draft in the editor, drawn by the same renderer as the PDF. Nothing is saved. Body: the same JSON as saving a draft. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const input = await readJson<DocIn>(req);
  const data = await previewDocumentData(sql, t, input);
  return { html: renderDocumentHtml({ ...data, template: await getTemplate(sql, t) }) };
});
