import { commitImport, previewImport, ValidationError, type ImportKind } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

/** Body: { kind: "customers" | "items", csv: "...", commit?: true }. Without commit it only shows what would happen. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson<{ kind?: string; csv?: unknown; commit?: boolean }>(req);
  if (typeof b.csv !== 'string') throw new ValidationError('Choose a CSV file.', 'csv');
  const kind = b.kind as ImportKind;
  return b.commit === true ? { result: await commitImport(sql, t, kind, b.csv) } : { preview: await previewImport(sql, t, kind, b.csv) };
});
