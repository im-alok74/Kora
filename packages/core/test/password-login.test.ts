import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import { createMockOtpSender } from '@kora/adapters';
import { checkPassword, createAuth, hashPassword, isAuthError } from '../src/index.js';

const SECRET = 'test-secret-test-secret-test-secret-1234';
let db: TestDb;
const sender = createMockOtpSender(() => {});
let auth: ReturnType<typeof createAuth>;

beforeAll(async () => { db = await makeTestDb(); auth = createAuth(db.web, sender, { hmacSecret: SECRET, resendCooldownSeconds: 0, maxRequestsPer15Min: 100 }); }, 60_000);
afterAll(async () => { await db?.drop(); });

const code = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return isAuthError(e) ? e.code : (e as Error).message; } };

describe('passwords', () => {
  it('hash with a random salt and check back', () => {
    const h = hashPassword('correct horse');
    expect(h).not.toContain('correct horse');
    expect(h).not.toBe(hashPassword('correct horse'));
    expect(checkPassword('correct horse', h)).toBe(true);
    expect(checkPassword('correct horsf', h)).toBe(false);
    expect(checkPassword('x', 'garbage')).toBe(false);
  });
});

describe('sign up and sign in with a password, no code', () => {
  it('makes the account, opens a session, and remembers the kind of account', async () => {
    const s = await auth.signUp({ identifier: 'Asha@Firm.test', password: 'long enough pw', name: 'Asha Rao', accountType: 'ca' });
    expect(s.needsMfa).toBe(false);
    if (s.needsMfa) return;
    expect(s.isNewUser).toBe(true);
    expect(await auth.getSession(s.token)).toEqual({ userId: s.userId });
    expect(await auth.accountType(s.userId)).toBe('ca');
    expect(sender.outbox.length).toBe(0);                                  // nothing was sent
    const [u] = await db.web`select display_name, email from app_user where id = ${s.userId}`;
    expect(u).toMatchObject({ display_name: 'Asha Rao', email: 'asha@firm.test' });
  });

  it('refuses an address that already has an account, a short password, a missing name and an unknown kind', async () => {
    expect(await code(auth.signUp({ identifier: 'asha@firm.test', password: 'another long pw', name: 'X' }))).toBe('exists');
    expect(await code(auth.signUp({ identifier: 'b@firm.test', password: 'short', name: 'B' }))).toBe('weak_password');
    expect(await code(auth.signUp({ identifier: 'b@firm.test', password: 'long enough pw', name: '  ' }))).toBe('weak_password');
    expect(await code(auth.signUp({ identifier: 'b@firm.test', password: 'long enough pw', name: 'B', accountType: 'admin' }))).toBe('weak_password');
  });

  it('signs in with the right password, by email in any case or by mobile number', async () => {
    const s = await auth.signInPassword('ASHA@firm.test', 'long enough pw');
    expect(s.needsMfa).toBe(false);
    await auth.signUp({ identifier: '98765 43210', password: 'phone password', name: 'Ravi', accountType: 'lawyer' });
    const p = await auth.signInPassword('+91 9876543210', 'phone password');
    if (p.needsMfa) throw new Error('unexpected');
    expect(await auth.accountType(p.userId)).toBe('lawyer');
  });

  it('gives the same answer for a wrong password and an unknown address, and locks after five misses', async () => {
    expect(await code(auth.signInPassword('nobody@firm.test', 'whatever pw'))).toBe('bad_credentials');
    for (let i = 0; i < 5; i++) expect(await code(auth.signInPassword('asha@firm.test', 'wrong password'))).toBe('bad_credentials');
    expect(await code(auth.signInPassword('asha@firm.test', 'long enough pw'))).toBe('locked');   // even the right one, for now
    await db.web`update app_user set locked_until = now() - interval '1 minute' where email = 'asha@firm.test'`;
    expect((await auth.signInPassword('asha@firm.test', 'long enough pw')).needsMfa).toBe(false);
  });

  it('a person who only has a code login has no password to try', async () => {
    await auth.requestOtp('codeonly@firm.test');
    await auth.verifyOtp('codeonly@firm.test', sender.outbox[sender.outbox.length - 1]!.code);
    expect(await code(auth.signInPassword('codeonly@firm.test', 'any password here'))).toBe('bad_credentials');
  });

  it('the real owner of an address signing in by code removes the password someone else set, and ends its sessions', async () => {
    const s = await auth.signUp({ identifier: 'victim@firm.test', password: 'hostile tactic pw', name: 'Squatter' });
    if (s.needsMfa) throw new Error('unexpected');
    await auth.requestOtp('victim@firm.test');
    await auth.verifyOtp('victim@firm.test', sender.outbox[sender.outbox.length - 1]!.code);
    expect(await auth.getSession(s.token)).toBeNull();
    expect(await code(auth.signInPassword('victim@firm.test', 'hostile tactic pw'))).toBe('bad_credentials');
  });
});
