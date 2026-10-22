import { getPartyCustom, setPartyCustom } from '@kora/core';
import { readJson, tenantRoute } from '../../../../../lib/server';

/** The custom answers kept on a customer. PUT body: { values: { [fieldId]: answer } }. */
export const GET = tenantRoute(async ({ t, sql, params }) => ({ values: await getPartyCustom(sql, t, params.id!) }));
export const PUT = tenantRoute(async ({ t, sql, req, params }) => setPartyCustom(sql, t, params.id!, ((await readJson(req)).values ?? {}) as Record<string, unknown>));
