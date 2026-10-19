import { getLateFeeConfig, saveLateFeeConfig } from '@kora/core';
import { tenantRoute } from '../../../lib/server';

export const GET = tenantRoute(async ({ t, sql }) => ({ config: await getLateFeeConfig(sql, t) }));
export const PUT = tenantRoute(async ({ t, sql, req }) => ({ config: await saveLateFeeConfig(sql, t, await req.json()) }));
