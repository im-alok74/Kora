import { startNote, ValidationError } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

/** Body: { kind, reason?, detail?, lines?: [{ position, quantity?, rate? }] }. With no lines, every line of the invoice is copied. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  const b = await readJson(req);
  const kind = b.kind;
  if (kind !== 'credit_note' && kind !== 'debit_note') throw new ValidationError('Choose a credit note or a debit note.');
  const lines = Array.isArray(b.lines) ? b.lines.map((l: Record<string, unknown>) => ({
    position: Number(l.position), quantity: l.quantity == null ? undefined : String(l.quantity), rate: l.rate == null ? undefined : String(l.rate),
  })) : undefined;
  return startNote(sql, t, params.id!, kind, { reason: b.reason == null ? null : String(b.reason), detail: b.detail == null ? null : String(b.detail), lines });
});
