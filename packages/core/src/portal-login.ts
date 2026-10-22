import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { SYSTEM_USER, withTenant, type Sql } from '@kora/db';
import type { OtpSender } from '@kora/adapters';
import { normaliseIdentifier } from './identifier.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { ValidationError } from './validation.js';

/**
 * Optional sign-in for the customer portal. The private link stays the first credential; when the business turns on
 * "ask for a code", the link alone shows nothing. The customer asks for a code to the email or mobile number on their
 * record, types it, and gets a short session in a cookie. Codes and sessions are stored only as hashes.
 */
export const PORTAL_CODE_MINUTES = 10;
export const PORTAL_SESSION_HOURS = 12;
const MAX_ATTEMPTS = 5, MAX_CODES_PER_15_MIN = 5, COOLDOWN_SECONDS = 30;
const TOKEN = /^[A-Za-z0-9_-]{10,64}$/;
const sha = (s: string) => createHash('sha256').update(s).digest();

/** The hash a code is stored under. The test and the sign-in both use this, so there is one definition. */
export const portalCodeHash = (secret: string, linkId: string, code: string) => createHmac('sha256', secret).update(`portal:${linkId}:${code}`).digest();

async function link(sql: Sql, token: string) {
  if (!TOKEN.test(token)) return null;
  const [r] = await sql`select business_id, party_id, link_id from portal_lookup(${token}, false)`;
  return r ? { businessId: r.business_id as string, partyId: r.party_id as string, linkId: r.link_id as string } : null;
}
const system = (businessId: string) => ({ businessId, userId: SYSTEM_USER });

const maskEmail = (e: string) => { const [u, d] = e.split('@') as [string, string]; return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`; };
const maskPhone = (p: string) => `+91 ${'*'.repeat(6)}${p.slice(-4)}`;

/** The owner turns the code step on or off for a customer's live link. */
export async function setPortalCodeLogin(sql: Sql, t: TenantSession, partyId: string, on: boolean): Promise<void> {
  await inTenant(sql, t, 'document.issue', async (tx) => {
    const r = await tx`update portal_link set code_login = ${on} where party_id = ${partyId} and revoked_at is null returning id`;
    if (r.length === 0) throw new ValidationError('Make a portal link for this customer first.');
    // Turning it on ends sessions opened while it was off; turning it off leaves nothing to keep.
    await tx`delete from portal_session where portal_link_id = ${r[0]!.id}`;
  });
}

/** What the sign-in screen needs: whether a code is wanted, and where it can go (masked). Null if the link is not valid. */
export async function portalLoginInfo(sql: Sql, token: string) {
  const who = await link(sql, token);
  if (!who) return null;
  return withTenant(sql, system(who.businessId), async (tx) => {
    const [l] = await tx`select code_login from portal_link where id = ${who.linkId}`;
    const [p] = await tx`select phone, email from party where id = ${who.partyId}`;
    let sms: string | null = null, email: string | null = null;
    try { if (p?.phone) sms = maskPhone(normaliseIdentifier(String(p.phone)).value); } catch { /* an unusable number is simply not offered */ }
    try { if (p?.email) email = maskEmail(normaliseIdentifier(String(p.email)).value); } catch { /* same for email */ }
    return { codeRequired: !!l?.code_login, destinations: { sms, email } };
  });
}

/**
 * Sends a code to the email or mobile number on the customer's record. The customer never types the address, so the code cannot be
 * sent anywhere else. If the record has both, the customer chooses; with one, it goes there.
 */
export async function portalSendCode(sql: Sql, sender: OtpSender, secret: string, token: string, channel?: 'sms' | 'email', opts: { fixedCode?: string } = {}) {
  if (secret.length < 32) throw new Error('OTP_HMAC_SECRET must be at least 32 characters');
  const who = await link(sql, token);
  if (!who) return null;
  const sent = await withTenant(sql, system(who.businessId), async (tx) => {
    const [l] = await tx`select code_login from portal_link where id = ${who.linkId}`;
    if (!l?.code_login) throw new ValidationError('This link does not need a code.');
    const [p] = await tx`select phone, email from party where id = ${who.partyId}`;
    const options: { channel: 'sms' | 'email'; value: string }[] = [];
    try { if (p?.phone) options.push(normaliseIdentifier(String(p.phone))); } catch { /* skip */ }
    try { if (p?.email) options.push(normaliseIdentifier(String(p.email))); } catch { /* skip */ }
    const found = options.find((o) => !channel || o.channel === channel);
    const pick = found ? { channel: found.channel, to: found.value } : null;
    if (!pick) throw new ValidationError('There is no email or mobile number on record to send a code to. Ask the business to add one.');
    const [r] = await tx`select count(*) filter (where created_at > now() - interval '15 minutes')::int as recent,
                                coalesce(extract(epoch from now() - max(created_at)), 1e9)::float as since_last
                           from portal_code where portal_link_id = ${who.linkId}`;
    if ((r!.recent as number) >= MAX_CODES_PER_15_MIN) throw new ValidationError('Too many codes asked for. Try again in a few minutes.');
    if ((r!.since_last as number) < COOLDOWN_SECONDS) throw new ValidationError(`Wait ${COOLDOWN_SECONDS} seconds before asking for another code.`);
    const code = opts.fixedCode ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    await tx`insert into portal_code (business_id, portal_link_id, channel, code_hash, expires_at)
             values (${who.businessId}, ${who.linkId}, ${pick.channel}, ${portalCodeHash(secret, who.linkId, code)}, now() + ${PORTAL_CODE_MINUTES + ' minutes'}::interval)`;
    return { ...pick, code };
  });
  await sender.send({ channel: sent!.channel, to: sent!.to, code: sent!.code });
  return { channel: sent!.channel, to: sent!.channel === 'sms' ? maskPhone(sent!.to) : maskEmail(sent!.to), minutes: PORTAL_CODE_MINUTES };
}

/** Checks the code and opens a session. Five wrong tries use the code up. Returns the session token for the cookie. */
export async function portalVerifyCode(sql: Sql, secret: string, token: string, code: string): Promise<{ session: string; hours: number } | null> {
  const who = await link(sql, token);
  if (!who) return null;
  const bad = () => new ValidationError('That code is not right or has expired. Ask for a new one.', 'code');
  if (!/^[0-9]{6}$/.test(String(code ?? '').trim())) throw bad();
  // The guess is counted and committed on its own, so a wrong guess still counts when this function then throws.
  const c = await withTenant(sql, system(who.businessId), async (tx) => {
    const [r] = await tx`
      update portal_code set attempts = attempts + 1
       where id = (select id from portal_code where portal_link_id = ${who.linkId} and consumed_at is null and expires_at > now() order by created_at desc limit 1)
         and attempts < ${MAX_ATTEMPTS} returning id, code_hash`;
    return r ?? null;
  });
  if (!c) throw bad();
  if (!timingSafeEqual(c.code_hash as Buffer, portalCodeHash(secret, who.linkId, String(code).trim()))) throw bad();
  return withTenant(sql, system(who.businessId), async (tx) => {
    const [used] = await tx`update portal_code set consumed_at = now() where id = ${c.id} and consumed_at is null returning id`;
    if (!used) throw bad();
    const session = randomBytes(32).toString('base64url');
    await tx`insert into portal_session (business_id, portal_link_id, token_hash, expires_at)
             values (${who.businessId}, ${who.linkId}, ${sha(session)}, now() + ${PORTAL_SESSION_HOURS + ' hours'}::interval)`;
    return { session, hours: PORTAL_SESSION_HOURS };
  });
}

export type PortalAccess = 'ok' | 'code_needed' | 'invalid';

/** Can this visitor see the portal? A link that does not ask for a code is open; one that does needs a live session made for that link. */
export async function portalAccess(sql: Sql, token: string, session?: string | null): Promise<PortalAccess> {
  const who = await link(sql, token);
  if (!who) return 'invalid';
  return withTenant(sql, system(who.businessId), async (tx) => {
    const [l] = await tx`select code_login from portal_link where id = ${who.linkId}`;
    if (!l?.code_login) return 'ok' as const;
    if (!session) return 'code_needed' as const;
    const [s] = await tx`select 1 as ok from portal_session where portal_link_id = ${who.linkId} and token_hash = ${sha(session)} and expires_at > now()`;
    return s ? ('ok' as const) : ('code_needed' as const);
  });
}

export async function portalSignOut(sql: Sql, token: string, session?: string | null): Promise<void> {
  const who = await link(sql, token);
  if (!who || !session) return;
  await withTenant(sql, system(who.businessId), (tx) => tx`delete from portal_session where portal_link_id = ${who.linkId} and token_hash = ${sha(session)}`);
}
