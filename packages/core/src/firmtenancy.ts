import { withFirm, type Sql, type Tx } from '@kora/db';

/** Roles inside a CA firm. These say nothing about access to a client's books; that needs a role in the client's business. */
export type FirmRole = 'partner' | 'manager' | 'preparer' | 'reviewer';
export type FirmAction = 'firm.read' | 'member.manage' | 'client.read' | 'client.write' | 'client.assign';

const GRANTS: Record<FirmRole, ReadonlySet<FirmAction>> = {
  partner: new Set<FirmAction>(['firm.read', 'member.manage', 'client.read', 'client.write', 'client.assign']),
  manager: new Set<FirmAction>(['firm.read', 'client.read', 'client.write', 'client.assign']),
  preparer: new Set<FirmAction>(['firm.read', 'client.read']),
  reviewer: new Set<FirmAction>(['firm.read', 'client.read']),
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

export async function listFirmMembers(sql: Sql, s: FirmSession) {
  return inFirm(sql, s, 'firm.read', async (tx) => (await tx`
    select m.user_id, u.email, m.role, m.active from firm_member m join app_user u on u.id = m.user_id
     where m.firm_id = ${s.firmId} order by m.active desc, u.email`).map((r) => ({ userId: r.user_id as string, email: r.email as string, role: r.role as FirmRole, active: r.active as boolean })));
}
