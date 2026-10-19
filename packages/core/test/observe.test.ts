import { describe, expect, it, vi } from 'vitest';
import { log, parseSentryDsn, reportError, sentryEnvelope } from '../src/index.js';

describe('Sentry reporting', () => {
  it('turns a DSN into the envelope address and auth header', () => {
    expect(parseSentryDsn('https://abc123@o99.ingest.sentry.io/4507')).toEqual({
      endpoint: 'https://o99.ingest.sentry.io/api/4507/envelope/',
      authHeader: 'Sentry sentry_version=7, sentry_client=kora/1.0, sentry_key=abc123',
    });
    expect(parseSentryDsn('not a url')).toBeNull();
    expect(parseSentryDsn('https://o99.ingest.sentry.io/4507')).toBeNull();
  });
  it('builds an envelope with the error, and removes anything that looks like a secret', () => {
    const lines = sentryEnvelope(new TypeError('boom'), { path: '/api/x', password: 'hunter2', nested: { apiKey: 'k', ok: 1 }, otpCode: '123456' }, 'https://k@o1.ingest.sentry.io/1', new Date('2026-10-20T00:00:00Z'), 'ev1').split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]!)).toMatchObject({ event_id: 'ev1', dsn: 'https://k@o1.ingest.sentry.io/1' });
    expect(JSON.parse(lines[1]!)).toEqual({ type: 'event' });
    const ev = JSON.parse(lines[2]!);
    expect(ev.exception.values[0]).toMatchObject({ type: 'TypeError', value: 'boom' });
    expect(ev.extra).toEqual({ path: '/api/x', password: '[removed]', nested: { apiKey: '[removed]', ok: 1 }, otpCode: '[removed]' });
    expect(lines.join('')).not.toContain('hunter2');
  });
  it('posts the envelope when configured, stays quiet when not, and never throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return { ok: true }; }) as unknown as typeof fetch;
    await reportError(new Error('one'), { event: 'x' }, { SENTRY_DSN: 'https://k@o1.ingest.sentry.io/7' }, ok);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://o1.ingest.sentry.io/api/7/envelope/');
    await reportError(new Error('two'), {}, {}, ok);
    expect(calls).toHaveLength(1);
    const down = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    await expect(reportError('plain string', {}, { SENTRY_DSN: 'https://k@o1.ingest.sentry.io/7' }, down)).resolves.toBeUndefined();
    spy.mockRestore();
  });
  it('writes one JSON line per log, and honours the level', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    log('info', 'hello', { a: 1 });
    expect(JSON.parse(String(out.mock.calls[0]![0]))).toMatchObject({ level: 'info', event: 'hello', a: 1 });
    log('debug', 'quiet');
    expect(out).toHaveBeenCalledTimes(1);
    out.mockRestore();
  });
});
