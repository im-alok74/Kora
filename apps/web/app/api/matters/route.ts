import { createMatter, listMatters } from '@kora/core';
import { readJson, tenantRoute } from '../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, req }) => {
  const u = new URL(req.url).searchParams;
  return { matters: await listMatters(sql, t, { status: u.get('status') ?? undefined, q: u.get('q') ?? undefined, kind: u.get('kind') ?? undefined }) };
});
/** Body: { partyId, title, reference?, rate?, sac?, reverseCharge?, tdsBp?, notes? } */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson(req);
  return createMatter(sql, t, {
    kind: b.kind === 'project' ? 'project' : 'matter', partyId: String(b.partyId ?? ''), title: String(b.title ?? ''), reference: b.reference == null ? null : String(b.reference),
    rate: b.rate == null ? null : String(b.rate), sac: b.sac == null ? null : String(b.sac), reverseCharge: b.reverseCharge === true,
    tdsBp: b.tdsBp == null ? 0 : Number(b.tdsBp), notes: b.notes == null ? null : String(b.notes),
  });
});
