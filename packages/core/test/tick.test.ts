import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { enqueue, runTick, PermanentJobError } from '../src/index.js';

let db: TestDb;
beforeAll(async () => { db = await makeTestDb(); }, 60_000);
afterAll(async () => { await db?.drop(); });

describe('runTick', () => {
  it('does nothing on an empty system', async () => {
    const r = await runTick(db.web, { 'test.tick': async () => {} });
    expect(r.jobs).toEqual({ claimed: 0, done: 0, retried: 0, failed: 0 });
    expect(r.reminders).toMatchObject({ queued: 0 });
    expect(r.recurring).toMatchObject({ created: 0 });
  });

  it('runs every ready job in one call, retries failures later, and stops failing ones for good', async () => {
    const seen: number[] = [];
    for (let i = 0; i < 25; i++) await enqueue(db.web, 'test.tick', { i });
    await enqueue(db.web, 'test.flaky', {});
    await enqueue(db.web, 'test.broken', {}, { maxAttempts: 3 });
    const r = await runTick(db.web, {
      'test.tick': async (job) => { seen.push((job.payload as { i: number }).i); },
      'test.flaky': async () => { throw new Error('provider is down'); },
      'test.broken': async () => { throw new PermanentJobError('bad address'); },
    });
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(r.jobs).toEqual({ claimed: 27, done: 25, retried: 1, failed: 1 });
    const [flaky] = await db.owner`select status, last_error from job where queue = 'test.flaky'`;
    expect(flaky).toMatchObject({ status: 'queued', last_error: 'provider is down' });
    // the retry is in the future, so an immediate second tick leaves it alone
    expect((await runTick(db.web, { 'test.flaky': async () => {} })).jobs.claimed).toBe(0);
  });

  it('respects the time budget', async () => {
    for (let i = 0; i < 30; i++) await enqueue(db.web, 'test.slow', { i });
    const r = await runTick(db.web, { 'test.slow': () => new Promise((res) => setTimeout(res, 50)) }, { budgetMs: 200 });
    expect(r.jobs.claimed).toBeGreaterThan(0);
    expect(r.jobs.claimed).toBeLessThan(30);
    expect(r.ms).toBeLessThan(2000);
  });
});
