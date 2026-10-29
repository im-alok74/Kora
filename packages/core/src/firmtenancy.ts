import { withFirm, type Sql, type Tx } from '@kora/db';
import { normaliseIdentifier } from './identifier.js';
import { PLANS, plansEnforced } from './plans.js';
import { ValidationError } from './validation.js';

/** Roles inside a CA firm. These say nothing about access to a client's books; that needs a role in the client's business. */
export type FirmRole = 'partner' | 'manager' | 'preparer' | 'reviewer';
export type FirmAction = 'firm.read' | 'member.manage' | 'client.read' | 'client.write' | 'client.assign'
  | 'engagement.read' | 'engagement.write' | 'engagement.work';

const GRANTS: Record<FirmRole, ReadonlySet<FirmAction>> = {
  partner: new Set<FirmAction>(['firm.read', 'member.manage', 'client.read', 'client.write', 'client.assign', 'engagement.read', 'engagement.write', 'engagement.work']),
  manager: new Set<FirmAction>(['firm.read', 'client.read', 'client.write', 'client.assign', 'engagement.read', 'engagement.write', 'engagement.work']),
  preparer: new Set<FirmAction>(['firm.read', 'client.read', 'engagement.read', 'engagement.work']),
  reviewer: new Set<FirmAction>(['firm.read', 'client.read', 'engagement.read', 'engagement.work']),
};

export const canFirm = (role: FirmRole, action: FirmAction) => GRANTS[role].has(action);

/** Partners and managers work across every client; preparers and reviewers only the clients assigned to them. */
export const seesAllClients = (role: FirmRole) => role === 'partner' || role === 'manager';

export class FirmForbiddenError extends Error {
  constructor(public action: FirmAction) { super(`Your firm role cannot do this (${action}).`); this.name = 'FirmForbiddenError'; }
}

export interface FirmMembership { firmId: string; name: string; role: FirmRole }
export interface FirmSession { firmId: string; userId: string; role: FirmRole }

export async function createFirm(sql: Sql, userId: string, name: string): Promise<string> {
  const [r] = await sql`select create_firm(${userId}, ${name}) as id`;
  return r!.id as string;
}

export async function listFirms(sql: Sql, userId: string): Promise<FirmMembership[]> {
  const rows = await sql`select firm_id, name, role from my_firms(${userId})`;
  return rows.map((r) => ({ firmId: r.firm_id, name: r.name, role: r.role }));
}

/** Confirms the user is an active member of the firm. Call once per request, before any firm query. */
export async function resolveFirm(sql: Sql, userId: string, firmId: string): Promise<FirmSession> {
  const [r] = await sql`select firm_member_role(${userId}, ${firmId}) as role`;
  if (!r?.role) throw new FirmForbiddenError('firm.read');
  return { firmId, userId, role: r.role as FirmRole };
}

/** Runs fn inside the firm, after checking the role may perform the action. */
export function inFirm<T>(sql: Sql, s: FirmSession, action: FirmAction, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!canFirm(s.role, action)) throw new FirmForbiddenError(action);
  return withFirm(sql, { firmId: s.firmId, userId: s.userId }, fn);
}

export async function addFirmMember(sql: Sql, actorId: string, firmId: string, userId: string, role: FirmRole): Promise<void> {
  await sql`select add_firm_member(${actorId}, ${firmId}, ${userId}, ${role})`;
}

export async function removeFirmMember(sql: Sql, actorId: string, firmId: string, userId: string): Promise<void> {
  await sql`select remove_firm_member(${actorId}, ${firmId}, ${userId})`;
}

/** The firms that have invited this person and are waiting for an answer. */
export async function listFirmInvites(sql: Sql, userId: string): Promise<FirmMembership[]> {
  const rows = await sql`select firm_id, name, role from my_firm_invites(${userId})`;
  return rows.map((r) => ({ firmId: r.firm_id, name: r.name, role: r.role }));
}

/** Accepting makes the person a member; declining switches the invitation off. */
export async function answerFirmInvite(sql: Sql, userId: string, firmId: string, accept: boolean): Promise<void> {
  try { await sql`select answer_firm_invite(${userId}, ${firmId}, ${accept})`; }
  catch (e) {
    if ((e as { code?: string }).code === '23514') throw new ValidationError('There is no invitation to answer.');
    throw e;
  }
}

/**
 * A partner adds a person by mobile number or email, as a business owner does. They sign in with that number or email (one-time code).
 * If they have never used Kora their account is created here. Adding someone already in the firm changes their role or turns them back on.
 */
export async function inviteFirmMember(sql: Sql, s: FirmSession, a: { identifier: string; role: string }): Promise<{ userId: string }> {
  if (!(['partner', 'manager', 'preparer', 'reviewer'] as string[]).includes(a.role)) throw new ValidationError('Choose partner, manager, preparer or reviewer.', 'role');
  const id = normaliseIdentifier(a.identifier);
  return inFirm(sql, s, 'member.manage', async (tx) => {
    const col = id.channel === 'sms' ? 'phone' : 'email';
    let [u] = await tx`select id from app_user where ${tx(col)} = ${id.value}`;
    if (!u) [u] = await tx`insert into app_user (${tx(col)}) values (${id.value}) on conflict (${tx(col)}) do update set ${tx(col)} = excluded.${tx(col)} returning id`;
    const [on] = await tx`select active from firm_member where firm_id = ${s.firmId} and user_id = ${u!.id}`;
    if (!on?.active && plansEnforced()) {
      const [{ n }] = (await tx`select count(*)::int as n from firm_member where firm_id = ${s.firmId} and active`) as unknown as [{ n: number }];
      if (n >= PLANS.firm.limits.members) throw new ValidationError(`The Firm plan includes ${PLANS.firm.limits.members} people.`);
    }
    try { await tx`select invite_firm_member(${s.userId}, ${s.firmId}, ${u!.id}, ${a.role})`; }
    catch (e) {
      if ((e as { code?: string }).code === '23514') throw new ValidationError('A firm needs at least one partner.');
      throw e;
    }
    return { userId: u!.id as string };
  });
}

export async function removeFirmMemberChecked(sql: Sql, s: FirmSession, userId: string): Promise<void> {
  inFirmGuard(s, 'member.manage');
  try { await removeFirmMember(sql, s.userId, s.firmId, userId); }
  catch (e) {
    if ((e as { code?: string }).code === '23514') throw new ValidationError('A firm needs at least one partner.');
    throw e;
  }
}
function inFirmGuard(s: FirmSession, action: FirmAction) { if (!canFirm(s.role, action)) throw new FirmForbiddenError(action); }

export async function listFirmMembers(sql: Sql, s: FirmSession) {
  return inFirm(sql, s, 'firm.read', async (tx) => (await tx`
    select m.user_id, coalesce(u.email, u.phone, '') as email, m.role, m.active, (m.accepted_at is null) as pending from firm_member m join app_user u on u.id = m.user_id
     where m.firm_id = ${s.firmId} order by m.active desc, coalesce(u.email, u.phone, '')`).map((r) => ({ userId: r.user_id as string, email: r.email as string, role: r.role as FirmRole, active: r.active as boolean, pending: r.pending as boolean })));
}
