import { getBusiness, sanitiseTemplate } from '@kora/core';
import { renderSample } from '@kora/pdf';
import { tenantRoute } from '../../../../lib/server';

/** Renders a sample invoice with the template being edited, so changes show before saving. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const template = sanitiseTemplate(await req.json());
  return { html: renderSample(await getBusiness(sql, t), template) };
});
