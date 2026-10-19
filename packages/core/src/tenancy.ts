import { withTenant, type Sql, type Tx } from '@kora/db';
import { can, ForbiddenError, type Action, type Role } from './permissions.js';

export interface Membership { businessId: string; legalName: string; role: Role }

export async function listBusinesses(sql: Sql, userId: string): Promise<Membership[]> {
  const rows = await sql`select business_id, legal_name, role from my_memberships(${userId})`;
  return rows.map((r) => ({ businessId: r.business_id, legalName: r.legal_name, role: r.role }));
}

export async function createBusiness(
  sql: Sql, userId: string,
  b: { legalName: string; gstin: string | null; stateCode: string; registrationType: 'unregistered' | 'regular' | 'composition' | 'sez' | 'isd' },
): Promise<string> {
  const [r] = await sql`select create_business(${userId}, ${b.legalName}, ${b.gstin}, ${b.stateCode}, ${b.registrationType}) as id`;
  return r!.id as string;
}

export interface TenantSession { businessId: string; userId: string; role: Role }

/** Confirms the user belongs to the business. Call once per request, before any tenant query. */
export async function resolveTenant(sql: Sql, userId: string, businessId: string): Promise<TenantSession> {
  const [r] = await sql`select member_role(${userId}, ${businessId}) as role`;
  if (!r?.role) throw new ForbiddenError('document.read');
  return { businessId, userId, role: r.role as Role };
}

/** Runs fn inside the tenant, after checking the role may perform the action. */
export function inTenant<T>(sql: Sql, t: TenantSession, action: Action, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!can(t.role, action)) throw new ForbiddenError(action);
  return withTenant(sql, { businessId: t.businessId, userId: t.userId }, fn);
}

export async function addMember(sql: Sql, actorId: string, businessId: string, userId: string, role: Role): Promise<void> {
  await sql`select add_member(${actorId}, ${businessId}, ${userId}, ${role})`;
}
