import type { Sql } from '@kora/db';
import { PLANS, isPlanId } from './plans.js';
import { ValidationError } from './validation.js';

/**
 * What Kora's own staff can see and do. WHO may call these is decided in the web layer (an allowlist of e-mail addresses and a
 * sign-in with an authenticator code); the functions here only run what the database functions in 0193_admin.sql allow, and every
 * change is logged there with the admin's id. Nothing here returns invoice contents.
 */
export const adminEmails = (env: Record<string, string | undefined> = process.env): string[] =>
  (env.KORA_ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

/** True for a user whose e-mail address is on the allowlist. A phone-only account is never an admin. */
export async function isAdminUser(sql: Sql, userId: string, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const list = adminEmails(env);
  if (!list.length) return false;
  const [u] = await sql`select email from app_user where id = ${userId} and deleted_at is null`;
  return !!u?.email && list.includes(String(u.email).toLowerCase());
}

const one = async <T>(p: PromiseLike<{ [k: string]: unknown }[]>, col: string): Promise<T> => (await p)[0]![col] as T;
const uuid = (s: unknown, field: string) => {
  if (typeof s !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) throw new ValidationError('That id is not valid.', field);
  return s;
};
const dbError = (e: unknown): never => {
  if ((e as { code?: string })?.code === '22023') throw new ValidationError((e as Error).message);
  throw e;
};

export async function adminOverview(sql: Sql): Promise<Record<string, any>> {
  const o = await one<Record<string, unknown>>(sql`select admin_overview() as r`, 'r');
  const by = (o.activeByPlan ?? {}) as Record<string, number>;
  const mrrPaise = Object.entries(by).reduce((n, [plan, count]) => n + (isPlanId(plan) ? PLANS[plan].pricePaise * Number(count) : 0), 0);
  return { ...o, mrrPaise: String(mrrPaise) };
}

export const adminBusinesses = (sql: Sql, q: string, limit = 50, offset = 0) => one<unknown[]>(sql`select admin_businesses(${q.slice(0, 80)}, ${limit}, ${offset}) as r`, 'r');
export const adminBusiness = (sql: Sql, id: string) => one<Record<string, unknown>>(sql`select admin_business(${uuid(id, 'id')}) as r`, 'r');
export const adminUsers = (sql: Sql, q: string, limit = 50) => one<unknown[]>(sql`select admin_users(${q.slice(0, 80)}, ${limit}) as r`, 'r');
export const adminAudit = (sql: Sql, limit = 100) => one<unknown[]>(sql`select admin_audit_list(${limit}) as r`, 'r');
export const adminPrivacyRequests = (sql: Sql, openOnly: boolean) => one<unknown[]>(sql`select admin_privacy_requests(${openOnly}) as r`, 'r');
export const adminBreaches = (sql: Sql) => one<unknown[]>(sql`select admin_breaches() as r`, 'r');

export async function adminSetPlan(sql: Sql, adminId: string, i: { businessId: string; plan: string; status: string; validUntil?: string | null; note?: string }) {
  if (!isPlanId(i.plan)) throw new ValidationError('Choose starter, business or firm.', 'plan');
  const validUntil = i.validUntil ? new Date(i.validUntil) : null;
  if (validUntil && Number.isNaN(validUntil.getTime())) throw new ValidationError('That date is not valid.', 'validUntil');
  if (!String(i.note ?? '').trim()) throw new ValidationError('Say why in the note: it goes in the admin log.', 'note');
  await sql`select admin_set_plan(${adminId}, ${uuid(i.businessId, 'businessId')}, ${i.plan}, ${i.status}, ${validUntil}::timestamptz, ${String(i.note)})`.catch(dbError);
}

export async function adminRevokeSessions(sql: Sql, adminId: string, userId: string): Promise<number> {
  return one<number>(sql`select admin_revoke_sessions(${adminId}, ${uuid(userId, 'userId')}) as r`, 'r');
}

export async function adminResolvePrivacyRequest(sql: Sql, adminId: string, i: { id: string; status: string; resolution?: string }) {
  if ((i.status === 'done' || i.status === 'rejected') && !String(i.resolution ?? '').trim()) throw new ValidationError('Write the answer the person will see.', 'resolution');
  await sql`select admin_resolve_privacy_request(${adminId}, ${uuid(i.id, 'id')}, ${i.status}, ${String(i.resolution ?? '')})`.catch(dbError);
}

export async function adminRecordBreach(sql: Sql, adminId: string, i: { discoveredAt: string; summary: string; dataAffected?: string; peopleAffected?: number | null; contained?: boolean }) {
  const when = new Date(i.discoveredAt);
  if (Number.isNaN(when.getTime())) throw new ValidationError('When was it found?', 'discoveredAt');
  if (!String(i.summary ?? '').trim()) throw new ValidationError('Describe what happened.', 'summary');
  return one<string>(sql`select admin_record_breach(${adminId}, ${when}::timestamptz, ${String(i.summary)}, ${String(i.dataAffected ?? '')}, ${i.peopleAffected ?? null}, ${!!i.contained}) as r`, 'r');
}

export async function adminUpdateBreach(sql: Sql, adminId: string, i: { id: string; contained?: boolean; boardNotifiedAt?: string; peopleNotifiedAt?: string; notes?: string }) {
  const d = (s?: string) => (s ? new Date(s) : null);
  await sql`select admin_update_breach(${adminId}, ${uuid(i.id, 'id')}, ${i.contained ?? null}, ${d(i.boardNotifiedAt)}::timestamptz, ${d(i.peopleNotifiedAt)}::timestamptz, ${i.notes ?? null})`.catch(dbError);
}

/** Queue health for the panel: the same numbers the operator route gives, plus the failures to retry. */
export async function adminJobs(sql: Sql) {
  const counts = await sql`select queue, status, count(*)::int as n, min(run_at) filter (where status = 'queued') as oldest_waiting from job group by queue, status order by queue, status`;
  const failed = await sql`select id, queue, business_id, attempts, last_error, updated_at from job where status = 'failed' order by updated_at desc limit 50`;
  return { counts, failed };
}

export async function adminRetryJobs(sql: Sql, adminId: string, queue?: string): Promise<number> {
  const rows = await sql`update job set status = 'queued', attempts = 0, lease_token = null, run_at = now(), locked_at = null, locked_by = null, updated_at = now()
                          where status = 'failed' and (${queue ?? null}::text is null or queue = ${queue ?? null}) returning id`;
  await sql`select admin_log(${adminId}, 'jobs.retried', ${queue ?? 'all'}, ${sql.json({ count: rows.length })})`;
  return rows.length;
}
