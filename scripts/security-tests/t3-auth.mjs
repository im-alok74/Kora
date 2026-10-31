// T3: sign-in, sessions, roles.
import { Client, record, seededOwner, signIn, uniq, newUser, findings } from './lib.mjs';

// OTP spam/guess block moved to t3a-otp.mjs
// --- account enumeration
{
  const known = await newUser('enum'); const c = new Client(); c.headers['x-forwarded-for'] = '10.8.8.8';
  await known.post('/api/auth/logout', {});
  const a = await c.post('/api/auth/password', { identifier: known.email, password: 'WrongPassw0rd!' });
  const b = await c.post('/api/auth/password', { identifier: `nobody.${uniq()}@pt.test`, password: 'WrongPassw0rd!' });
  record('T3-enum-login', 'auth', 'sign-in error for a real vs an unknown account', a.text === b.text && a.status === b.status ? 'HELD' : 'WEAK', `real: ${a.status} ${a.text.slice(0, 70)} | unknown: ${b.status} ${b.text.slice(0, 70)}`, 'low');
  const s = await c.post('/api/auth/signup', { identifier: known.email, password: 'Str0ngPassw0rd!x', name: 'x', accountType: 'business' });
  record('T3-enum-signup', 'auth', 'sign-up on an existing address reveals that it exists', s.status === 409 || /already|exists/i.test(s.text) ? 'WEAK' : 'HELD', `${s.status} ${s.text.slice(0, 80)}`, 'low');
}
// --- password rules and brute force
{
  const c = new Client(); const email = `pw.${uniq()}@pt.test`; c.headers['x-forwarded-for'] = '10.9.9.9';
  for (const pw of ['a', '12345678', 'password', 'Passw0rd', 'aaaaaaaaaaaa']) {
    const r = await c.post('/api/auth/signup', { identifier: `${uniq()}${email}`, password: pw, name: 'x', accountType: 'business' });
    record('T3-pw-' + pw, 'auth', `password "${pw}" accepted at sign-up`, r.status === 200 || r.status === 201 ? 'WEAK' : 'HELD', `${r.status} ${r.text.slice(0, 70)}`, 'medium');
  }
  const ok = await c.post('/api/auth/signup', { identifier: email, password: 'Str0ngPassw0rd!x', name: 'x', accountType: 'business' });
  const out = []; const c2 = new Client(); c2.headers['x-forwarded-for'] = '10.9.9.8';
  for (let i = 0; i < 25; i++) out.push((await c2.post('/api/auth/password', { identifier: email, password: 'Guess' + i + 'zzzzzzz!' })).status);
  record('T3-pw-brute', 'auth', `25 wrong passwords in a row: ${[...new Set(out)].join(',')}`, out.includes(429) ? 'HELD' : 'VULN', 'no lockout means passwords can be guessed without limit', 'high');
  const right = await c2.post('/api/auth/password', { identifier: email, password: 'Str0ngPassw0rd!x' });
  record('T3-pw-lock', 'auth', `right password after the guesses: ${right.status}`, right.status === 429 ? 'HELD' : 'INFO', 'the account stays locked for the attacker and the owner alike');
}
// --- sessions
{
  const u = await newUser('sess'); const old = u.jar.kora_session;
  await u.post('/api/auth/logout', {});
  const c = new Client(); c.jar = { kora_session: old };
  const after = await c.get('/api/me');
  record('T3-logout', 'auth', 'old session cookie after sign-out', after.status === 200 ? 'VULN' : 'HELD', `GET /api/me with the old cookie: ${after.status}`, 'high');
  const fresh = new Client(); fresh.headers['x-forwarded-for'] = '10.7.7.7'; const id = `cookie.${uniq()}@pt.test`;
  await fresh.post('/api/auth/request', { identifier: id }); const v = await fresh.post('/api/auth/verify', { identifier: id, code: '123456' });
  const flags = v.setCookie.find((x) => x.startsWith('kora_session')) ?? '(no cookie, status ' + v.status + ')';
  console.log('  raw cookie header:', flags.replace(/kora_session=[^;]+/, 'kora_session=<token>'));
  record('T3-cookie-http', 'auth', 'session cookie is HttpOnly and SameSite', /HttpOnly/i.test(flags) && /SameSite=(Lax|Strict)/i.test(flags) ? 'HELD' : 'VULN', flags.replace(/=[^;]+/, '=<token>'), 'high');
  record('T3-cookie-secure', 'auth', 'session cookie has the Secure flag (this local server is plain http, so the app only sets it in production over https)', /Secure/i.test(flags) ? 'HELD' : 'INFO', 'check on the deployed site', 'medium');
  const fx = new Client(); fx.headers['x-forwarded-for'] = '10.7.7.6'; fx.jar = { kora_session: 'attacker-chosen-value' }; const id2 = `fix.${uniq()}@pt.test`;
  await fx.post('/api/auth/request', { identifier: id2 }); const fv = await fx.post('/api/auth/verify', { identifier: id2, code: '123456' });
  record('T3-fixation', 'auth', 'session fixation: login replaces a client-supplied session value', fv.status === 200 && fx.jar.kora_session !== 'attacker-chosen-value' ? 'HELD' : 'VULN', `login ${fv.status}; cookie after login: ${String(fx.jar.kora_session).slice(0, 14)}…`, 'high');
}
// --- identifier tricks: same account whatever the case or spacing
{
  const base = `Case.${uniq()}@PT.test`; const c = new Client(); c.headers['x-forwarded-for'] = '10.5.5.5';
  const s1 = await c.post('/api/auth/signup', { identifier: base, password: 'Str0ngPassw0rd!x', name: 'x', accountType: 'business' });
  const c2 = new Client(); c2.headers['x-forwarded-for'] = '10.5.5.4';
  const l = await c2.post('/api/auth/password', { identifier: ` ${base.toLowerCase()} `, password: 'Str0ngPassw0rd!x' });
  const dup = await new Client().post('/api/auth/signup', { identifier: base.toLowerCase(), password: 'Str0ngPassw0rd!y', name: 'y', accountType: 'business', }, { headers: { 'x-forwarded-for': '10.5.5.3' } });
  record('T3-case', 'auth', 'the same address in another case or with spaces is the same account', l.status === 200 && dup.status !== 200 ? 'HELD' : 'VULN', `sign-up ${s1.status}, sign-in with other case ${l.status}, duplicate sign-up ${dup.status}`, 'medium');
}
// --- roles inside one business
{
  const owner = await seededOwner('roleowner');
  const staff = await newUser('staff'); const acct = await newUser('acct'); const outsider = await newUser('out');
  const i1 = await owner.post('/api/team', { identifier: staff.email, role: 'staff' }); const i2 = await owner.post('/api/team', { identifier: acct.email, role: 'accountant' });
  for (const m of [staff, acct]) await m.post('/api/invites', { businessId: owner.businessId, accept: true });
  staff.headers['x-business-id'] = owner.businessId; acct.headers['x-business-id'] = owner.businessId;
  const att = [
    ['staff invites a new owner', staff, 'post', '/api/team', { identifier: outsider.email, role: 'owner' }],
    ['staff changes own role to owner', staff, 'patch', `/api/team/${staff.me?.userId}`, { role: 'owner' }],
    ['staff creates an API key', staff, 'post', '/api/keys', { name: 'steal' }],
    ['staff edits business settings', staff, 'patch', '/api/business', { legalName: 'Staff Renamed' }],
    ['staff exports all data', staff, 'get', '/api/data/export'],
    ['staff reads audit log', staff, 'get', '/api/audit'],
    ['accountant creates an invoice', acct, 'post', '/api/documents', { docType: 'tax_invoice', partyId: owner.partyId, lines: [{ name: 'X', hsnSac: '998313', quantity: '1', rate: '1', taxRateBp: 1800, kind: 'service' }] }],
    ['accountant records a payment', acct, 'post', `/api/documents/${owner.docId}/payments`, { amount: '1', method: 'cash', date: '2026-10-29' }],
    ['accountant deletes a customer', acct, 'del', `/api/parties/${owner.partyId}`],
    ['accountant invites a member', acct, 'post', '/api/team', { identifier: outsider.email, role: 'accountant' }],
    ['outsider reads the business', outsider, 'get', '/api/documents', null, { 'x-business-id': owner.businessId }],
  ];
  for (const [label, who, m, path, body, hdr] of att) {
    const r = await who[m](path, body ?? undefined, hdr ? { headers: hdr } : undefined);
    const allowed = r.status >= 200 && r.status < 300 && !/"ok":false/.test(r.text);
    record('T3-role', 'roles', label, allowed ? 'VULN' : 'HELD', `${r.status} ${r.text.slice(0, 70)}`, 'high');
  }
  record('T3-role-setup', 'roles', `team invites worked: ${i1.status}/${i2.status}`, 'INFO');
}
