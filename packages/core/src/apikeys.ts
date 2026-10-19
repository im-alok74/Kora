import { createHash, randomBytes } from 'node:crypto';
import type { Sql } from '@kora/db';
import { inTenant, resolveTenant, type TenantSession } from './tenancy.js';
import type { Role } from './permissions.js';
import { str, ValidationError } from './validation.js';

/**
 * API keys for other programs to read and create documents. A key belongs to one business and acts with the rights of a
 * staff member (write) or an accountant (read), never an owner: it cannot cancel invoices, change settings or manage people.
 * Only a hash is stored, so a key is shown once, when it is made.
 */
export type ApiScope = 'read' | 'write';
const KEY_SHAPE = /^kora_[A-Za-z0-9_-]{32}$/;
const ROLE: Record<ApiScope, Role> = { read: 'accountant', write: 'staff' };
const hashKey = (key: string) => createHash('sha256').update(key).digest();

export async function createApiKey(sql: Sql, t: TenantSession, o: { name: string; scope: ApiScope }) {
  const name = str(o.name, 'Name', { required: true, max: 80 })!;
  if (o.scope !== 'read' && o.scope !== 'write') throw new ValidationError('Choose read or write access.', 'scope');
  const key = `kora_${randomBytes(24).toString('base64url')}`;
  const id = await inTenant(sql, t, 'member.manage', async (tx) => {
    const [n] = await tx`select count(*)::int as n from api_key where revoked_at is null`;
    if ((n!.n as number) >= 20) throw new ValidationError('A business can have at most 20 live API keys. Revoke one you no longer use.');
    const [r] = await tx`insert into api_key (business_id, name, key_hash, prefix, scope, created_by) values (${t.businessId}, ${name}, ${hashKey(key)}, ${key.slice(0, 10)}, ${o.scope}, ${t.userId}) returning id`;
    return r!.id as string;
  });
  return { id, key, prefix: key.slice(0, 10), scope: o.scope };
}

export async function listApiKeys(sql: Sql, t: TenantSession) {
  return inTenant(sql, t, 'member.manage', (tx) => tx`
    select k.id, k.name, k.prefix, k.scope, k.created_at, k.last_used_at, k.revoked_at, coalesce(u.display_name, u.email, u.phone) as created_by
      from api_key k left join app_user u on u.id = k.created_by order by k.revoked_at is not null, k.created_at desc`);
}

export async function revokeApiKey(sql: Sql, t: TenantSession, id: string): Promise<void> {
  await inTenant(sql, t, 'member.manage', async (tx) => {
    const r = await tx`update api_key set revoked_at = now() where id = ${id} and revoked_at is null returning id`;
    if (r.length === 0) throw new ValidationError('API key not found, or already revoked.');
  });
}

/**
 * Turns an Authorization header into the session the request acts with, or null. A key stops working the moment it is revoked,
 * or the person who made it is removed from the business.
 */
export async function authenticateApiKey(sql: Sql, header: string | null): Promise<{ t: TenantSession; scope: ApiScope; keyId: string } | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  if (!m || !KEY_SHAPE.test(m[1]!)) return null;
  const [k] = await sql`select key_id, business_id, scope, created_by from api_key_lookup(${hashKey(m[1]!)})`;
  if (!k) return null;
  try {
    const owner = await resolveTenant(sql, k.created_by as string, k.business_id as string);
    void owner;
  } catch { return null; }
  const scope = k.scope as ApiScope;
  return { t: { businessId: k.business_id as string, userId: k.created_by as string, role: ROLE[scope] }, scope, keyId: k.key_id as string };
}
