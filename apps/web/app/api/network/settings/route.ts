import { getNetworkSettings, saveNetworkSettings } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

export const GET = tenantRoute(async ({ t, sql }) => getNetworkSettings(sql, t));
/** Body: any of { receive, listed, about, categories: string[], city }. Owner only. */
export const PUT = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson(req);
  await saveNetworkSettings(sql, t, {
    receive: typeof b.receive === 'boolean' ? b.receive : undefined, listed: typeof b.listed === 'boolean' ? b.listed : undefined,
    about: 'about' in b ? (b.about == null ? null : String(b.about)) : undefined, city: 'city' in b ? (b.city == null ? null : String(b.city)) : undefined,
    categories: Array.isArray(b.categories) ? b.categories.map(String) : undefined,
  });
  return getNetworkSettings(sql, t);
});
