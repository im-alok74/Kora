import { addClient, listClients, type NewClient } from '@kora/core';
import { firmRoute } from '../../../../lib/firmroute';
import { readJson } from '../../../../lib/server';

export const GET = firmRoute(async ({ s, req, sql }) => {
  const u = new URL(req.url);
  return listClients(sql, s, { limit: Number(u.searchParams.get('limit') ?? 100), offset: Number(u.searchParams.get('offset') ?? 0) });
});

export const POST = firmRoute(async ({ s, req, sql }) => {
  const b = await readJson<Partial<NewClient>>(req);
  const id = await addClient(sql, s, {
    legalName: String(b.legalName ?? ''), pan: b.pan ? String(b.pan) : undefined, sourceSoftware: String(b.sourceSoftware ?? ''),
    contactName: String(b.contactName ?? ''), contactEmail: String(b.contactEmail ?? ''), contactPhone: String(b.contactPhone ?? ''),
    registrations: Array.isArray(b.registrations) ? b.registrations.map((r) => ({ gstin: String(r?.gstin ?? ''), registrationType: r?.registrationType, filingFrequency: r?.filingFrequency })) : [],
  });
  return { id };
});
