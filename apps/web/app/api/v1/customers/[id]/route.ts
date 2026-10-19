import { getParty, ValidationError } from '@kora/core';
import { v1Route } from '../../../../../lib/apiV1';

export const GET = v1Route({}, async ({ t, sql, params }) => {
  const p = await getParty(sql, t, params.id!);
  if (!p) throw new ValidationError('Customer not found.');
  return { data: p };
});
