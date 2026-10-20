import { commitImport, importTextFrom, previewImport, ValidationError, type ImportKind } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

/**
 * Body: { kind: "customers" | "items", and one of csv (text), xlsx (base64) or tally (XML text, customers only), commit?: true }.
 * Without commit it only shows what would happen.
 */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson<{ kind?: string; csv?: unknown; xlsx?: unknown; tally?: unknown; commit?: boolean }>(req);
  const kind = b.kind as ImportKind;
  if (typeof b.tally === 'string' && kind !== 'customers') throw new ValidationError('A Tally ledger file holds customers. Choose Customers to import it.', 'kind');
  const text = typeof b.xlsx === 'string' ? importTextFrom({ xlsxBase64: b.xlsx }) : typeof b.tally === 'string' ? importTextFrom({ tallyXml: b.tally }) : typeof b.csv === 'string' ? b.csv : null;
  if (text === null) throw new ValidationError('Choose a CSV, Excel or Tally file.', 'file');
  return b.commit === true ? { result: await commitImport(sql, t, kind, text) } : { preview: await previewImport(sql, t, kind, text) };
});
