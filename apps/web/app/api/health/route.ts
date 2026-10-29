import { timingSafeEqual } from 'node:crypto';
import { log } from '@kora/core';
import { mockFlagsInProduction, schemaStatus } from '@kora/db';
import { json, services } from '../../../lib/server';

export const dynamic = 'force-dynamic';

/**
 * For uptime checks. Up, or down with a short reason: 'database', 'schema' (the code is ahead of the database, so a migration
 * has not been applied) or 'config' (a mock switch is on in production). Which migration or which switch is logged, never sent.
 */
export async function GET(req: Request) {
  // The reason is for the operator (the uptime watcher sends the cron secret). Anyone else only learns that it is down.
  const secret = process.env.CRON_SECRET ?? '';
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const operator = secret.length >= 16 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  const down = (reason: string) => json(operator ? { status: 'down', reason } : { status: 'down' }, 503);
  try {
    const sql = services().sql;
    await sql`select 1`;
    const flags = mockFlagsInProduction();
    if (flags.length) { log('error', 'health.unsafe_config', { flags }); return down('config'); }
    const schema = await schemaStatus(sql);
    if (schema.status === 'behind') { log('error', 'health.schema_behind', { missing: schema.missing }); return down('schema'); }
    return json({ status: 'ok', schema: schema.status });
  } catch {
    return down('database');
  }
}
