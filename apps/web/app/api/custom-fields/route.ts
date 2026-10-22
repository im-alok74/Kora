import { createCustomField, listCustomFields, type CustomEntity, type CustomFieldIn } from '@kora/core';
import { readJson, tenantRoute } from '../../../lib/server';

export const GET = tenantRoute(async ({ t, sql, req }) => {
  const e = new URL(req.url).searchParams.get('entity');
  return { fields: await listCustomFields(sql, t, e === 'document' || e === 'customer' ? (e as CustomEntity) : undefined) };
});
export const POST = tenantRoute(async ({ t, sql, req }) => createCustomField(sql, t, (await readJson(req)) as unknown as CustomFieldIn));
