import { getBusiness, sanitiseTemplate } from '@kora/core';
import { LAYOUTS, renderDocumentHtml, sampleInput } from '@kora/pdf';
import { readJson, tenantRoute } from '../../../../lib/server';

/** One sample per look, in the business's own colour, font, language and details. Body: the template being edited. Writes nothing. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const body = await readJson(req);
  const base = sanitiseTemplate(body);
  const quotation = body.documentType === 'estimate';
  const supplier = await getBusiness(sql, t);
  return { layouts: LAYOUTS.map((l) => {
    const input = sampleInput(supplier, { ...base, layout: l.key as typeof base.layout });
    if (quotation) { input.doc.doc_type = 'estimate'; input.doc.number = 'QUO/26-27/0001'; input.doc.notes = 'Quotation for the proposed work. This is not a tax invoice.'; }
    return { ...l, html: renderDocumentHtml(input) };
  }) };
});
