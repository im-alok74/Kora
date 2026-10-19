import { createApiKey, listApiKeys, type ApiScope } from '@kora/core';
import { readJson, tenantRoute } from '../../../lib/server';

export const GET = tenantRoute(async ({ t, sql }) => ({ keys: await listApiKeys(sql, t) }));
/** Body: { name, scope: "read" | "write" }. The key is in the answer once and cannot be shown again. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson<{ name?: string; scope?: string }>(req);
  return createApiKey(sql, t, { name: String(b.name ?? ''), scope: b.scope as ApiScope });
});
