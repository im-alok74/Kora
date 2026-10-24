import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { ip: '203.0.113.7', limiter: { hitCount: vi.fn() } };
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': `${state.ip}, 10.0.0.1` }) }));
vi.mock('../lib/server', () => ({ services: () => ({ limiter: state.limiter }) }));
const reported: unknown[] = [];
vi.mock('@kora/core', () => ({ reportLimiterProblem: (...a: unknown[]) => { reported.push(a); } }));

const { publicLimit } = await import('../lib/publicLimit');

beforeEach(() => { state.limiter.hitCount.mockReset(); reported.length = 0; });

describe('publicLimit', () => {
  it('lets a request through under the limit, counting by bucket and the first forwarded address', async () => {
    state.limiter.hitCount.mockResolvedValue({ allowed: true, count: 1 });
    expect(await publicLimit('invoice-page', 120, 'text')).toBeNull();
    expect(state.limiter.hitCount).toHaveBeenCalledWith('pub:invoice-page:203.0.113.7', 120, 60);
  });

  it('answers 429 in plain text for pages and JSON for the API, with a retry hint', async () => {
    state.limiter.hitCount.mockResolvedValue({ allowed: false, count: 121 });
    const page = await publicLimit('invoice-page', 120, 'text');
    expect(page!.status).toBe(429);
    expect(page!.headers.get('retry-after')).toBe('60');
    expect(page!.headers.get('content-type')).toContain('text/plain');
    expect(await page!.text()).toContain('Too many requests');
    const api = await publicLimit('gstin', 120);
    expect(api!.status).toBe(429);
    expect(await api!.json()).toEqual({ error: expect.stringContaining('Too many requests') });
  });

  it('never blocks because the limiter failed, and reports the fault', async () => {
    state.limiter.hitCount.mockRejectedValue(new Error('database down'));
    expect(await publicLimit('portal', 240)).toBeNull();
    expect(reported).toHaveLength(1);
    expect(reported[0]).toEqual(['public:portal', expect.any(Error)]);
  });
});
