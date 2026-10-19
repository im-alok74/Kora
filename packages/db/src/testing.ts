import { randomBytes } from 'node:crypto';
import { createSql, runMigrations, type Sql } from './index.js';

export interface TestDb {
  /** Runs as the application role (kora_web): row-level security applies. */
  web: Sql;
  /** Runs as kora_owner (BYPASSRLS): for setup and for asserting what the database really holds. */
  owner: Sql;
  name: string;
  drop(): Promise<void>;
}

const ADMIN = process.env.TEST_ADMIN_URL ?? 'postgres://postgres:kora_admin_dev@localhost:54329/postgres';

/** A throwaway, fully migrated database. Needs `pnpm db:up` first; fails loudly if Postgres is unreachable. */
export async function makeTestDb(): Promise<TestDb> {
  const name = 'kora_t_' + randomBytes(5).toString('hex');
  const admin = createSql(ADMIN, { max: 1 });
  try {
    await admin.unsafe(`create database ${name} owner kora_owner`);
  } catch (e) {
    await admin.end();
    throw new Error(`Cannot reach test Postgres at ${ADMIN}. Run "pnpm db:up". (${(e as Error).message})`);
  }
  await admin.end();
  const base = new URL(ADMIN);
  const url = (u: string, p: string) => `postgres://${u}:${p}@${base.host}/${name}`;
  const owner = createSql(url('kora_owner', 'kora_owner_dev'), { max: 4 });
  await runMigrations(owner);
  const web = createSql(url('kora_web', 'kora_web_dev'), { max: 10 });
  return {
    web, owner, name,
    async drop() {
      await web.end(); await owner.end();
      const a = createSql(ADMIN, { max: 1 });
      await a.unsafe(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}
