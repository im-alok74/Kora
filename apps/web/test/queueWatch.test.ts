import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module used by a GitHub workflow
import { evaluate } from '../../../.github/scripts/queue-watch.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NOW = Date.parse('2026-10-24T10:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60000).toISOString();
const ok = { status: 'ok' };

describe('queue watch decision', () => {
  it('is healthy with an empty or fresh queue', () => {
    expect(evaluate({ health: ok, jobs: { counts: [] }, now: NOW })).toEqual([]);
    expect(evaluate({ health: ok, jobs: { counts: [{ queue: 'delivery.send', status: 'queued', n: 3, oldest_waiting: ago(2) }, { queue: 'delivery.send', status: 'done', n: 90, oldest_waiting: null }] }, now: NOW })).toEqual([]);
  });

  it('reports a job that has waited too long, naming the queue', () => {
    const p = evaluate({ health: ok, jobs: { counts: [{ queue: 'einvoice.register', status: 'queued', n: 1, oldest_waiting: ago(40) }] }, now: NOW });
    expect(p).toHaveLength(1);
    expect(p[0]).toContain('einvoice.register');
    expect(p[0]).toContain('40 minutes');
  });

  it('respects the limit that is passed in', () => {
    const jobs = { counts: [{ queue: 'webhook.deliver', status: 'queued', n: 1, oldest_waiting: ago(20) }] };
    expect(evaluate({ health: ok, jobs, now: NOW, maxWaitMin: 30 })).toEqual([]);
    expect(evaluate({ health: ok, jobs, now: NOW, maxWaitMin: 15 })).toHaveLength(1);
  });

  it('reports jobs that failed for good', () => {
    const p = evaluate({ health: ok, jobs: { counts: [{ queue: 'delivery.send', status: 'failed', n: 2, oldest_waiting: null }] }, now: NOW });
    expect(p[0]).toContain('failed');
  });

  it('reports a bad or missing health answer and a bad queue answer', () => {
    expect(evaluate({ health: { status: 'down' }, jobs: { counts: [] }, now: NOW })).toHaveLength(1);
    expect(evaluate({ health: null, jobs: { counts: [] }, now: NOW })).toHaveLength(1);
    expect(evaluate({ health: ok, jobs: null, now: NOW })).toHaveLength(1);
  });
});

describe('scheduler workflows', () => {
  const tick = readFileSync(join(root, '.github', 'workflows', 'tick.yml'), 'utf8');
  const watch = readFileSync(join(root, '.github', 'workflows', 'watch.yml'), 'utf8');

  it('read the address and the secret from repository secrets', () => {
    for (const f of [tick, watch]) {
      expect(f).toContain('${{ secrets.KORA_SITE_URL }}');
      expect(f).toContain('${{ secrets.CRON_SECRET }}');
    }
  });

  it('never put a secret on a command line or hold a literal address', () => {
    for (const f of [tick, watch]) {
      expect(f).not.toMatch(/https:\/\/[a-z0-9.-]+\.(vercel\.app|com|in)/i);
      expect(f).not.toMatch(/run:[^\n]*\$\{\{\s*secrets\./);
    }
  });

  it('run on a schedule and by hand, and call only the tick and read-only routes', () => {
    expect(tick).toContain('schedule');
    expect(tick).toContain('workflow_dispatch');
    expect(tick).toContain('/api/cron/tick');
    expect(watch).toContain('workflow_dispatch');
    expect(readFileSync(join(root, '.github', 'scripts', 'queue-watch.mjs'), 'utf8')).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
  });

  it('do nothing and do not fail while the secrets are missing', () => {
    expect(tick).toContain('exit 0');
    expect(watch).toContain('78');
  });
});

it('alerts on expired running leases and unknown schema readiness', () => {
  expect(evaluate({ health: { status: 'ok', schema: 'unknown' }, jobs: { counts: [] }, now: NOW })).toHaveLength(1);
  expect(evaluate({ health: ok, jobs: { counts: [{ queue: 'delivery.send', status: 'running', oldest_running: ago(11), n: 1 }] }, now: NOW })[0]).toContain('lease has expired');
  expect(evaluate({ health: ok, jobs: { counts: [{ queue: 'delivery.send', status: 'running', oldest_running: ago(2), n: 1 }] }, now: NOW })).toEqual([]);
});
