import { getBusiness, sanitiseTemplate } from '@kora/core';
import { LAYOUTS, renderSample } from '@kora/pdf';
import { readJson, tenantRoute } from '../../../../lib/server';

/** One sample per look, in the business's own colour, font, language and details. Body: the template being edited. Writes nothing. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const base = sanitiseTemplate(await readJson(req));
  const supplier = await getBusiness(sql, t);
  return { layouts: LAYOUTS.map((l) => ({ ...l, html: renderSample(supplier, { ...base, layout: l.key as typeof base.layout }) })) };
});
