import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from './index.js';

export type SchemaStatus = { status: 'current' | 'behind' | 'unknown'; missing: string[] };

/**
 * Where the migration files may be. Next bundles the server code, so the path next to this file may not exist at run time:
 * the web app's tracing config ships packages/db/migrations with the health route, and the working directory is tried too.
 */
export function migrationDirs(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [join(here, '..', 'migrations'), join(process.cwd(), '..', '..', 'packages', 'db', 'migrations'), join(process.cwd(), 'packages', 'db', 'migrations')];
}

/**
 * Compares the migrations that ship with this build with the ones the database has recorded, by name (so a migration added
 * out of order is still seen). 'behind' means the code is running ahead of the schema; 'unknown' means there were no files to
 * compare with, which is not treated as a failure. A database that is ahead of the build (a rollback) counts as current.
 */
export async function schemaStatus(sql: Sql, dirs: string[] = migrationDirs()): Promise<SchemaStatus> {
  const dir = dirs.find((d) => existsSync(d));
  const files = dir ? readdirSync(dir).filter((f) => f.endsWith('.sql')).sort() : [];
  if (files.length === 0) return { status: 'unknown', missing: [] };
  let done: Set<string>;
  try {
    done = new Set((await sql`select name from schema_migration`).map((r) => r.name as string));
  } catch {
    return { status: 'behind', missing: files };      // no schema_migration table: nothing has been applied
  }
  const missing = files.filter((f) => !done.has(f));
  return { status: missing.length ? 'behind' : 'current', missing };
}

/**
 * The switches that let anyone sign in, or send webhooks to private addresses, or use the fake gateway. They exist for a
 * staging demo and must never be on in production. A Vercel preview deployment counts as staging; anything else running with
 * NODE_ENV=production is treated as production.
 */
/**
 * True on the live Vercel production deployment. The demo one-time code, the fake payment page and web-hooks to private addresses are
 * switched OFF there whatever the environment variables say, so setting a staging switch by mistake cannot open an account takeover.
 * (The mock adapters can still be selected so the app starts; they are not an attack surface.)
 */
export const isLiveDeployment = (env: Record<string, string | undefined> = process.env): boolean => env.VERCEL_ENV === 'production';

export function mockFlagsInProduction(env: Record<string, string | undefined> = process.env): string[] {
  if (env.NODE_ENV !== 'production' || env.VERCEL_ENV === 'preview' || env.VERCEL_ENV === 'development') return [];
  const on: string[] = [];
  if (env.KORA_ALLOW_MOCKS === '1') on.push('KORA_ALLOW_MOCKS');
  if (env.DEMO_FIXED_OTP) on.push('DEMO_FIXED_OTP');
  if (env.KORA_WEBHOOK_ALLOW_PRIVATE === '1') on.push('KORA_WEBHOOK_ALLOW_PRIVATE');
  return on;
}
