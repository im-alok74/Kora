import { createMatter, listMatters, type MatterIn } from '@kora/core';
import { created, v1Route } from '../../../../lib/apiV1';

/** Query: status, kind ("matter" or "project"), q. */
export const GET = v1Route({}, async ({ t, sql, req }) => {
  const q = new URL(req.url).searchParams;
  return { data: await listMatters(sql, t, { status: q.get('status') ?? undefined, kind: q.get('kind') ?? undefined, q: q.get('q') ?? undefined }) };
});

/** Body: { partyId, title, kind?, ... } as in the app. Returns { id }. */
export const POST = v1Route({ write: true }, async ({ t, sql, req }) => created(await createMatter(sql, t, (await req.json()) as MatterIn)));
