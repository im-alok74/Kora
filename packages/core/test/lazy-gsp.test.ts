import { describe, expect, it } from 'vitest';
import { GspError, createLazyGsp, type GspClient } from '@kora/adapters';
import { pruneOperationalData, shouldPrune } from '../src/tick.js';
import type { Sql } from '@kora/db';

describe('createLazyGsp', () => {
  it('builds nothing at start-up, so a missing GSP_URL cannot stop the app', () => {
    let built = 0;
    createLazyGsp({}, (() => { built++; return {} as GspClient; }) as never);
    expect(built).toBe(0);
  });

  it('says plainly that the partner is not connected when it is used without an address', async () => {
    const gsp = createLazyGsp({});
    const e = await gsp.generateIrn({}).then(() => null, (x: unknown) => x as GspError);
    expect(e).toBeInstanceOf(GspError);
    expect(e!.kind).toBe('auth');
    expect(e!.code).toBe('gsp_not_configured');
    expect(e!.message).toContain('GSP_URL');
    for (const call of [() => gsp.cancelIrn({ irn: 'x', reason: '1' as never, remark: 'r' }), () => gsp.generateEwayBill({}), () => gsp.cancelEwayBill({ ewbNo: '1', reason: '1' as never, remark: 'r' })]) {
      await expect(call()).rejects.toMatchObject({ code: 'gsp_not_configured' });
    }
  });

  it('builds one client from the environment on first use and reuses it', async () => {
    const seen: unknown[] = [];
    const fake: GspClient = { generateIrn: async () => ({ irn: 'IRN1', ackNo: '1', ackDate: 'd', signedInvoice: 's', signedQr: 'q' }) } as never;
    const gsp = createLazyGsp({ GSP_URL: ' https://partner.example.test ', GSP_TOKEN: 't', GSP_TIMEOUT_MS: '5000' }, ((cfg: unknown) => { seen.push(cfg); return fake; }) as never);
    await gsp.generateIrn({});
    await gsp.generateIrn({});
    expect(seen).toEqual([{ baseUrl: 'https://partner.example.test', token: 't', timeoutMs: 5000 }]);
  });
});

describe('nightly prune plumbing', () => {
  it('is due only in the 21:00 UTC hour', () => {
    expect(shouldPrune(new Date('2026-10-24T21:05:00Z'))).toBe(true);
    expect(shouldPrune(new Date('2026-10-24T04:30:00Z'))).toBe(false);
    expect(shouldPrune(new Date('2026-10-24T22:00:00Z'))).toBe(false);
  });

  it('does not throw before the migration is applied; it reports why it skipped', async () => {
    const sql = (async () => { throw new Error('function prune_operational_data() does not exist'); }) as unknown as Sql;
    expect(await pruneOperationalData(sql)).toEqual({ skipped: expect.stringContaining('does not exist') });
  });

  it('returns the counts the function reports', async () => {
    const sql = (async () => [{ r: { job_done: 3 } }]) as unknown as Sql;
    expect(await pruneOperationalData(sql)).toEqual({ job_done: 3 });
  });
});
