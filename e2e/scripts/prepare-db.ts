import { createSql, runMigrations } from '@kora/db';

/** Creates a fresh, migrated database for the e2e run. Needs `pnpm db:up`. */
const ADMIN = process.env.TEST_ADMIN_URL ?? 'postgres://postgres:kora_admin_dev@localhost:54329/postgres';
const admin = createSql(ADMIN, { max: 1 });
await admin.unsafe('drop database if exists kora_e2e with (force)');
await admin.unsafe('create database kora_e2e owner kora_owner');
await admin.end();
const owner = createSql('postgres://kora_owner:kora_owner_dev@localhost:54329/kora_e2e', { max: 1 });
await runMigrations(owner);
await owner.end();
console.log('kora_e2e ready');
