import type { Sql } from '@kora/db';
import { runJobsOnce, type Handlers } from './jobs.js';
import { processDueReminders } from './reminders.js';
import { processDueRecurring } from './recurring.js';

/** The nightly clean-up of finished jobs, old events and expired sessions runs in the 21:00 UTC hour (02:30 IST), once per day in effect. */
export const shouldPrune = (now: Date = new Date()) => now.getUTCHours() === 21;

/** Calls the database function from migration 0170. Never throws: before that migration is applied it just reports why it did nothing. */
export async function pruneOperationalData(sql: Sql): Promise<Record<string, unknown>> {
  try {
    const [r] = await sql`select prune_operational_data() as r`;
    return (r?.r ?? {}) as Record<string, unknown>;
  } catch (e) {
    return { skipped: (e as Error).message.slice(0, 120) };
  }
}

/**
 * One pass of the background work, for hosts that cannot keep a worker process running: queue due reminders and recurring
 * invoices, then run ready jobs until none are left or the time budget is used. The budget is checked before each claim;
 * an in-progress handler can exceed it. Claims coordinate concurrent runners, but external side effects remain at least once.
 */
export async function runTick(sql: Sql, handlers: Handlers, o: { worker?: string; budgetMs?: number } = {}) {
  const started = Date.now();
  const budget = o.budgetMs ?? 40_000;
  const reminders = await processDueReminders(sql);
  const recurring = await processDueRecurring(sql);
  const jobs = { claimed: 0, done: 0, retried: 0, failed: 0 };
  while (Date.now() - started < budget) {
    const r = await runJobsOnce(sql, handlers, { worker: o.worker ?? 'cron', limit: 10, deadline: started + budget });
    jobs.claimed += r.claimed; jobs.done += r.done; jobs.retried += r.retried; jobs.failed += r.failed;
    if (r.claimed === 0) break;
  }
  const pruned = shouldPrune() ? await pruneOperationalData(sql) : null;
  return { reminders, recurring, jobs, pruned, ms: Date.now() - started };
}
