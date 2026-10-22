import { archiveCustomField, updateCustomField } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

export const PUT = tenantRoute(async ({ t, sql, req, params }) => {
  const b = await readJson(req);
  return updateCustomField(sql, t, params.id!, { label: String(b.label ?? ''), options: Array.isArray(b.options) ? b.options.map(String) : undefined, showOnPdf: b.showOnPdf !== false });
});
export const DELETE = tenantRoute(async ({ t, sql, params }) => { await archiveCustomField(sql, t, params.id!); });
