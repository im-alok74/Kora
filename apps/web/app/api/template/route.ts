import { getTemplate, saveTemplate, LOCKED_FIELDS } from '@kora/core';
import { tenantRoute } from '../../../lib/server';

export const GET = tenantRoute(async ({ t, sql }) => ({ template: await getTemplate(sql, t), locked: LOCKED_FIELDS }));
export const PUT = tenantRoute(async ({ t, sql, req }) => ({ template: await saveTemplate(sql, t, await req.json()) }));
