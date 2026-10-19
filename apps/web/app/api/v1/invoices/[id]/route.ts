import { getDocument, listPayments, ValidationError } from '@kora/core';
import { v1Route } from '../../../../../lib/apiV1';

/** One document with its lines and payments. */
export const GET = v1Route({}, async ({ t, sql, params }) => {
  const d = await getDocument(sql, t, params.id!);
  if (!d) throw new ValidationError('Document not found.');
  const { created_by: _a, pdf_object_key: _b, ...document } = d.document as Record<string, unknown>;
  void _a; void _b;
  const lines = d.lines.map(({ business_id: _c, ...l }) => (void _c, l));
  return { data: { document, lines, estimate: d.estimate, payments: await listPayments(sql, t, params.id!) } };
});
