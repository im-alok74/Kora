import { cpSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSql, MIGRATIONS_DIR, runMigrations, type Sql } from '../src/index.js';
import { makeTestDb, type TestDb } from '../src/testing.js';

const ADMIN = process.env.TEST_ADMIN_URL ?? 'postgres://postgres:kora_admin_dev@localhost:54329/postgres';

describe('who can call the security definer functions', () => {
  let db: TestDb;
  beforeAll(async () => { db = await makeTestDb(); }, 60_000);
  afterAll(async () => { await db?.drop(); });

  it('not PUBLIC: every one of them needs a grant (audit A-06)', async () => {
    const open = await db.owner`
      select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef and has_function_privilege('public', p.oid, 'execute')`;
    expect(open.map((r) => r.fn)).toEqual([]);
  });

  it('the application role can still call the two it needs, and the share link lookups', async () => {
    const [r] = await db.owner`
      select has_function_privilege('kora_web', 'create_business(uuid, text, text, char, text)', 'execute') as create_business,
             has_function_privilege('kora_web', 'public_document(text)', 'execute') as public_document,
             has_function_privilege('kora_web', 'share_resolve(text)', 'execute') as share_resolve`;
    expect(r).toEqual({ create_business: true, public_document: true, share_resolve: true });
  });
});

describe('the roles a hosted Postgres adds for its REST layer (anon, authenticated)', () => {
  /** A database in which those roles would receive everything new, as on Supabase, then migrated with `dir`. */
  async function scratchAs(dir: string) {
    const admin = createSql(ADMIN, { max: 1 });
    for (const role of ['anon', 'authenticated']) {
      const [has] = await admin`select 1 from pg_roles where rolname = ${role}`;
      if (!has) await admin.unsafe(`create role ${role} nologin`);
    }
    const name = 'kora_p_' + Math.random().toString(16).slice(2, 10);
    await admin.unsafe(`create database ${name} owner kora_owner`);
    await admin.end();
    const url = `postgres://kora_owner:kora_owner_dev@${new URL(ADMIN).host}/${name}`;
    const owner: Sql = createSql(url, { max: 2 });
    await owner.unsafe(`alter default privileges in schema public grant all on tables to anon, authenticated`);
    await owner.unsafe(`alter default privileges in schema public grant all on sequences to anon, authenticated`);
    await owner.unsafe(`alter default privileges in schema public grant all on functions to anon, authenticated`);
    await runMigrations(owner, dir);
    return {
      owner,
      async drop() {
        await owner.end();
        const a = createSql(ADMIN, { max: 1 });
        await a.unsafe(`drop database if exists ${name} with (force)`);
        await a.end();
      },
    };
  }

  const grants = (owner: Sql) => owner`
    select count(*)::int as n from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')`;

  it('without the migration they would hold privileges on every table (so the check below means something)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-noapi-'));
    for (const f of readdirSync(MIGRATIONS_DIR)) if (!f.startsWith('0162_')) cpSync(join(MIGRATIONS_DIR, f), join(dir, f));
    const s = await scratchAs(dir);
    try { expect((await grants(s.owner))[0]!.n).toBeGreaterThan(100); } finally { await s.drop(); }
  }, 180_000);

  it('with it they hold nothing in the public schema, on tables or on the definer functions', async () => {
    const s = await scratchAs(MIGRATIONS_DIR);
    try {
      expect((await grants(s.owner))[0]!.n).toBe(0);
      const fns = await s.owner`
        select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef
           and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`;
      expect(fns.map((r) => r.fn)).toEqual([]);
      // and a table made after the migration does not hand them anything either
      await s.owner`create table after_the_fact (id int)`;
      expect((await grants(s.owner))[0]!.n).toBe(0);
    } finally { await s.drop(); }
  }, 180_000);

  it('is safe to run twice', async () => {
    const db = await makeTestDb();
    try {
      expect(await runMigrations(db.owner)).toEqual([]);
      const sql = (await import('node:fs')).readFileSync(join(MIGRATIONS_DIR, '0162_data_api_roles_no_access.sql'), 'utf8');
      await db.owner.unsafe(sql);
      await db.owner.unsafe(sql);
    } finally { await db.drop(); }
  }, 120_000);
});
