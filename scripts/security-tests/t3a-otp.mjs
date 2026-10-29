import { Client, record, uniq, findings } from './lib.mjs';
// --- OTP request spam and verification guessing
{
  const id = `spam.${uniq()}@pt.test`; const c = new Client(); c.headers['x-forwarded-for'] = '10.6.6.6';
  const codes = []; for (let i = 0; i < 15; i++) codes.push((await c.post('/api/auth/request', { identifier: id })).status);
  const limited = codes.filter((s) => s === 429).length;
  record('T3-otp-spam', 'auth', `15 OTP requests for one address in a row: ${[...new Set(codes)].join(',')} (${limited} limited)`, limited ? 'HELD' : 'VULN', 'an attacker can make Kora send unlimited codes to a victim', 'medium');
  const wrong = []; for (let i = 0; i < 12; i++) wrong.push((await c.post('/api/auth/verify', { identifier: id, code: String(100000 + i) })).status);
  record('T3-otp-guess', 'auth', `12 wrong codes: ${[...new Set(wrong)].join(',')}`, 'INFO', 'answers 400 each time; see next line for whether the challenge survives', 'high');
  const good = await c.post('/api/auth/verify', { identifier: id, code: '123456' });
  record('T3-otp-lockout', 'auth', `correct code after 12 wrong ones: ${good.status}`, good.status === 200 ? 'VULN' : 'HELD', 'the code is dead after too many wrong guesses (attempt cap), so it cannot be brute-forced', 'high');
}
