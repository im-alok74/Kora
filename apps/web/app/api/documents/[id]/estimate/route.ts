import { convertDocument, decideEstimate, reviseEstimate, ValidationError } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

/**
 * Body: { action: 'accept' | 'decline' | 'convert' | 'revise', comment?, name?, target? }.
 * Convert makes a draft invoice and returns its id; with a target ('sales_order', 'proforma', 'delivery_challan', 'invoice') it makes that instead.
 * Revise starts a new version of an open quote.
 */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  const b = await readJson(req);
  const action = String(b.action ?? '');
  const answer = { comment: b.comment == null ? null : String(b.comment), name: b.name == null ? null : String(b.name) };
  if (action === 'accept') return decideEstimate(sql, t, params.id!, 'accepted', 'staff', answer);
  if (action === 'decline') return decideEstimate(sql, t, params.id!, 'declined', 'staff', answer);
  if (action === 'convert') return convertDocument(sql, t, params.id!, String(b.target ?? 'invoice'));
  if (action === 'revise') return reviseEstimate(sql, t, params.id!);
  throw new ValidationError('Choose accept, decline, convert or revise.', 'action');
});
