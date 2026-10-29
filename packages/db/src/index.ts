import postgres from 'postgres';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Sql = postgres.Sql;
export { schemaStatus, mockFlagsInProduction, isLiveDeployment, migrationDirs, type SchemaStatus } from './health.js';
export type Tx = postgres.TransactionSql;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dates (the `date` type) stay as 'YYYY-MM-DD' strings. The default would build a JS Date at local midnight,
 * which shifts the day when serialised to JSON in another time zone.
 */
const dateAsString = { date: { to: 1082, from: [1082], serialize: (x: unknown) => String(x), parse: (x: string) => x } };

export function createSql(url: string, opts: postgres.Options<{}> = {}): Sql {
  // A transaction-mode pooler (port 6543, as on Supabase) does not support prepared statements.
  const pooled = /:6543\//.test(url);
  return postgres(url, { onnotice: () => {}, types: dateAsString, ...(pooled ? { prepare: false } : {}), ...opts }) as Sql;
}

export interface TenantContext {
  businessId: string;
  userId: string;
}

/** Actor recorded in the audit log for work done by the system (webhooks, the worker), not a person. */
export const SYSTEM_USER = '00000000-0000-0000-0000-000000000001';

/** Sets the tenant inside a transaction the caller already opened (for work that starts before the tenant is known). */
export async function setTenant(tx: Tx, ctx: TenantContext): Promise<void> {
  if (!UUID.test(ctx.businessId) || !UUID.test(ctx.userId)) throw new Error('setTenant: ids must be UUIDs');
  await tx`select set_config('app.business_id', ${ctx.businessId}, true), set_config('app.user_id', ${ctx.userId}, true)`;
}

/**
 * The only way application code reaches tenant tables. Opens a transaction and sets the two
 * variables the row-level security policies read. Without it every tenant query returns no rows.
 * The caller must already have checked that userId is a member of businessId (see core/tenancy).
 */
export async function withTenant<T>(sql: Sql, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(ctx.businessId) || !UUID.test(ctx.userId)) throw new Error('withTenant: ids must be UUIDs');
  return sql.begin(async (tx) => {
    await tx`select set_config('app.business_id', ${ctx.businessId}, true),
                    set_config('app.user_id', ${ctx.userId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/**
 * A firm reading a linked client's business. READ ONLY at the database level, and is_authorized() lets it through only while an active
 * client_business_link joins this firm to this business and the person is an active firm member.
 */
export async function withLinkedTenant<T>(sql: Sql, ctx: { businessId: string; userId: string; firmId: string }, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(ctx.businessId) || !UUID.test(ctx.userId) || !UUID.test(ctx.firmId)) throw new Error('withLinkedTenant: ids must be UUIDs');
  return sql.begin('read only', async (tx) => {
    await tx`select set_config('app.business_id', ${ctx.businessId}, true), set_config('app.user_id', ${ctx.userId}, true),
                    set_config('app.firm_id', ${ctx.firmId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** A firm session: sets app.firm_id and app.user_id. Firm tables are isolated on app.firm_id; this grants no access to any client's business. */
export async function withFirm<T>(sql: Sql, ctx: { firmId: string; userId: string }, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(ctx.firmId) || !UUID.test(ctx.userId)) throw new Error('withFirm: ids must be UUIDs');
  return sql.begin(async (tx) => {
    await tx`select set_config('app.firm_id', ${ctx.firmId}, true),
                    set_config('app.user_id', ${ctx.userId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** For tables that belong to one person, not one business (consent, privacy requests): sets only app.user_id. */
export async function withUser<T>(sql: Sql, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(userId)) throw new Error('withUser: id must be a UUID');
  return sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * Applies pending SQL files in name order, under an advisory lock, all in ONE transaction: a failing file rolls back the
 * whole batch, and the schema_migration rows are written in the same transaction. A file added out of order (a lower number
 * than one already applied) is still applied, because the check is by name. Statements that cannot run in a transaction,
 * such as create index concurrently, do not belong in a migration.
 */
export async function runMigrations(sql: Sql, dir = MIGRATIONS_DIR): Promise<string[]> {
  const applied: string[] = [];
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(727274)`;
    await tx`create table if not exists schema_migration (name text primary key, applied_at timestamptz not null default now())`;
    const done = new Set((await tx`select name from schema_migration`).map((r) => r.name as string));
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      await tx.unsafe(readFileSync(join(dir, f), 'utf8'));
      await tx`insert into schema_migration (name) values (${f})`;
      applied.push(f);
    }
  });
  return applied;
}
