import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mockFlagsInProduction, schemaStatus } from '../src/health.js';
import { makeTestDb, type TestDb } from '../src/testing.js';

describe('schemaStatus', () => {
  let db: TestDb;
  beforeAll(async () => { db = await makeTestDb(); }, 60_000);
  afterAll(async () => { await db?.drop(); });

  it('is current when every migration in the bundle has been applied', async () => {
    expect(await schemaStatus(db.web)).toMatchObject({ status: 'current', missing: [] });
  });

  it('is behind, and names what is missing, when the bundle has a newer migration than the database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    writeFileSync(join(dir, '0001_init.sql'), '-- applied');
    writeFileSync(join(dir, '9999_not_applied_yet.sql'), '-- not applied');
    const applied = (await db.owner`select name from schema_migration limit 1`)[0]!.name as string;
    writeFileSync(join(dir, applied), '-- applied');
    expect(await schemaStatus(db.web, [dir])).toMatchObject({ status: 'behind', missing: ['9999_not_applied_yet.sql'] });
  });

  it('is unknown, not a failure, when the bundle has no migration files to compare with', async () => {
    expect(await schemaStatus(db.web, [join(tmpdir(), 'does-not-exist-' + Date.now())])).toMatchObject({ status: 'unknown' });
  });

  it('does not mind a database that is ahead of the bundle (a rollback)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    writeFileSync(join(dir, '0001_init.sql'), '-- applied');
    expect((await schemaStatus(db.web, [dir])).status).toBe('current');
  });
});

describe('mockFlagsInProduction', () => {
  const prod = { NODE_ENV: 'production' };
  it('is empty when nothing is set', () => expect(mockFlagsInProduction(prod)).toEqual([]));
  it('names every mock switch that is on in production', () => {
    expect(mockFlagsInProduction({ ...prod, KORA_ALLOW_MOCKS: '1', DEMO_FIXED_OTP: '123456', KORA_WEBHOOK_ALLOW_PRIVATE: '1' }))
      .toEqual(['KORA_ALLOW_MOCKS', 'DEMO_FIXED_OTP', 'KORA_WEBHOOK_ALLOW_PRIVATE']);
  });
  it('ignores them outside production, and on a Vercel preview (the staging demo)', () => {
    expect(mockFlagsInProduction({ KORA_ALLOW_MOCKS: '1' })).toEqual([]);
    expect(mockFlagsInProduction({ ...prod, KORA_ALLOW_MOCKS: '1', VERCEL_ENV: 'preview' })).toEqual([]);
    expect(mockFlagsInProduction({ ...prod, KORA_ALLOW_MOCKS: '1', VERCEL_ENV: 'production' })).toEqual(['KORA_ALLOW_MOCKS']);
  });
  it('does not count a flag that is set to something other than on', () => {
    expect(mockFlagsInProduction({ ...prod, KORA_ALLOW_MOCKS: '0', DEMO_FIXED_OTP: '' })).toEqual([]);
  });
});
