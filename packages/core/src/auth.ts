import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Sql } from '@kora/db';
import type { OtpSender } from '@kora/adapters';
import { normaliseIdentifier } from './identifier.js';

export class AuthError extends Error {
  constructor(public code: 'rate_limited' | 'invalid_code' | 'too_soon', message: string) { super(message); this.name = 'AuthError'; }
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
}

const sha256 = (s: string) => createHash('sha256').update(s).digest();

export function codeHash(secret: string, identifier: string, code: string): Buffer {
  return createHmac('sha256', secret).update(`${identifier}:${code}`).digest();
}

export function createAuth(sql: Sql, sender: OtpSender, cfg: AuthConfig) {
  if (cfg.hmacSecret.length < 32) throw new Error('OTP_HMAC_SECRET must be at least 32 characters');
  const ttl = cfg.otpTtlMinutes ?? 10;
  const maxAttempts = cfg.maxAttempts ?? 5;
  const maxReq = cfg.maxRequestsPer15Min ?? 5;
  const cooldown = cfg.resendCooldownSeconds ?? 30;
  const sessionDays = cfg.sessionTtlDays ?? 30;

  return {
    /** Sends a code. The code is never returned to the caller. */
    async requestOtp(raw: string): Promise<void> {
      const id = normaliseIdentifier(raw);
      const [r] = await sql`
        select count(*) filter (where created_at > now() - interval '15 minutes')::int as recent,
               coalesce(extract(epoch from now() - max(created_at)), 1e9)::float as since_last
          from otp_challenge where identifier = ${id.value}`;
      if (r!.recent >= maxReq) throw new AuthError('rate_limited', 'Too many codes requested. Try again in a few minutes.');
      if (r!.since_last < cooldown) throw new AuthError('too_soon', `Wait ${cooldown} seconds before asking for another code.`);
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await sql`insert into otp_challenge (identifier, channel, code_hash, expires_at)
                values (${id.value}, ${id.channel}, ${codeHash(cfg.hmacSecret, id.value, code)},
                        now() + ${ttl + ' minutes'}::interval)`;
      await sender.send({ channel: id.channel, to: id.value, code });
    },

    /** Checks a code and opens a session. A code works once, and only a few wrong guesses are allowed. */
    async verifyOtp(raw: string, code: string): Promise<{ token: string; userId: string; isNewUser: boolean }> {
      const id = normaliseIdentifier(raw);
      const bad = () => new AuthError('invalid_code', 'That code is not right or has expired.');
      if (!/^[0-9]{6}$/.test(code)) throw bad();
      // Count this guess first, atomically, against the newest live code.
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

      const col = id.channel === 'sms' ? 'phone' : 'email';
      const [existing] = await sql`select id from app_user where ${sql(col)} = ${id.value}`;
      let userId = existing?.id as string | undefined;
      let isNewUser = false;
      if (!userId) {
        const [u] = await sql`insert into app_user (${sql(col)}) values (${id.value})
                              on conflict (${sql(col)}) do update set ${sql(col)} = excluded.${sql(col)} returning id`;
        userId = u!.id as string;
        isNewUser = true;
      }
      const token = randomBytes(32).toString('base64url');
      await sql`insert into app_session (user_id, token_hash, expires_at)
                values (${userId}, ${sha256(token)}, now() + ${sessionDays + ' days'}::interval)`;
      return { token, userId, isNewUser };
    },

    async getSession(token: string): Promise<{ userId: string } | null> {
      if (!token || token.length > 128) return null;
      const [s] = await sql`select user_id from app_session
                             where token_hash = ${sha256(token)} and revoked_at is null and expires_at > now()`;
      return s ? { userId: s.user_id as string } : null;
    },

    async revokeSession(token: string): Promise<void> {
      await sql`update app_session set revoked_at = now() where token_hash = ${sha256(token)} and revoked_at is null`;
    },
  };
}
export type Auth = ReturnType<typeof createAuth>;
