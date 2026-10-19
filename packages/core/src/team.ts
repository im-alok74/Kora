import type { Sql } from '@kora/db';
import { normaliseIdentifier } from './identifier.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { ValidationError } from './validation.js';
import type { Role } from './permissions.js';

const ROLES: Role[] = ['owner', 'staff', 'accountant'];

export async function listMembers(sql: Sql, t: TenantSession) {
  const rows = await inTenant(sql, t, 'document.read', (tx) => tx`select * from list_members()`);
  return rows.map((r) => ({ userId: r.user_id as string, role: r.role as Role, phone: r.phone as string | null, email: r.email as string | null, name: r.display_name as string | null, joinedAt: r.joined_at as string }));
}

/**
 * Adds a person by mobile number or email. They sign in with that number or email (one-time code),
 * so there is no password to share. If they have never used Kora, their account is created here.
 */
export async function inviteMember(sql: Sql, t: TenantSession, a: { identifier: string; role: string }) {
  if (!ROLES.includes(a.role as Role)) throw new ValidationError('Choose owner, staff or accountant.', 'role');
  const id = normaliseIdentifier(a.identifier);
  return inTenant(sql, t, 'member.manage', async (tx) => {
    const col = id.channel === 'sms' ? 'phone' : 'email';
    let [u] = await tx`select id from app_user where ${tx(col)} = ${id.value}`;
    if (!u) [u] = await tx`insert into app_user (${tx(col)}) values (${id.value}) on conflict (${tx(col)}) do update set ${tx(col)} = excluded.${tx(col)} returning id`;
    try {
      await tx`select add_member(${t.userId}, ${t.businessId}, ${u!.id}, ${a.role})`;
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ValidationError('That person is already a member.', 'identifier');
      throw e;
    }
    return { userId: u!.id as string, identifier: id.value };
  });
}

export async function changeRole(sql: Sql, t: TenantSession, userId: string, role: string) {
  if (!ROLES.includes(role as Role)) throw new ValidationError('Choose owner, staff or accountant.', 'role');
  await inTenant(sql, t, 'member.manage', async (tx) => {
    try {
      await tx`select set_member_role(${t.userId}, ${t.businessId}, ${userId}, ${role})`;
    } catch (e) {
      if ((e as { code?: string }).code === '23514') throw new ValidationError('A business must keep at least one owner.');
      throw e;
    }
  });
}

export async function removeMember(sql: Sql, t: TenantSession, userId: string) {
  await inTenant(sql, t, 'member.manage', async (tx) => {
    try {
      await tx`select remove_member(${t.userId}, ${t.businessId}, ${userId})`;
    } catch (e) {
      if ((e as { code?: string }).code === '23514') throw new ValidationError('A business must keep at least one owner.');
      throw e;
    }
  });
}

export async function auditLog(sql: Sql, t: TenantSession, o: { table?: string; rowId?: string; limit?: number } = {}) {
  return inTenant(sql, t, 'audit.read', (tx) => tx`select * from audit_with_actors(${o.limit ?? 100}, ${o.table ?? null}, ${o.rowId ?? null})`);
}
