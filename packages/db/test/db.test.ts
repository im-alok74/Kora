import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTenant } from '../src/index.js';
import { makeTestDb, type TestDb } from '../src/testing.js';

let db: TestDb;
const U1 = '00000000-0000-0000-0000-0000000000a1';
const U2 = '00000000-0000-0000-0000-0000000000a2';
let B1: string, B2: string;

beforeAll(async () => {
  db = await makeTestDb();
  await db.owner`insert into app_user (id, email) values (${U1}, 'a@example.test'), (${U2}, 'b@example.test')`;
  [{ id: B1 }] = (await db.web`select create_business(${U1}, 'Acme Traders', '27AAPFU0939F1ZV', '27', 'regular') as id`) as any;
  [{ id: B2 }] = (await db.web`select create_business(${U2}, 'Other Co', '29BBBCC1234D1Z4', '29', 'regular') as id`) as any;
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('migrations', () => {
  it('0001 is byte-identical to replica/schema.sql, so the record cannot drift', () => {
    const here = fileURLToPath(new URL('.', import.meta.url));
    const a = readFileSync(join(here, '../migrations/0001_init.sql'), 'utf8');
    const b = readFileSync(join(here, '../../../replica/schema.sql'), 'utf8');
    expect(a).toBe(b);
  });
  it('is idempotent', async () => {
    const { runMigrations } = await import('../src/index.js');
    expect(await runMigrations(db.owner)).toEqual([]);
  });
  it('the web role is not a superuser and does not bypass row-level security', async () => {
    const [r] = await db.web`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
    expect(r).toMatchObject({ rolsuper: false, rolbypassrls: false });
  });
});

describe('tenant isolation fails closed', () => {
  it('with no tenant set, tenant tables return nothing and accept nothing', async () => {
    expect(await db.web`select 1 from party`).toHaveLength(0);
    expect(await db.web`select 1 from number_series`).toHaveLength(0);
    await expect(db.web`insert into party (business_id, kind, name, state_code) values (${B1}, 'customer', 'x', '27')`).rejects.toThrow();
  });
  it('a tenant sees only its own rows', async () => {
    await withTenant(db.web, { businessId: B1, userId: U1 }, (tx) =>
      tx`insert into party (business_id, kind, name, state_code) values (${B1}, 'customer', 'Buyer One', '27')`);
    const own = await withTenant(db.web, { businessId: B1, userId: U1 }, (tx) => tx`select name from party`);
    const other = await withTenant(db.web, { businessId: B2, userId: U2 }, (tx) => tx`select name from party`);
    expect(own).toHaveLength(1);
    expect(other).toHaveLength(0);
  });
  it('a tenant cannot write another tenant\'s rows', async () => {
    await expect(withTenant(db.web, { businessId: B2, userId: U2 }, (tx) =>
      tx`insert into party (business_id, kind, name, state_code) values (${B1}, 'customer', 'Sneaky', '27')`)).rejects.toThrow();
  });
  it('the tenant setting does not leak between transactions on a pooled connection', async () => {
    await withTenant(db.web, { businessId: B1, userId: U1 }, (tx) => tx`select 1`);
    expect(await db.web`select current_setting('app.business_id', true) as v`).toEqual([{ v: '' }]);
  });
  it('rejects non-UUID ids before touching the database', async () => {
    await expect(withTenant(db.web, { businessId: "x'; drop table party;--", userId: U1 }, async () => 1)).rejects.toThrow(/UUID/);
  });
});

describe('audit and owner rules', () => {
  it('writes to tenant tables are audited with the actor', async () => {
    const rows = await db.owner`select actor_id, table_name from audit_log where business_id = ${B1} and table_name = 'party'`;
    expect(rows[0]).toMatchObject({ actor_id: U1, table_name: 'party' });
  });
  it('the app role cannot rewrite the audit log', async () => {
    await expect(withTenant(db.web, { businessId: B1, userId: U1 }, (tx) => tx`delete from audit_log`)).rejects.toThrow();
    await expect(withTenant(db.web, { businessId: B1, userId: U1 }, (tx) => tx`update audit_log set action = 'INSERT'`)).rejects.toThrow();
  });
  it('the last owner cannot be removed', async () => {
    await expect(db.web`select remove_member(${U1}, ${B1}, ${U1})`).rejects.toThrow(/at least one owner/);
  });
  it('only an owner can add members', async () => {
    await expect(db.web`select add_member(${U2}, ${B1}, ${U2}, 'staff')`).rejects.toThrow(/only an owner/);
    await db.web`select add_member(${U1}, ${B1}, ${U2}, 'accountant')`;
    expect(await db.web`select member_role(${U2}, ${B1}) as r`).toEqual([{ r: 'accountant' }]);
  });
});
