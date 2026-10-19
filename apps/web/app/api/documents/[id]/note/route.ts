import { startNote, ValidationError } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  const kind = (await readJson(req)).kind;
  if (kind !== 'credit_note' && kind !== 'debit_note') throw new ValidationError('Choose a credit note or a debit note.');
  return startNote(sql, t, params.id!, kind);
});
