import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockOtpSender, otpSenderFromEnv } from '@kora/adapters';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  AuthError, isAuthError, isForbidden, can, createAuth, createBusiness, addMember, inTenant, listBusinesses, normaliseIdentifier,
  resolveTenant, ForbiddenError, type Role,
} from '../src/index.js';

const SECRET = 'test-secret-test-secret-test-secret-123';
let db: TestDb;
const sender = createMockOtpSender(() => {});
const mk = (over = {}) => createAuth(db.web, sender, { hmacSecret: SECRET, resendCooldownSeconds: 0, ...over });
const lastCode = (to: string) => [...sender.outbox].reverse().find((m) => m.to === to)!.code;

beforeAll(async () => { db = await makeTestDb(); }, 60_000);
afterAll(async () => { await db?.drop(); });

describe('identifier', () => {
  it.each([
    ['98765 43210', '+919876543210'], ['+91 98765-43210', '+919876543210'], ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
  ])('normalises phone %s', (raw, want) => expect(normaliseIdentifier(raw)).toEqual({ channel: 'sms', value: want }));
  it('lowercases email', () => expect(normaliseIdentifier(' A@B.com ')).toEqual({ channel: 'email', value: 'a@b.com' }));
  it.each(['12345', '5876543210', '+14155550123', 'not an id', 'a@b'])('rejects %s', (raw) =>
    expect(() => normaliseIdentifier(raw)).toThrow());
});

describe('permissions', () => {
  const roles: Role[] = ['owner', 'staff', 'accountant'];
  it('accountant can read and export but never write', () => {
    expect(can('accountant', 'report.export')).toBe(true);
    for (const a of ['document.write', 'document.issue', 'party.write', 'payment.write', 'settings.write', 'member.manage'] as const)
      expect(can('accountant', a)).toBe(false);
  });
  it('staff cannot manage members, settings or billing', () => {
    for (const a of ['member.manage', 'settings.write', 'billing.manage', 'document.cancel'] as const)
      expect(can('staff', a)).toBe(false);
  });
  it('owner can do everything staff can', () => {
    expect(roles.length).toBe(3);
    for (const a of ['document.issue', 'payment.write', 'einvoice.submit'] as const) expect(can('owner', a)).toBe(true);
  });
});

describe('error identity', () => {
  it('is recognised by name, so a second bundled copy of the module still matches', () => {
    const fake = Object.assign(new Error('x'), { name: 'AuthError' });
    expect(isAuthError(fake)).toBe(true);
    expect(isAuthError(new Error('x'))).toBe(false);
    expect(isForbidden(new ForbiddenError('document.read'))).toBe(true);
  });
});

describe('otp sender', () => {
  it('refuses the mock in production and unknown providers', () => {
    expect(() => otpSenderFromEnv({ OTP_PROVIDER: 'mock', NODE_ENV: 'production' })).toThrow(/production/);
    expect(() => otpSenderFromEnv({ OTP_PROVIDER: 'acme' })).toThrow(/Unknown/);
  });
});

describe('otp login', () => {
  it('request then verify opens a session; the code is not stored in clear', async () => {
    const auth = mk();
    await auth.requestOtp('9876543210');
    const code = lastCode('+919876543210');
    const rows = await db.owner`select code_hash from otp_challenge where identifier = '+919876543210'`;
    expect(Buffer.from(rows[0]!.code_hash).toString('utf8')).not.toContain(code);
    const s = await auth.verifyOtp('9876543210', code);
    expect(s.isNewUser).toBe(true);
    expect(await auth.getSession(s.token)).toEqual({ userId: s.userId });
    await auth.revokeSession(s.token);
    expect(await auth.getSession(s.token)).toBeNull();
  });
  it('a fixed demo code signs in any number or email, and a wrong code still fails', async () => {
    const auth = mk({ fixedCode: '123456' });
    await auth.requestOtp('9811122233');
    await expect(auth.verifyOtp('9811122233', '654321')).rejects.toMatchObject({ name: 'AuthError' });
    expect((await auth.verifyOtp('9811122233', '123456')).isNewUser).toBe(true);
    await auth.requestOtp('Demo.User@Example.com');
    expect((await auth.verifyOtp('demo.user@example.com', '123456')).isNewUser).toBe(true);
  });
  it('the same person logging in again gets the same user', async () => {
    const auth = mk();
    await auth.requestOtp('+91 98765 43210');
    const s = await auth.verifyOtp('9876543210', lastCode('+919876543210'));
    expect(s.isNewUser).toBe(false);
  });
  it('a wrong code fails, and after 5 wrong guesses even the right code is refused', async () => {
    const auth = mk();
    await auth.requestOtp('a@example.test');
    const good = lastCode('a@example.test');
    const wrong = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await expect(auth.verifyOtp('a@example.test', wrong)).rejects.toBeInstanceOf(AuthError);
    await expect(auth.verifyOtp('a@example.test', good)).rejects.toBeInstanceOf(AuthError);
  });
  it('a code works once, even when two requests race', async () => {
    const auth = mk();
    await auth.requestOtp('race@example.test');
    const code = lastCode('race@example.test');
    const results = await Promise.allSettled([1, 2, 3, 4].map(() => auth.verifyOtp('race@example.test', code)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('an expired code is refused', async () => {
    const auth = mk();
    await auth.requestOtp('exp@example.test');
    const code = lastCode('exp@example.test');
    await db.owner`update otp_challenge set expires_at = now() - interval '1 second' where identifier = 'exp@example.test'`;
    await expect(auth.verifyOtp('exp@example.test', code)).rejects.toBeInstanceOf(AuthError);
  });
  it('limits how many codes can be requested, and how fast', async () => {
    const limited = mk({ maxRequestsPer15Min: 2 });
    await limited.requestOtp('rl@example.test');
    await limited.requestOtp('rl@example.test');
    await expect(limited.requestOtp('rl@example.test')).rejects.toMatchObject({ code: 'rate_limited' });
    const slow = mk({ resendCooldownSeconds: 60 });
    await slow.requestOtp('cd@example.test');
    await expect(slow.requestOtp('cd@example.test')).rejects.toMatchObject({ code: 'too_soon' });
  });
  it('rejects malformed codes and an expired session', async () => {
    const auth = mk({ sessionTtlDays: 1 });
    await expect(auth.verifyOtp('x@example.test', 'abc123')).rejects.toBeInstanceOf(AuthError);
    await auth.requestOtp('sess@example.test');
    const s = await auth.verifyOtp('sess@example.test', lastCode('sess@example.test'));
    await db.owner`update app_session set expires_at = now() - interval '1 minute' where user_id = ${s.userId}`;
    expect(await auth.getSession(s.token)).toBeNull();
    expect(await auth.getSession('not-a-token')).toBeNull();
  });
});

describe('tenancy and roles end to end', () => {
  let owner: string, accountant: string, outsider: string, bid: string;
  beforeAll(async () => {
    const auth = mk();
    const login = async (e: string) => { await auth.requestOtp(e); return (await auth.verifyOtp(e, lastCode(e))).userId; };
    owner = await login('own@example.test'); accountant = await login('acc@example.test'); outsider = await login('out@example.test');
    bid = await createBusiness(db.web, owner, { legalName: 'Acme Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
    await addMember(db.web, owner, bid, accountant, 'accountant');
  });
  it('lists only the user\'s own businesses', async () => {
    expect(await listBusinesses(db.web, owner)).toMatchObject([{ legalName: 'Acme Traders', role: 'owner' }]);
    expect(await listBusinesses(db.web, accountant)).toMatchObject([{ role: 'accountant' }]);
    expect(await listBusinesses(db.web, outsider)).toEqual([]);
  });
  it('a non-member cannot enter the tenant', async () => {
    await expect(resolveTenant(db.web, outsider, bid)).rejects.toBeInstanceOf(ForbiddenError);
  });
  it('an accountant can read but cannot write', async () => {
    const t = await resolveTenant(db.web, accountant, bid);
    await expect(inTenant(db.web, t, 'party.read', (tx) => tx`select * from party`)).resolves.toEqual([]);
    expect(() => inTenant(db.web, t, 'party.write', async () => 1)).toThrow(ForbiddenError);
  });
  it('an owner can write, and the write is audited against them', async () => {
    const t = await resolveTenant(db.web, owner, bid);
    await inTenant(db.web, t, 'party.write', (tx) =>
      tx`insert into party (business_id, kind, name, state_code) values (${bid}, 'customer', 'Buyer', '27')`);
    const a = await db.owner`select actor_id from audit_log where table_name = 'party' and business_id = ${bid}`;
    expect(a[0]!.actor_id).toBe(owner);
  });
});
