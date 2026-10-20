import { addComment, listComments } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, params }) => ({ comments: await listComments(sql, t, params.id!) }));
/** Body: { body }. A note for the team, up to 1000 characters. */
export const POST = tenantRoute(async ({ t, sql, req, params }) => {
  const b = await readJson<{ body?: string }>(req);
  return addComment(sql, t, params.id!, String(b.body ?? ''));
});
