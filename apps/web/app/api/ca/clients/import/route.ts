import { importClients, previewClientImport } from '@kora/core';
import { firmRoute } from '../../../../../lib/firmroute';
import { readJson } from '../../../../../lib/server';

/** { csv } previews; { csv, commit: true } adds. A file with any bad row adds nothing. */
export const POST = firmRoute(async ({ s, req, sql }) => {
  const b = await readJson<{ csv?: string; commit?: boolean }>(req);
  const csv = String(b.csv ?? '');
  return b.commit ? importClients(sql, s, csv) : previewClientImport(sql, s, csv);
});
