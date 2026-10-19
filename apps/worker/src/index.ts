import { createHttpGsp, createMockMessenger } from '@kora/adapters';
import { createHandlers, processDueRecurring, processDueReminders, runJobsOnce } from '@kora/core';
import { createSql } from '@kora/db';
import { createServer } from 'node:http';

/**
 * Background worker: sends queued messages, registers e-invoices, and queues due reminders and recurring invoices.
 * It only polls and runs jobs; every job is safe to run twice, so a crash or a second worker does no harm.
 */
const log = (event: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), event, ...data }));

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (see .env.example)`);
  return v;
}

const provider = process.env.MESSENGER ?? 'mock';
if (provider !== 'mock') throw new Error(`Unknown MESSENGER "${provider}". Real providers need an approved account first.`);
if (process.env.NODE_ENV === 'production' && process.env.KORA_ALLOW_MOCKS !== '1') {
  throw new Error('The mock messenger is not allowed in production. Connect a real provider, or set KORA_ALLOW_MOCKS=1 for a staging demo.');
}

const sql = createSql(need('DATABASE_URL'), { max: 5 });
const messenger = createMockMessenger((line) => log('message', { line }));
const gsp = createHttpGsp({ baseUrl: need('GSP_URL'), token: process.env.GSP_TOKEN, timeoutMs: Number(process.env.GSP_TIMEOUT_MS ?? 15_000) });
const handlers = createHandlers(sql, { messenger, gsp, appUrl: process.env.APP_URL ?? 'http://localhost:3000' });
const worker = `worker-${process.pid}`;
let stopping = false;
for (const s of ['SIGTERM', 'SIGINT'] as const) process.on(s, () => { log('stopping', { signal: s }); stopping = true; });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastReminders = 0;
let lastRecurring = 0;
let lastTick = Date.now();
const reminderEveryMs = Number(process.env.REMINDER_TICK_MS ?? 30_000);
const recurringEveryMs = Number(process.env.RECURRING_TICK_MS ?? 60_000);

// Liveness for the platform: 200 while the loop is turning, 503 if it has stalled for a minute.
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 0);
if (healthPort) {
  createServer((req, res) => {
    if (req.url !== '/healthz') { res.writeHead(404).end(); return; }
    const ok = Date.now() - lastTick < 60_000;
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }).end(JSON.stringify({ status: ok ? 'ok' : 'stalled', worker }));
  }).listen(healthPort, () => log('health', { port: healthPort }));
}

log('started', { worker, queues: Object.keys(handlers) });
while (!stopping) {
  try {
    lastTick = Date.now();
    if (Date.now() - lastReminders > reminderEveryMs) {
      lastReminders = Date.now();
      const r = await processDueReminders(sql);
      if (r.queued || r.skipped) log('reminders', r);
    }
    if (Date.now() - lastRecurring > recurringEveryMs) {
      lastRecurring = Date.now();
      const rr = await processDueRecurring(sql);
      if (rr.created || rr.failed) log('recurring', rr);
    }
    const r = await runJobsOnce(sql, handlers, { worker, limit: 10 });
    if (r.claimed) log('jobs', r);
    if (r.claimed === 0) await sleep(1000);
  } catch (e) {
    log('error', { message: (e as Error).message });
    await sleep(5000);
  }
}
await sql.end({ timeout: 5 });
log('stopped');
