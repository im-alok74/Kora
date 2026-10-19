import { qrDataUrl } from '@kora/pdf';
import { ValidationError } from '@kora/core';
import { json, requestInfo, SESSION_COOKIE, userRoute } from '../../../lib/server';

/** Everything about the person's own sign-in: devices, recent security events, and whether an authenticator app is on. */
export const GET = userRoute(async ({ userId, token, svc }) => {
  const [sessions, events, mfa, [u]] = await Promise.all([
    svc.auth.listSessions(userId, token), svc.auth.securityEvents(userId, 30), svc.auth.mfaStatus(userId),
    svc.sql`select phone, email, display_name from app_user where id = ${userId}`,
  ]);
  return { user: { phone: u?.phone ?? null, email: u?.email ?? null, name: u?.display_name ?? null }, sessions, events, mfa };
});

/**
 * One endpoint for the actions, each with its own body:
 *   { action: 'mfa.begin' }                              start setting up an authenticator app (returns the secret and a QR image)
 *   { action: 'mfa.confirm', code }                      finish it; returns ten recovery codes, once
 *   { action: 'mfa.disable', code }                      turn it off, with a current code
 *   { action: 'session.revoke', sessionId }              sign one device out
 *   { action: 'session.revokeOthers' }                   sign every other device out
 *   { action: 'identifier.request', identifier }         send a code to a new number or email
 *   { action: 'identifier.confirm', identifier, code }   add it to the account
 *   { action: 'account.delete', confirm: 'DELETE' }      close the account (refused for the only owner of a business)
 */
export const POST = userRoute(async ({ userId, token, svc, req }) => {
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const info = requestInfo(req);
  const str = (k: string) => String(b[k] ?? '');
  switch (b.action) {
    case 'mfa.begin': {
      const [u] = await svc.sql`select coalesce(email, phone) as who from app_user where id = ${userId}`;
      const r = await svc.auth.mfaBegin(userId, String(u?.who ?? 'account'));
      return { secret: r.secret, uri: r.uri, qr: await qrDataUrl(r.uri) };
    }
    case 'mfa.confirm': return svc.auth.mfaConfirm(userId, str('code'), info);
    case 'mfa.disable': await svc.auth.mfaDisable(userId, str('code'), info); return { ok: true };
    case 'session.revoke': return { revoked: await svc.auth.revokeSessionById(userId, str('sessionId'), info) };
    case 'session.revokeOthers': return { revoked: await svc.auth.revokeOtherSessions(userId, token, info) };
    case 'identifier.request': await svc.auth.requestLink(userId, str('identifier'), info); return { ok: true };
    case 'identifier.confirm': return svc.auth.confirmLink(userId, str('identifier'), str('code'), info);
    case 'account.delete':
      await svc.auth.deleteAccount(userId, str('confirm'), info);
      return json({ ok: true }, 200, { 'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
    default: throw new ValidationError('Unknown action.');
  }
});
