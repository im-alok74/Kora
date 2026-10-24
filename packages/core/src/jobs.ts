import type { Sql, Tx } from '@kora/db';

export interface JobRow {
  id: string; queue: string; business_id: string | null; payload: Record<string, any>;
  attempts: number; max_attempts: number; lease_token?: string;
}

/** Thrown by a handler when retrying cannot help (bad data, a rule that will not change). */
export class PermanentJobError extends Error {
  constructor(message: string) { super(message); this.name = 'PermanentJobError'; }
}
export const isPermanentJobError = (e: unknown): e is PermanentJobError => e instanceof Error && e.name === 'PermanentJobError';

/**
 * Queues a job. Pass the transaction of the change that needs the job: both commit or neither does.
 * With dedupeKey, a second live job for the same queue and key is dropped and null is returned.
 */
export async function enqueue(
  tx: Sql | Tx, queue: string, payload: Record<string, unknown>,
  o: { businessId?: string; runAt?: Date; dedupeKey?: string; maxAttempts?: number } = {},
): Promise<string | null> {
  const rows = await (tx as Sql)`
    insert into job (queue, business_id, payload, run_at, dedupe_key, max_attempts)
    values (${queue}, ${o.businessId ?? null}, ${(tx as Sql).json(payload as any)}, coalesce(${o.runAt ?? null}::timestamptz, now()), ${o.dedupeKey ?? null}, ${o.maxAttempts ?? 8})
    on conflict (queue, dedupe_key) where dedupe_key is not null and status in ('queued', 'running') do nothing
    returning id`;
  return (rows[0]?.id as string | undefined) ?? null;
}

/** 30s, 1m, 2m, 4m ... capped at one hour, with up to 10% jitter so retries do not arrive in a wave. */
export function retryDelaySeconds(attempt: number, rnd: () => number = Math.random): number {
  const base = Math.min(30 * 2 ** Math.max(0, attempt - 1), 3600);
  return Math.round(base * (1 + rnd() * 0.1));
}

export type Handlers = Record<string, (job: JobRow) => Promise<void>>;

/** Claims and runs ready jobs once. Returns what happened, so a worker loop knows whether to sleep. */
export async function runJobsOnce(sql: Sql, handlers: Handlers, o: { worker?: string; limit?: number; deadline?: number } = {}) {
  const out = { claimed: 0, done: 0, retried: 0, failed: 0 };
  const limit = Math.max(0, Math.min(o.limit ?? 10, 100));
  // Claim only the slot we can execute now. The deadline prevents new work, not an in-flight provider call.
  while (out.claimed < limit && Date.now() < (o.deadline ?? Infinity)) {
    const [job] = (await sql`select * from claim_jobs(${Object.keys(handlers)}, 1, ${o.worker ?? 'worker'})`) as unknown as JobRow[];
    if (!job) break;
    out.claimed++;
    const handler = handlers[job.queue]!;
    try {
      await handler(job);
      const result = await sql`update job set status = 'done', finished_at = now(), locked_at = null, locked_by = null, last_error = null, updated_at = now() where id = ${job.id} and status = 'running' and lease_token = ${job.lease_token ?? null}::uuid returning id`;
      out.done += result.length;
    } catch (e) {
      const msg = ((e as Error).message ?? String(e)).slice(0, 500);
      const dead = isPermanentJobError(e) || job.attempts >= job.max_attempts;
      if (dead) {
        const result = await sql`update job set status = 'failed', finished_at = now(), locked_at = null, locked_by = null, last_error = ${msg}, updated_at = now() where id = ${job.id} and status = 'running' and lease_token = ${job.lease_token ?? null}::uuid returning id`;
        out.failed += result.length;
      } else {
        const result = await sql`update job set status = 'queued', run_at = now() + ${retryDelaySeconds(job.attempts) + ' seconds'}::interval,
                                 locked_at = null, locked_by = null, last_error = ${msg}, updated_at = now() where id = ${job.id} and status = 'running' and lease_token = ${job.lease_token ?? null}::uuid returning id`;
        out.retried += result.length;
      }
    }
  }
  return out;
}

export async function jobStats(sql: Sql) {
  const rows = await sql`select queue, status, count(*)::int as n from job group by queue, status order by queue, status`;
  return rows.map((r) => ({ queue: r.queue as string, status: r.status as string, n: r.n as number }));
}
