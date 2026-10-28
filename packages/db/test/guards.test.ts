import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSql, MIGRATIONS_DIR, runMigrations } from '../src/index.js';
import { makeTestDb, type TestDb } from '../src/testing.js';

const files = () => readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const number = (f: string) => f.slice(0, 4);

describe('migration files', () => {
  it('are named NNNN_words.sql', () => {
    expect(files().filter((f) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(f))).toEqual([]);
  });

  it('never share a number (two branches that both took the next one would otherwise apply in an order nobody chose)', () => {
    const seen = new Map<string, string>();
    const clashes = files().filter((f) => (seen.has(number(f)) ? true : (seen.set(number(f), f), false)));
    expect(clashes.map((f) => `${f} and ${seen.get(number(f))}`)).toEqual([]);
  });

  // In a pull request CI sets MIGRATION_BASE=origin/main. A new migration may not reuse a number that is already on main, even
  // under a different name, and may not rewrite or delete a file that is already there: the owner applies them by hand, in order.
  const base = process.env.MIGRATION_BASE;
  it.skipIf(!base)('add to main, and never reuse a number or change a file that is already on it', () => {
    const git = (...a: string[]) => execFileSync('git', a, { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' });
    const onMain = git('ls-tree', '--name-only', base!, 'migrations/').split('\n').filter(Boolean).map((p) => p.replace('migrations/', ''));
    const mine = files();
    const reused = mine.filter((f) => !onMain.includes(f) && onMain.some((m) => number(m) === number(f)));
    const changed = mine.filter((f) => onMain.includes(f) && git('diff', '--name-only', base!, '--', `migrations/${f}`).trim() !== '');
    const removed = onMain.filter((f) => !mine.includes(f));
    expect({ reused, changed, removed }).toEqual({ reused: [], changed: [], removed: [] });
  });
});

/** A database with nothing applied, for tests that drive the runner themselves. */
async function makeScratch() {
  const admin = process.env.TEST_ADMIN_URL ?? 'postgres://postgres:kora_admin_dev@localhost:54329/postgres';
  const name = 'kora_g_' + Math.random().toString(16).slice(2, 10);
  const a = createSql(admin, { max: 1 });
  await a.unsafe(`create database ${name} owner kora_owner`);
  await a.end();
  const owner = createSql(`postgres://kora_owner:kora_owner_dev@${new URL(admin).host}/${name}`, { max: 2 });
  return {
    owner,
    async drop() {
      await owner.end();
      const b = createSql(admin, { max: 1 });
      await b.unsafe(`drop database if exists ${name} with (force)`);
      await b.end();
    },
  };
}

describe('the migration runner', () => {
  // The hosted database really was missing 0109 while 0125 was applied. The runner must apply it whenever it turns up.
  it('picks a file up by name: one with a lower number than something already applied still runs', async () => {
    const all = files();
    const late = '0109_pgcrypto_on_hosted.sql';
    expect(all).toContain(late);
    const dir = mkdtempSync(join(tmpdir(), 'mig-order-'));
    for (const f of all) if (f !== late) cpSync(join(MIGRATIONS_DIR, f), join(dir, f));
    const scratch = await makeScratch();
    try {
      expect(await runMigrations(scratch.owner, dir)).toEqual(all.filter((f) => f !== late));
      cpSync(join(MIGRATIONS_DIR, late), join(dir, late));
      expect(await runMigrations(scratch.owner, dir)).toEqual([late]);
      expect(await runMigrations(scratch.owner, dir)).toEqual([]);
    } finally { await scratch.drop(); }
  }, 180_000);

  it('rolls the whole batch back when one file fails, and records nothing from it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-fail-'));
    writeFileSync(join(dir, '0001_ok.sql'), 'create table guard_ok (id int);');
    writeFileSync(join(dir, '0002_bad.sql'), 'select * from table_that_does_not_exist;');
    const scratch = await makeScratch();
    try {
      await expect(runMigrations(scratch.owner, dir)).rejects.toThrow();
      expect(await scratch.owner`select to_regclass('guard_ok')::text as t`).toEqual([{ t: null }]);
      expect(await scratch.owner`select to_regclass('schema_migration')::text as t`).toEqual([{ t: null }]);
    } finally { await scratch.drop(); }
  }, 60_000);
});

// Row level security. A table with a business_id column holds one business's data, so it must have forced row level security.
// The tables below have none on purpose: they are read before a business is known (sign in), or are shared reference data or
// system queues. kora_web can read and write most of them, which is audit finding A-05. This test makes every NEW table a
// decision: add it to the list with a reason, or give it row level security.
const NO_RLS: Record<string, string> = {
  app_user: 'sign in: looked up before a business is known',
  app_session: 'sign in: looked up by token hash',
  otp_challenge: 'sign in: one time codes',
  mfa_challenge: 'sign in: second step',
  user_totp: 'sign in: authenticator secrets (encrypted)',
  user_recovery_code: 'sign in: recovery codes (hashed)',
  security_event: 'account security log, per user',
  rate_event: 'rate limiter counters, per address',
  webhook_event: 'inbound payment events, matched to a business after verification',
  schema_migration: 'migration bookkeeping',
  state_code: 'reference data',
  tax_rate: 'reference data',
  billing_event: 'webhook replay guard: no grant for the application role, written only by billing_apply_event()',
  data_breach: 'platform register of breaches: no grant for the application role, reached only through the admin functions',
};

// The one exception that DOES hold per business data: the job queue. The worker claims jobs across all businesses, so the
// web role cannot be limited by business here. Anything reading `job` as kora_web sees every business's queued work.
const TENANT_WITHOUT_RLS: Record<string, string> = {
  job: 'system queue: claimed by the worker across businesses (payloads name the business and the customer message)',
};

describe('row level security coverage', () => {
  let db: TestDb;
  beforeAll(async () => { db = await makeTestDb(); }, 60_000);
  afterAll(async () => { await db?.drop(); });

  const tables = () => db.owner`
    select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
           exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'business_id' and not a.attisdropped) as tenant
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' order by c.relname`;

  it('every table with a business_id has forced row level security', async () => {
    const bad = (await tables()).filter((t) => t.tenant && !(t.rls && t.forced) && !(t.name in TENANT_WITHOUT_RLS)).map((t) => t.name);
    expect(bad).toEqual([]);
  });

  it('every other table without it is on the written list, with a reason', async () => {
    const unlisted = (await tables()).filter((t) => !t.rls && !(t.name in NO_RLS) && !(t.name in TENANT_WITHOUT_RLS)).map((t) => t.name);
    expect(unlisted).toEqual([]);
  });

  it('the lists are exact: nothing listed has gained row level security or changed shape (remove it from the list then)', async () => {
    const byName = new Map((await tables()).map((r) => [r.name as string, r]));
    const stale = [
      ...Object.keys(NO_RLS).filter((n) => !byName.has(n) || byName.get(n)!.rls || byName.get(n)!.tenant),
      ...Object.keys(TENANT_WITHOUT_RLS).filter((n) => !byName.has(n) || byName.get(n)!.rls || !byName.get(n)!.tenant),
    ];
    expect(stale).toEqual([]);
  });
});
