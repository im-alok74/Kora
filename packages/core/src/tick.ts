import type { Sql } from '@kora/db';
import { runJobsOnce, type Handlers } from './jobs.js';
import { processDueReminders } from './reminders.js';
import { processDueRecurring } from './recurring.js';

/**
 * One pass of the background work, for hosts that cannot keep a worker process running: queue due reminders and recurring
 * invoices, then run ready jobs until none are left or the time budget is used. The budget is checked between batches;
 * an in-progress handler can exceed it. Claims coordinate concurrent runners, but external side effects remain at least once.
 */
export async function runTick(sql: Sql, handlers: Handlers, o: { worker?: string; budgetMs?: number } = {}) {
  const started = Date.now();
  const budget = o.budgetMs ?? 40_000;
  const reminders = await processDueReminders(sql);
  const recurring = await processDueRecurring(sql);
  const jobs = { claimed: 0, done: 0, retried: 0, failed: 0 };
  while (Date.now() - started < budget) {
    const r = await runJobsOnce(sql, handlers, { worker: o.worker ?? 'cron', limit: 10 });
    jobs.claimed += r.claimed; jobs.done += r.done; jobs.retried += r.retried; jobs.failed += r.failed;
    if (r.claimed === 0) break;
  }
  return { reminders, recurring, jobs, ms: Date.now() - started };
}
