import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Sql } from '@kora/db';
import type { OtpSender } from '@kora/adapters';
import { normaliseIdentifier } from './identifier.js';
import { newRecoveryCodes, newTotpSecret, normaliseRecovery, openSecret, otpauthUri, sealSecret, verifyTotp } from './totp.js';
import type { RateLimiter } from './ratelimit.js';

export class AuthError extends Error {
  constructor(public code: 'rate_limited' | 'invalid_code' | 'too_soon' | 'mfa_required', message: string) { super(message); this.name = 'AuthError'; }
}
/** Name-based, because bundlers can load this module twice and break instanceof. */
export const isAuthError = (e: unknown): e is AuthError => e instanceof Error && e.name === 'AuthError';

export interface AuthConfig {
  hmacSecret: string;
  otpTtlMinutes?: number;         // default 10
  maxAttempts?: number;           // wrong guesses per code, default 5
  maxRequestsPer15Min?: number;   // codes per identifier, default 5
  resendCooldownSeconds?: number; // default 30
  sessionTtlDays?: number;        // default 30
  /** Staging demo only: every code is this value. Never set in production with real data. */
  fixedCode?: string;
  /** Optional extra limiter, for example per IP address. Without it only the per-identifier limits apply. */
  limiter?: RateLimiter;
}

/** Where a request came from, kept with the session and the security log. */
export interface RequestInfo { ip?: string | null; userAgent?: string | null }

export type SessionResult = { token: string; userId: string; isNewUser: boolean };
export type SignInStep = ({ needsMfa: false } & SessionResult) | { needsMfa: true; mfaToken: string; userId: string };

const sha256 = (s: string) => createHash('sha256').update(s).digest();
const clip = (s: string | null | undefined, n: number) => (s ? s.slice(0, n) : null);

export function codeHash(secret: string, identifier: string, code: string): Buffer {
  return createHmac('sha256', secret).update(`${identifier}:${code}`).digest();
}

export function createAuth(sql: Sql, sender: OtpSender, cfg: AuthConfig) {
  if (cfg.fixedCode !== undefined && !/^\d{6}$/.test(cfg.fixedCode)) throw new Error('fixedCode must be six digits');
  if (cfg.hmacSecret.length < 32) throw new Error('OTP_HMAC_SECRET must be at least 32 characters');
  const ttl = cfg.otpTtlMinutes ?? 10;
  const maxAttempts = cfg.maxAttempts ?? 5;
  const maxReq = cfg.maxRequestsPer15Min ?? 5;
  const cooldown = cfg.resendCooldownSeconds ?? 30;
  const sessionDays = cfg.sessionTtlDays ?? 30;

  async function logEvent(userId: string, kind: string, info: RequestInfo = {}, detail: Record<string, unknown> = {}) {
    await sql`insert into security_event (user_id, kind, ip, user_agent, detail) values (${userId}, ${kind}, ${clip(info.ip, 64)}, ${clip(info.userAgent, 300)}, ${sql.json(detail as never)})`;
  }

  async function openSession(userId: string, info: RequestInfo, mfa: boolean): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await sql`insert into app_session (user_id, token_hash, expires_at, ip, user_agent, mfa)
              values (${userId}, ${sha256(token)}, now() + ${sessionDays + ' days'}::interval, ${clip(info.ip, 64)}, ${clip(info.userAgent, 300)}, ${mfa})`;
    return token;
  }

  /** Checks and uses one code for an address. Counts the guess first, atomically, against the newest live code. */
  async function consumeCode(id: { value: string; channel: 'sms' | 'email' }, code: string): Promise<void> {
    const bad = () => new AuthError('invalid_code', 'That code is not right or has expired.');
    if (!/^[0-9]{6}$/.test(code)) throw bad();
    const [ch] = await sql`
      update otp_challenge set attempts = attempts + 1
       where id = (select id from otp_challenge
                    where identifier = ${id.value} and consumed_at is null and expires_at > now()
                    order by created_at desc limit 1)
         and attempts < ${maxAttempts}
      returning id, code_hash`;
    if (!ch) throw bad();
    if (!timingSafeEqual(ch.code_hash as Buffer, codeHash(cfg.hmacSecret, id.value, code))) throw bad();
    // Single use: only one concurrent verify can flip consumed_at.
    const [used] = await sql`update otp_challenge set consumed_at = now() where id = ${ch.id} and consumed_at is null returning id`;
    if (!used) throw bad();
  }

  async function sendCode(raw: string, info: RequestInfo): Promise<void> {
    const id = normaliseIdentifier(raw);
    if (cfg.limiter && info.ip) {
      if (!(await cfg.limiter.hit(`otp-ip:${info.ip}`, 20, 900))) throw new AuthError('rate_limited', 'Too many requests from this network. Try again in a few minutes.');
    }
    const [r] = await sql`
      select count(*) filter (where created_at > now() - interval '15 minutes')::int as recent,
             coalesce(extract(epoch from now() - max(created_at)), 1e9)::float as since_last
        from otp_challenge where identifier = ${id.value}`;
    if (r!.recent >= maxReq) throw new AuthError('rate_limited', 'Too many codes requested. Try again in a few minutes.');
    if (r!.since_last < cooldown) throw new AuthError('too_soon', `Wait ${cooldown} seconds before asking for another code.`);
    const code = cfg.fixedCode ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    await sql`insert into otp_challenge (identifier, channel, code_hash, expires_at)
              values (${id.value}, ${id.channel}, ${codeHash(cfg.hmacSecret, id.value, code)},
                      now() + ${ttl + ' minutes'}::interval)`;
    await sender.send({ channel: id.channel, to: id.value, code });
  }

  async function findOrCreateUser(id: { value: string; channel: 'sms' | 'email' }) {
    const col = id.channel === 'sms' ? 'phone' : 'email';
    const [existing] = await sql`select id from app_user where ${sql(col)} = ${id.value}`;
    if (existing) return { userId: existing.id as string, isNewUser: false };
    const [u] = await sql`insert into app_user (${sql(col)}) values (${id.value})
                          on conflict (${sql(col)}) do update set ${sql(col)} = excluded.${sql(col)} returning id`;
    return { userId: u!.id as string, isNewUser: true };
  }

  async function hasMfa(userId: string): Promise<boolean> {
    const [t] = await sql`select 1 from user_totp where user_id = ${userId} and confirmed_at is not null`;
    return !!t;
  }

  /** Uses one authenticator code or one recovery code. A code that was already used is refused. */
  async function checkSecondFactor(userId: string, code: string): Promise<'totp' | 'recovery'> {
    const bad = new AuthError('invalid_code', 'That code is not right.');
    const clean = String(code ?? '').trim();
    if (/^[0-9]{6}$/.test(clean)) {
      const [t] = await sql`select secret_enc, last_step from user_totp where user_id = ${userId} and confirmed_at is not null`;
      if (!t) throw bad;
      const step = verifyTotp(openSecret(t.secret_enc as Buffer, cfg.hmacSecret), clean);
      if (step === null) throw bad;
      const [ok] = await sql`update user_totp set last_step = ${step} where user_id = ${userId} and last_step < ${step} returning user_id`;
      if (!ok) throw bad;
      return 'totp';
    }
    const rec = normaliseRecovery(clean);
    if (rec.length !== 8) throw bad;
    const [r] = await sql`update user_recovery_code set used_at = now() where user_id = ${userId} and code_hash = ${sha256(`recovery:${rec}`)} and used_at is null returning id`;
    if (!r) throw bad;
    return 'recovery';
  }

  return {
    /** Sends a code. The code is never returned to the caller. */
    requestOtp: (raw: string, info: RequestInfo = {}) => sendCode(raw, info),

    /**
     * Checks a code. If the person has an authenticator app set up, no session is opened yet: a short-lived token is returned and
     * completeMfa() finishes the sign-in. Otherwise a session is opened.
     */
    async verifyOtpStep(raw: string, code: string, info: RequestInfo = {}): Promise<SignInStep> {
      const id = normaliseIdentifier(raw);
      await consumeCode(id, code);
      const { userId, isNewUser } = await findOrCreateUser(id);
      if (await hasMfa(userId)) {
        const mfaToken = randomBytes(32).toString('base64url');
        await sql`insert into mfa_challenge (user_id, token_hash, expires_at, ip, user_agent) values (${userId}, ${sha256(mfaToken)}, now() + interval '5 minutes', ${clip(info.ip, 64)}, ${clip(info.userAgent, 300)})`;
        await logEvent(userId, 'login.code_ok_mfa_needed', info);
        return { needsMfa: true, mfaToken, userId };
      }
      const token = await openSession(userId, info, false);
      await logEvent(userId, 'login', info, { newUser: isNewUser });
      return { needsMfa: false, token, userId, isNewUser };
    },

    /** The original one-step sign-in. Refuses people who need the second step, so nobody can skip it by calling this. */
    async verifyOtp(raw: string, code: string, info: RequestInfo = {}): Promise<SessionResult> {
      const s = await this.verifyOtpStep(raw, code, info);
      if (s.needsMfa) throw new AuthError('mfa_required', 'This account needs its authenticator code too.');
      return { token: s.token, userId: s.userId, isNewUser: s.isNewUser };
    },

    /** The second step: the token from verifyOtpStep and an authenticator or recovery code. Five wrong tries end the token. */
    async completeMfa(mfaToken: string, code: string, info: RequestInfo = {}): Promise<SessionResult> {
      const bad = new AuthError('invalid_code', 'That code is not right or has expired. Start again.');
      if (!mfaToken || mfaToken.length > 128) throw bad;
      const [c] = await sql`update mfa_challenge set attempts = attempts + 1
                             where token_hash = ${sha256(mfaToken)} and consumed_at is null and expires_at > now() and attempts < 5 returning id, user_id`;
      if (!c) throw bad;
      const userId = c.user_id as string;
      let how: 'totp' | 'recovery';
      try { how = await checkSecondFactor(userId, code); } catch (e) { await logEvent(userId, 'login.mfa_failed', info); throw e; }
      const [used] = await sql`update mfa_challenge set consumed_at = now() where id = ${c.id} and consumed_at is null returning id`;
      if (!used) throw bad;
      const token = await openSession(userId, info, true);
      await logEvent(userId, 'login', info, { mfa: how });
      return { token, userId, isNewUser: false };
    },

    async getSession(token: string): Promise<{ userId: string } | null> {
      if (!token || token.length > 128) return null;
      const [s] = await sql`select id, user_id, last_seen_at from app_session
                             where token_hash = ${sha256(token)} and revoked_at is null and expires_at > now()`;
      if (!s) return null;
      // Remember when it was last used, but not on every request.
      if (Date.now() - new Date(s.last_seen_at as string).getTime() > 5 * 60_000) await sql`update app_session set last_seen_at = now() where id = ${s.id}`.catch(() => {});
      return { userId: s.user_id as string };
    },

    async revokeSession(token: string): Promise<void> {
      await sql`update app_session set revoked_at = now() where token_hash = ${sha256(token)} and revoked_at is null`;
    },

    // ------------------------------------------------------------ devices
    /** The person's live sessions, newest first, with the one making this request marked. */
    async listSessions(userId: string, currentToken?: string) {
      const cur = currentToken ? sha256(currentToken) : null;
      const rows = await sql`select id, ip, user_agent, created_at, last_seen_at, expires_at, mfa, (token_hash = ${cur}::bytea) as current
                               from app_session where user_id = ${userId} and revoked_at is null and expires_at > now() order by last_seen_at desc`;
      return rows.map((r) => ({ id: r.id as string, ip: r.ip as string | null, userAgent: r.user_agent as string | null, createdAt: r.created_at as string, lastSeenAt: r.last_seen_at as string, mfa: r.mfa as boolean, current: !!r.current }));
    },
    async revokeSessionById(userId: string, sessionId: string, info: RequestInfo = {}): Promise<boolean> {
      const r = await sql`update app_session set revoked_at = now() where id = ${sessionId} and user_id = ${userId} and revoked_at is null returning id`;
      if (r.length) await logEvent(userId, 'session.revoked', info);
      return r.length > 0;
    },
    /** Signs out everywhere except the session making this request. Returns how many were ended. */
    async revokeOtherSessions(userId: string, currentToken: string, info: RequestInfo = {}): Promise<number> {
      const r = await sql`update app_session set revoked_at = now() where user_id = ${userId} and revoked_at is null and token_hash <> ${sha256(currentToken)} returning id`;
      if (r.length) await logEvent(userId, 'session.revoked_others', info, { count: r.length });
      return r.length;
    },

    async securityEvents(userId: string, limit = 50) {
      const rows = await sql`select id, kind, ip, user_agent, detail, created_at from security_event where user_id = ${userId} order by created_at desc limit ${Math.min(200, Math.max(1, limit))}`;
      return rows.map((r) => ({ id: r.id as string, kind: r.kind as string, ip: r.ip as string | null, userAgent: r.user_agent as string | null, detail: r.detail as Record<string, unknown>, at: r.created_at as string }));
    },

    // ------------------------------------------------------------ authenticator app
    async mfaStatus(userId: string) {
      const [t] = await sql`select confirmed_at from user_totp where user_id = ${userId}`;
      const [n] = await sql`select count(*)::int as n from user_recovery_code where user_id = ${userId} and used_at is null`;
      return { enabled: !!t?.confirmed_at, pending: !!t && !t.confirmed_at, recoveryCodesLeft: n!.n as number };
    },
    /** Starts setting up. Shows the secret once; it is not active until a code from the app is confirmed. */
    async mfaBegin(userId: string, account: string): Promise<{ secret: string; uri: string }> {
      if (await hasMfa(userId)) throw new AuthError('invalid_code', 'An authenticator app is already set up. Turn it off first to set up another.');
      const secret = newTotpSecret();
      await sql`insert into user_totp (user_id, secret_enc) values (${userId}, ${sealSecret(secret, cfg.hmacSecret)})
                on conflict (user_id) do update set secret_enc = excluded.secret_enc, confirmed_at = null, last_step = 0`;
      return { secret, uri: otpauthUri(secret, account) };
    },
    /** Turns it on after a first good code, and returns ten recovery codes. They are shown only this once. */
    async mfaConfirm(userId: string, code: string, info: RequestInfo = {}): Promise<{ recoveryCodes: string[] }> {
      const bad = new AuthError('invalid_code', 'That code is not right. Check the time on your phone and try again.');
      const [t] = await sql`select secret_enc from user_totp where user_id = ${userId} and confirmed_at is null`;
      if (!t) throw bad;
      const step = verifyTotp(openSecret(t.secret_enc as Buffer, cfg.hmacSecret), String(code ?? '').trim());
      if (step === null) throw bad;
      const codes = newRecoveryCodes();
      await sql.begin(async (tx) => {
        await tx`update user_totp set confirmed_at = now(), last_step = ${step} where user_id = ${userId}`;
        await tx`delete from user_recovery_code where user_id = ${userId}`;
        for (const c of codes) await tx`insert into user_recovery_code (user_id, code_hash) values (${userId}, ${sha256(`recovery:${normaliseRecovery(c)}`)})`;
      });
      await logEvent(userId, 'mfa.enabled', info);
      return { recoveryCodes: codes };
    },
    /** Turns it off. Needs a current code, so someone who finds a signed-in laptop cannot quietly remove it. */
    async mfaDisable(userId: string, code: string, info: RequestInfo = {}): Promise<void> {
      await checkSecondFactor(userId, code);
      await sql`delete from user_totp where user_id = ${userId}`;
      await sql`delete from user_recovery_code where user_id = ${userId}`;
      await logEvent(userId, 'mfa.disabled', info);
    },

    // ------------------------------------------------------------ closing the account
    /**
     * Closes the person's own account: signs them out everywhere, removes their sign-in details, authenticator and security log, and
     * takes them out of every business. Records they created keep their id (the law requires invoices and the audit log to stay),
     * but no longer lead to a name, number or email. Refused while they are the only owner of a business: that business has to be
     * handed to someone else first, or its data exported and the business closed, so it is never left without an owner.
     */
    async deleteAccount(userId: string, confirm: string, info: RequestInfo = {}): Promise<void> {
      if (confirm !== 'DELETE') throw new AuthError('invalid_code', 'Type DELETE to confirm.');
      const [r] = await sql`select close_account(${userId}) as blocking`;
      const blocking = r!.blocking as string[] | null;
      if (blocking === null) throw new AuthError('invalid_code', 'This account is already closed.');
      if (blocking.length) throw new AuthError('invalid_code', `You are the only owner of ${blocking.join(', ')}. Make someone else an owner first.`);
      void info;
    },

    // ------------------------------------------------------------ changing the number or email
    /** Sends a code to a new address. It becomes the person's own address only once the code is confirmed. */
    async requestLink(userId: string, raw: string, info: RequestInfo = {}): Promise<void> {
      const id = normaliseIdentifier(raw);
      const col = id.channel === 'sms' ? 'phone' : 'email';
      const [taken] = await sql`select id from app_user where ${sql(col)} = ${id.value}`;
      if (taken && taken.id !== userId) throw new AuthError('invalid_code', 'That number or email already belongs to another account.');
      await sendCode(raw, info);
    },
    async confirmLink(userId: string, raw: string, code: string, info: RequestInfo = {}): Promise<{ channel: 'sms' | 'email'; value: string }> {
      const id = normaliseIdentifier(raw);
      await consumeCode(id, code);
      const col = id.channel === 'sms' ? 'phone' : 'email';
      try {
        await sql`update app_user set ${sql(col)} = ${id.value} where id = ${userId}`;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new AuthError('invalid_code', 'That number or email already belongs to another account.');
        throw e;
      }
      await logEvent(userId, 'identifier.linked', info, { channel: id.channel });
      return id;
    },
  };
}
export type Auth = ReturnType<typeof createAuth>;
