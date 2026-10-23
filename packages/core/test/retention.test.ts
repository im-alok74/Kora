import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { MIGRATIONS_DIR } from '@kora/db';

let db: TestDb;
beforeAll(async () => { db = await makeTestDb(); }, 60_000);
afterAll(async () => { await db?.drop(); });

const count = async (sql: string) => Number(((await db.owner.unsafe(sql))[0] as unknown as { n: string }).n);
const ago = (days: number) => `now() - interval '${days} days'`;

describe('prune_operational_data', () => {
  it('removes old finished work and keeps everything that still matters', async () => {
    const o = db.owner;
    await o.unsafe(`
      insert into job (queue, payload, status, finished_at, updated_at) values
        ('delivery.send', '{}', 'done',   ${ago(40)}, ${ago(40)}),   -- old, goes
        ('delivery.send', '{}', 'done',   ${ago(2)},  ${ago(2)}),    -- recent, stays
        ('einvoice.register', '{}', 'failed', null,   ${ago(100)}),  -- failed long ago, goes
        ('einvoice.register', '{}', 'failed', null,   ${ago(10)}),   -- failed recently, stays so someone can read it
        ('webhook.deliver', '{}', 'queued', null,     ${ago(200)});  -- waiting work is never removed
      insert into webhook_event (gateway, event_id, payload, processed_at) values
        ('razorpay', 'old-done', '{}', ${ago(200)}),                 -- goes
        ('razorpay', 'recent-done', '{}', ${ago(5)}),                -- stays
        ('razorpay', 'old-unprocessed', '{}', null);                 -- a payment that was not applied: stays
      insert into otp_challenge (identifier, channel, code_hash, expires_at) values
        ('9000000001', 'sms', '\\x00', ${ago(3)}),                   -- expired days ago, goes
        ('9000000002', 'sms', '\\x00', now() + interval '5 minutes'); -- live, stays
    `);
    const [u] = await o`insert into app_user (email) values ('prune@example.test') returning id`;
    await o.unsafe(`
      insert into app_session (user_id, token_hash, expires_at, revoked_at) values
        ('${u!.id}', '\\x01', ${ago(60)}, null),                     -- long expired, goes
        ('${u!.id}', '\\x02', now() + interval '10 days', null),     -- live, stays
        ('${u!.id}', '\\x03', now() + interval '10 days', ${ago(45)}); -- signed out long ago, goes
    `);
    await o.unsafe(`update webhook_event set received_at = ${ago(300)} where event_id like 'old-%'`);

    const [r] = await db.web`select prune_operational_data() as r`;
    expect(r!.r).toMatchObject({ job_done: 1, job_failed: 1, webhook_event: 1, otp_challenge: 1, app_session: 2 });

    expect(await count(`select count(*) n from job where status = 'done'`)).toBe(1);
    expect(await count(`select count(*) n from job where status = 'failed'`)).toBe(1);
    expect(await count(`select count(*) n from job where status = 'queued'`)).toBe(1);
    expect(await count(`select count(*) n from webhook_event where event_id = 'old-unprocessed'`)).toBe(1);
    expect(await count(`select count(*) n from webhook_event where event_id = 'recent-done'`)).toBe(1);
    expect(await count(`select count(*) n from otp_challenge`)).toBe(1);
    expect(await count(`select count(*) n from app_session`)).toBe(1);
  });

  it('can be run again and finds nothing more to do', async () => {
    const [r] = await db.web`select prune_operational_data() as r`;
    expect(Object.values(r!.r as Record<string, number>).every((n) => n === 0)).toBe(true);
  });

  it('cannot be steered by the caller, and the app role cannot delete the tables itself', async () => {
    await expect(db.web`delete from job`).rejects.toThrow();
    await expect(db.web`select prune_operational_data(now() + interval '10 years')`).rejects.toThrow();
  });

  it('the migration can be applied twice without error', async () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '0170_retention_prune.sql'), 'utf8');
    await db.owner.unsafe(sql);
    await db.owner.unsafe(sql);
  });
});
