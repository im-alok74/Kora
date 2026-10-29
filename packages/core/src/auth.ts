import { createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Sql } from '@kora/db';
import type { OtpSender } from '@kora/adapters';
import { normaliseIdentifier } from './identifier.js';
import { newRecoveryCodes, newTotpSecret, normaliseRecovery, openSecret, otpauthUri, sealSecret, verifyTotp } from './totp.js';
import type { RateLimiter } from './ratelimit.js';

export class AuthError extends Error {
  constructor(public code: 'rate_limited' | 'invalid_code' | 'too_soon' | 'mfa_required' | 'bad_credentials' | 'weak_password' | 'exists' | 'locked', message: string) { super(message); this.name = 'AuthError'; }
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

export const ACCOUNT_TYPES = ['business', 'ca', 'lawyer', 'freelancer'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** scrypt with a random salt, stored as scrypt$salt$hash (both base64url). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64url')}$${scryptSync(password, salt, 64).toString('base64url')}`;
}
export function checkPassword(password: string, stored: string): boolean {
  const [alg, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64url');
  const got = scryptSync(password, Buffer.from(salt, 'base64url'), want.length);
  return want.length === got.length && timingSafeEqual(want, got);
}
const DUMMY_HASH = hashPassword('not-a-real-password');   // so a wrong address costs the same time as a wrong password

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

  /**
   * A code sent to the address proves the person owns it. If the account was made with a password and no proof, whoever set that
   * password may not be the owner, so the password is removed and every session is ended.
   */
  async function clearUnverifiedPassword(userId: string, info: RequestInfo) {
    const [u] = await sql`update app_user set password_hash = null, unverified_signup = false, failed_logins = 0, locked_until = null
                           where id = ${userId} and unverified_signup returning id`;
    if (!u) return;
    await sql`update app_session set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
    await logEvent(userId, 'password.removed_after_code_login', info);
  }

  async function ipLimit(info: RequestInfo, what: string, max: number) {
    if (cfg.limiter && info.ip && !(await cfg.limiter.hit(`${what}:${info.ip}`, max, 900))) throw new AuthError('rate_limited', 'Too many attempts from this network. Try again in a few minutes.');
  }

  async function afterPasswordOk(userId: string, info: RequestInfo, isNewUser: boolean): Promise<SignInStep> {
    if (await hasMfa(userId)) {
      const mfaToken = randomBytes(32).toString('base64url');
      await sql`insert into mfa_challenge (user_id, token_hash, expires_at, ip, user_agent) values (${userId}, ${sha256(mfaToken)}, now() + interval '5 minutes', ${clip(info.ip, 64)}, ${clip(info.userAgent, 300)})`;
      await logEvent(userId, 'login.password_ok_mfa_needed', info);
      return { needsMfa: true, mfaToken, userId };
    }
    const token = await openSession(userId, info, false);
    await logEvent(userId, 'login', info, { how: 'password', newUser: isNewUser });
    return { needsMfa: false, token, userId, isNewUser };
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
      await clearUnverifiedPassword(userId, info);
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

    /**
     * Makes an account from an email or mobile number and a password. Nothing is sent to confirm the address, so the account is marked
     * unverified: a later sign-in by code, which does prove the address, replaces the password (see clearUnverifiedPassword).
     */
    async signUp(i: { identifier: string; password: string; name: string; accountType?: string }, info: RequestInfo = {}): Promise<SignInStep> {
      await ipLimit(info, 'signup-ip', 10);
      const id = normaliseIdentifier(i.identifier);
      // Five tries for one address in 15 minutes, from anywhere, so one account cannot be probed or hammered from many networks.
      if (cfg.limiter && !(await cfg.limiter.hit(`signup-id:${id.value}`, 5, 900))) throw new AuthError('rate_limited', 'Too many attempts for this number or email. Try again in a few minutes.');
      const password = String(i.password ?? '');
      if (password.length < 8) throw new AuthError('weak_password', 'Use a password of at least 8 characters.');
      if (password.length > 128) throw new AuthError('weak_password', 'That password is too long. Use 128 characters or fewer.');
      const name = String(i.name ?? '').trim();
      if (name.length < 1 || name.length > 80) throw new AuthError('weak_password', 'Enter your name.');
      const accountType = (i.accountType ?? 'business') as AccountType;
      if (!ACCOUNT_TYPES.includes(accountType)) throw new AuthError('weak_password', 'Choose what kind of account this is.');
      const col = id.channel === 'sms' ? 'phone' : 'email';
      const [u] = await sql`insert into app_user (${sql(col)}, display_name, password_hash, account_type, unverified_signup)
                            values (${id.value}, ${name}, ${hashPassword(password)}, ${accountType}, true)
                            on conflict (${sql(col)}) do nothing returning id`;
      if (!u) throw new AuthError('exists', 'An account with this number or email already exists. Sign in instead.');
      return afterPasswordOk(u.id as string, info, true);
    },

    /** Signs in with a password. The same message for a wrong address and a wrong password; five misses lock the account for 15 minutes. */
    async signInPassword(raw: string, password: string, info: RequestInfo = {}): Promise<SignInStep> {
      await ipLimit(info, 'login-ip', 30);
      const bad = () => new AuthError('bad_credentials', 'That address or password is not right.');
      const id = normaliseIdentifier(raw);
      const col = id.channel === 'sms' ? 'phone' : 'email';
      const [u] = await sql`select id, password_hash, locked_until from app_user where ${sql(col)} = ${id.value}`;
      const pw = String(password ?? '').slice(0, 128);
      if (!u || !u.password_hash) { checkPassword(pw, DUMMY_HASH); throw bad(); }
      if (u.locked_until && new Date(u.locked_until as string) > new Date()) throw new AuthError('locked', 'Too many wrong passwords. Try again in 15 minutes, or sign in with a code.');
      if (!checkPassword(pw, u.password_hash as string)) {
        await sql`update app_user set
                    locked_until = case when failed_logins + 1 >= 5 then now() + interval '15 minutes' else locked_until end,
                    failed_logins = case when failed_logins + 1 >= 5 then 0 else failed_logins + 1 end
                  where id = ${u.id}`;
        await logEvent(u.id as string, 'login.password_failed', info);
        throw bad();
      }
      await sql`update app_user set failed_logins = 0, locked_until = null where id = ${u.id}`;
      return afterPasswordOk(u.id as string, info, false);
    },

    /** What kind of account this person chose, to decide where they land. */
    async accountType(userId: string): Promise<AccountType> {
      const [u] = await sql`select account_type from app_user where id = ${userId}`;
      return ((u?.account_type as AccountType | undefined) ?? 'business');
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

    /** True when this sign-in went through the authenticator code step. The admin panel requires it. */
    async sessionHasMfa(token: string): Promise<boolean> {
      if (!token || token.length > 128) return false;
      const [s] = await sql`select mfa from app_session where token_hash = ${sha256(token)} and revoked_at is null and expires_at > now()`;
      return !!s?.mfa;
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
