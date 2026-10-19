import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { createMockOtpSender } from '@kora/adapters';
import {
  base32Decode, base32Encode, createAuth, isAuthError, newRecoveryCodes, normaliseRecovery, openSecret, pgRateLimiter, sealSecret, totpAt, totpStep, upstashRateLimiter, verifyTotp,
} from '../src/index.js';

const SECRET = 'test-secret-test-secret-test-secret-1234';
let db: TestDb;
const sender = createMockOtpSender(() => {});
const last = () => sender.outbox[sender.outbox.length - 1]!.code;
let auth: ReturnType<typeof createAuth>;
const mk = () => createAuth(db.web, sender, { hmacSecret: SECRET, resendCooldownSeconds: 0, maxRequestsPer15Min: 100 });

beforeAll(async () => { db = await makeTestDb(); auth = mk(); }, 60_000);
afterAll(async () => { await db?.drop(); });

describe('authenticator codes (RFC 6238)', () => {
  const rfc = base32Encode(Buffer.from('12345678901234567890'));
  it('matches the published test vectors', () => {
    expect(totpAt(rfc, 59 / 30 | 0, 8)).toBe('94287082');
    expect(totpAt(rfc, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(totpAt(rfc, Math.floor(20000000000 / 30), 8)).toBe('65353130');
  });
  it('accepts one step either side and no more, and refuses malformed codes', () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    expect(verifyTotp(rfc, totpAt(rfc, step), now)).toBe(step);
    expect(verifyTotp(rfc, totpAt(rfc, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(rfc, totpAt(rfc, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(rfc, totpAt(rfc, step + 2), now)).toBeNull();
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 3456']) expect(verifyTotp(rfc, bad, now)).toBeNull();
  });
  it('round-trips base32 and encrypts secrets so they cannot be read from a dump', () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
    const sealed = sealSecret('JBSWY3DPEHPK3PXP', SECRET);
    expect(sealed.toString('latin1')).not.toContain('JBSWY3DPEHPK3PXP');
    expect(openSecret(sealed, SECRET)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => openSecret(sealed, 'another-secret-another-secret-another-12')).toThrow();
    const tampered = Buffer.from(sealed); tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
    expect(() => openSecret(tampered, SECRET)).toThrow();
  });
  it('makes ten distinct recovery codes', () => {
    const c = newRecoveryCodes();
    expect(new Set(c).size).toBe(10);
    for (const x of c) expect(x).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(normaliseRecovery(' ab12-cd34 ')).toBe('AB12CD34');
  });
});

describe('signing in with an authenticator app', () => {
  const email = 'mfa.user@example.test';
  let userId = '', secret = '', recovery: string[] = [];
  const signIn = async (info = { ip: '203.0.113.5', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36' }) => {
    await auth.requestOtp(email);
    return auth.verifyOtpStep(email, last(), info);
  };

  it('is off until set up: a plain sign-in opens a session and is logged', async () => {
    const s = await signIn();
    expect(s.needsMfa).toBe(false);
    if (s.needsMfa) return;
    userId = s.userId;
    expect(await auth.getSession(s.token)).toEqual({ userId });
    expect((await auth.listSessions(userId, s.token))[0]).toMatchObject({ current: true, ip: '203.0.113.5', mfa: false });
    expect((await auth.securityEvents(userId))[0]).toMatchObject({ kind: 'login' });
    expect(await auth.mfaStatus(userId)).toEqual({ enabled: false, pending: false, recoveryCodesLeft: 0 });
  });

  it('turns on only after a correct first code, and shows recovery codes once', async () => {
    const b = await auth.mfaBegin(userId, email);
    secret = b.secret;
    expect(b.uri).toContain(`secret=${secret}`);
    expect(await auth.mfaStatus(userId)).toMatchObject({ enabled: false, pending: true });
    await expect(auth.mfaConfirm(userId, '000000')).rejects.toThrow(/not right/);
    const r = await auth.mfaConfirm(userId, totpAt(secret, totpStep()));
    recovery = r.recoveryCodes;
    expect(recovery).toHaveLength(10);
    expect(await auth.mfaStatus(userId)).toEqual({ enabled: true, pending: false, recoveryCodesLeft: 10 });
    await expect(auth.mfaBegin(userId, email)).rejects.toThrow(/already set up/);
    // the stored secret is sealed, and recovery codes are stored only as hashes
    const [row] = await db.owner`select secret_enc from user_totp where user_id = ${userId}`;
    expect((row!.secret_enc as Buffer).toString('latin1')).not.toContain(secret);
    const hashes = await db.owner`select code_hash from user_recovery_code where user_id = ${userId}`;
    expect(hashes).toHaveLength(10);
  });

  it('no longer gives a session after the first code alone, and the one-step call refuses', async () => {
    await auth.requestOtp(email);
    const code = last();
    const s = await auth.verifyOtpStep(email, code);
    expect(s.needsMfa).toBe(true);
    await auth.requestOtp(email);
    await expect(auth.verifyOtp(email, last())).rejects.toSatisfy((e) => isAuthError(e) && e.code === 'mfa_required');
  });

  it('finishes with an authenticator code, once only per time step', async () => {
    await auth.requestOtp(email);
    const s = await auth.verifyOtpStep(email, last());
    if (!s.needsMfa) throw new Error('expected the second step');
    await expect(auth.completeMfa(s.mfaToken, '123456')).rejects.toThrow(/not right/);
    // use a code from the next step, which the window allows and the confirm step has not used
    const step = totpStep() + 1;
    const done = await auth.completeMfa(s.mfaToken, totpAt(secret, step), { ip: '198.51.100.7', userAgent: 'x' });
    expect(await auth.getSession(done.token)).toEqual({ userId });
    expect((await auth.listSessions(userId, done.token))[0]).toMatchObject({ mfa: true, current: true });
    await expect(auth.completeMfa(s.mfaToken, totpAt(secret, step))).rejects.toThrow();   // the token is spent
    // the same authenticator code cannot start a second sign-in
    await auth.requestOtp(email);
    const s2 = await auth.verifyOtpStep(email, last());
    if (!s2.needsMfa) throw new Error('expected the second step');
    await expect(auth.completeMfa(s2.mfaToken, totpAt(secret, step))).rejects.toThrow(/not right/);
  });

  it('ends the token after five wrong tries, even if the sixth is right', async () => {
    await auth.requestOtp(email);
    const s = await auth.verifyOtpStep(email, last());
    if (!s.needsMfa) throw new Error('expected the second step');
    for (let i = 0; i < 5; i++) await expect(auth.completeMfa(s.mfaToken, '000000')).rejects.toThrow();
    await expect(auth.completeMfa(s.mfaToken, totpAt(secret, totpStep() + 1))).rejects.toThrow(/Start again/);
    expect((await auth.securityEvents(userId)).some((e) => e.kind === 'login.mfa_failed')).toBe(true);
  });

  it('accepts a recovery code once', async () => {
    await auth.requestOtp(email);
    const s = await auth.verifyOtpStep(email, last());
    if (!s.needsMfa) throw new Error('expected the second step');
    const done = await auth.completeMfa(s.mfaToken, recovery[0]!.toLowerCase());
    expect(done.token).toBeTruthy();
    expect((await auth.mfaStatus(userId)).recoveryCodesLeft).toBe(9);
    await auth.requestOtp(email);
    const s2 = await auth.verifyOtpStep(email, last());
    if (!s2.needsMfa) throw new Error('expected the second step');
    await expect(auth.completeMfa(s2.mfaToken, recovery[0]!)).rejects.toThrow(/not right/);
  });

  it('lists and ends sessions, and signs out everywhere else', async () => {
    await auth.requestOtp(email);
    const s = await auth.verifyOtpStep(email, last());
    if (!s.needsMfa) throw new Error('expected the second step');
    const keep = await auth.completeMfa(s.mfaToken, recovery[1]!);
    const all = await auth.listSessions(userId, keep.token);
    expect(all.length).toBeGreaterThan(2);
    expect(all.filter((x) => x.current)).toHaveLength(1);
    const other = all.find((x) => !x.current)!;
    expect(await auth.revokeSessionById(userId, other.id)).toBe(true);
    expect(await auth.revokeSessionById(userId, other.id)).toBe(false);
    const n = await auth.revokeOtherSessions(userId, keep.token);
    expect(n).toBe(all.length - 2);
    expect(await auth.listSessions(userId, keep.token)).toHaveLength(1);
    expect(await auth.getSession(keep.token)).toEqual({ userId });
  });

  it('cannot end someone else\'s session', async () => {
    const mine = (await auth.listSessions(userId))[0]!;
    await auth.requestOtp('someone.else@example.test');
    const o = await auth.verifyOtp('someone.else@example.test', last());
    expect(await auth.revokeSessionById(o.userId, mine.id)).toBe(false);
  });

  it('turns off only with a current code, and then signs in in one step again', async () => {
    await expect(auth.mfaDisable(userId, '000000')).rejects.toThrow();
    await auth.mfaDisable(userId, recovery[2]!);
    expect(await auth.mfaStatus(userId)).toEqual({ enabled: false, pending: false, recoveryCodesLeft: 0 });
    expect((await signIn()).needsMfa).toBe(false);
    expect((await auth.securityEvents(userId)).map((e) => e.kind)).toEqual(expect.arrayContaining(['mfa.enabled', 'mfa.disabled']));
  });
});

describe('adding a number or email', () => {
  it('needs a code sent to the new address, and refuses an address that belongs to someone else', async () => {
    await auth.requestOtp('owner.one@example.test');
    const a = await auth.verifyOtp('owner.one@example.test', last());
    await auth.requestOtp('owner.two@example.test');
    await auth.verifyOtp('owner.two@example.test', last());
    await expect(auth.requestLink(a.userId, 'owner.two@example.test')).rejects.toThrow(/belongs to another account/);

    await auth.requestLink(a.userId, '9876501234');
    await expect(auth.confirmLink(a.userId, '9876501234', '000000')).rejects.toThrow(/not right/);
    await auth.requestLink(a.userId, '9876501234');
    expect(await auth.confirmLink(a.userId, '9876501234', last())).toMatchObject({ channel: 'sms' });
    // signing in with the new number now reaches the same account
    await auth.requestOtp('9876501234');
    expect((await auth.verifyOtp('9876501234', last())).userId).toBe(a.userId);
    expect((await auth.securityEvents(a.userId)).some((e) => e.kind === 'identifier.linked')).toBe(true);
  });
});

describe('request limits', () => {
  it('counts per key in Postgres, and keys are independent', async () => {
    const l = pgRateLimiter(db.web);
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) results.push(await l.hit('test:a', 3, 60));
    expect(results).toEqual([true, true, true, false, false]);
    expect(await l.hit('test:b', 3, 60)).toBe(true);
  });
  it('limits sign-in codes per address when a limiter is given', async () => {
    const auth = createAuth(db.web, sender, { hmacSecret: SECRET, resendCooldownSeconds: 0, maxRequestsPer15Min: 100, limiter: pgRateLimiter(db.web) });
    let blocked = 0;
    for (let i = 0; i < 24; i++) { try { await auth.requestOtp(`limit${i}@example.test`, { ip: '192.0.2.99' }); } catch (e) { if (isAuthError(e) && e.code === 'rate_limited') blocked++; else throw e; } }
    expect(blocked).toBe(4);
    await expect(auth.requestOtp('other@example.test', { ip: '192.0.2.100' })).resolves.toBeUndefined();
  });
  it('speaks Upstash REST: counts with INCR and EXPIRE, and fails closed on an error response', async () => {
    const calls: { url: string; body: string; auth: string }[] = [];
    let n = 0;
    const fakeFetch = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
      calls.push({ url, body: init.body, auth: init.headers.authorization! });
      n++;
      return { ok: true, status: 200, json: async () => [{ result: n }, { result: 1 }] };
    }) as unknown as typeof fetch;
    const l = upstashRateLimiter('https://example.upstash.io/', 'tok', fakeFetch);
    expect(await l.hit('k', 2, 60)).toBe(true);
    expect(await l.hit('k', 2, 60)).toBe(true);
    expect(await l.hit('k', 2, 60)).toBe(false);
    expect(calls[0]).toMatchObject({ url: 'https://example.upstash.io/pipeline', auth: 'Bearer tok' });
    expect(JSON.parse(calls[0]!.body)).toEqual([['INCR', expect.stringMatching(/^rl:k:\d+$/)], ['EXPIRE', expect.stringMatching(/^rl:k:\d+$/), '65']]);
    const broken = upstashRateLimiter('https://x', 't', (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch);
    await expect(broken.hit('k', 1, 1)).rejects.toThrow(/500/);
  });
});
