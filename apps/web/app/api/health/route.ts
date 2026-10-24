import { log } from '@kora/core';
import { mockFlagsInProduction, schemaStatus } from '@kora/db';
import { json, services } from '../../../lib/server';

export const dynamic = 'force-dynamic';

/**
 * For uptime checks. Up, or down with a short reason: 'database', 'schema' (the code is ahead of the database, so a migration
 * has not been applied) or 'config' (a mock switch is on in production). Which migration or which switch is logged, never sent.
 */
export async function GET() {
  try {
    const sql = services().sql;
    await sql`select 1`;
    const flags = mockFlagsInProduction();
    if (flags.length) { log('error', 'health.unsafe_config', { flags }); return json({ status: 'down', reason: 'config' }, 503); }
    const schema = await schemaStatus(sql);
    if (schema.status === 'behind') { log('error', 'health.schema_behind', { missing: schema.missing }); return json({ status: 'down', reason: 'schema' }, 503); }
    return json({ status: 'ok', schema: schema.status });
  } catch {
    return json({ status: 'down', reason: 'database' }, 503);
  }
}
