import { convertEstimate, decideEstimate, ValidationError } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

/** Body: { action: 'accept' | 'decline' | 'convert' }. Convert makes a draft invoice and returns its id. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  const action = String((await readJson(req)).action ?? '');
  if (action === 'accept') return decideEstimate(sql, t, params.id!, 'accepted');
  if (action === 'decline') return decideEstimate(sql, t, params.id!, 'declined');
  if (action === 'convert') return convertEstimate(sql, t, params.id!);
  throw new ValidationError('Choose accept, decline or convert.', 'action');
});
