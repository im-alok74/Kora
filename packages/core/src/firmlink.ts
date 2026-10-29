import { createHash, randomBytes } from 'node:crypto';
import type { Sql } from '@kora/db';
import { dashboardSummary } from './dashboard.js';
import { assertClientAccess } from './firmclients.js';
import { inFirm, type FirmSession } from './firmtenancy.js';
import type { TenantSession } from './tenancy.js';
import { ValidationError } from './validation.js';

const DAYS = 7;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I, so a code read aloud is not misheard
const hash = (code: string) => createHash('sha256').update(code.trim().toUpperCase().replace(/[\s-]/g, '')).digest('hex');
const newCode = () => Array.from(randomBytes(10), (b) => ALPHABET[b % ALPHABET.length]).join('').replace(/^(.{5})/, '$1-');

/** Firm side: starts a link to a client's Kora business. The code is shown once; only its hash is kept. A fresh request replaces an unused one. */
export async function requestClientLink(sql: Sql, s: FirmSession, clientId: string): Promise<{ code: string; expiresAt: string }> {
  return inFirm(sql, s, 'client.write', async (tx) => {
    await assertClientAccess(tx, s, clientId);
    const [active] = await tx`select 1 as ok from client_business_link where client_id = ${clientId} and status = 'active'`;
    if (active) throw new ValidationError('This client is already linked to a Kora business.');
    await tx`update client_business_link set status = 'revoked', revoked_at = now(), code_hash = null where client_id = ${clientId} and status = 'pending'`;
    const code = newCode();
    const [r] = await tx`
      insert into client_business_link (firm_id, client_id, code_hash, expires_at, requested_by)
      values (${s.firmId}, ${clientId}, ${hash(code)}, now() + ${DAYS + ' days'}::interval, ${s.userId}) returning expires_at`;
    return { code, expiresAt: (r!.expires_at as Date).toISOString() };
  });
}

/** Firm side: stop reading a client's business now, or cancel an unused code. */
export async function revokeClientLink(sql: Sql, s: FirmSession, clientId: string): Promise<void> {
  return inFirm(sql, s, 'client.write', async (tx) => {
    await assertClientAccess(tx, s, clientId);
    await tx`update client_business_link set status = 'revoked', revoked_at = now(), code_hash = null where client_id = ${clientId} and status in ('pending', 'active')`;
  });
}

export async function getClientLink(sql: Sql, s: FirmSession, clientId: string): Promise<{ status: 'none' | 'pending' | 'active'; businessId?: string; expiresAt?: string }> {
  return inFirm(sql, s, 'client.read', async (tx) => {
    await assertClientAccess(tx, s, clientId);
    const [r] = await tx`select status, business_id, expires_at from client_business_link where client_id = ${clientId} and status in ('pending', 'active')`;
    if (!r) return { status: 'none' as const };
    return { status: r.status as 'pending' | 'active', businessId: (r.business_id as string | null) ?? undefined, expiresAt: r.status === 'pending' ? (r.expires_at as Date).toISOString() : undefined };
  });
}

/** Business side: the owner of the business accepts a firm's code. Anyone else is refused by the database. */
export async function acceptClientLink(sql: Sql, t: TenantSession, code: string): Promise<void> {
  if (code.trim().length < 6) throw new ValidationError('Enter the code the firm gave you.', 'code');
  try { await sql`select accept_client_link(${t.userId}, ${t.businessId}, ${hash(code)})`; }
  catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === '42501') throw new ValidationError('Only the owner of this business can accept a firm.');
    if (err.code === '23505') throw new ValidationError('This business is already linked to that firm.');
    if (err.code === '23514') throw new ValidationError('That code is not valid or has expired. Ask the firm for a new one.', 'code');
    throw e;
  }
}

/** Business side: the owner sees which firms can read this business, and stops one. */
export async function listBusinessLinks(sql: Sql, t: TenantSession) {
  const rows = await sql`select link_id, firm_name, client_name, status, created_at from business_client_links(${t.userId}, ${t.businessId})`;
  return rows.map((r) => ({ linkId: r.link_id as string, firmName: r.firm_name as string, clientName: r.client_name as string, status: r.status as string, createdAt: (r.created_at as Date).toISOString() }));
}
export async function revokeBusinessLink(sql: Sql, t: TenantSession, linkId: string): Promise<void> {
  await sql`select revoke_client_link_by_business(${t.userId}, ${t.businessId}, ${linkId})`;
}

/**
 * Firm side: the dashboard of a linked client's business, read through the link. The firm's people are never members of the business;
 * the read happens as a read-only accountant, and only while the link is active and the person may see the client.
 */
export async function linkedClientSummary(sql: Sql, s: FirmSession, clientId: string) {
  const businessId = await inFirm(sql, s, 'client.read', async (tx) => {
    await assertClientAccess(tx, s, clientId);
    const [r] = await tx`select business_id from client_business_link where client_id = ${clientId} and status = 'active'`;
    return r?.business_id as string | undefined;
  });
  if (!businessId) throw new ValidationError('This client is not linked to a Kora business.');
  return dashboardSummary(sql, { businessId, userId: s.userId, role: 'accountant', viaFirm: s.firmId });
}
