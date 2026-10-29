// T8: admin routes as an ordinary user, oversized bodies, slow patterns, data in responses, privacy routes.
import { Client, record, seededOwner, newUser, findings } from './lib.mjs';
const o = await seededOwner('m8');
// admin
for (const [m, p] of [['GET', '/api/admin/panel'], ['GET', '/api/admin/panel?section=users'], ['GET', '/api/admin/jobs'], ['POST', '/api/admin/jobs']]) {
  const r = await o.req(m, p, m === 'POST' ? { json: { action: 'retry' } } : {});
  record('T8-admin', 'admin', `ordinary signed-in user calls ${m} ${p}`, r.status >= 200 && r.status < 300 ? 'VULN' : 'HELD', `${r.status} ${r.text.slice(0, 60)}`, 'critical');
}
// sensitive fields in responses
for (const p of ['/api/me', '/api/account', '/api/business', '/api/team', '/api/keys', '/api/auth/session']) {
  const r = await o.get(p); const txt = r.text;
  const leak = /password|hash|secret|token_hash|otp|mfa_secret|totp/i.exec(txt);
  record('T8-fields', 'disclosure', `${p} does not return secrets`, leak ? 'WEAK' : 'HELD', leak ? `contains "${leak[0]}": ${txt.slice(Math.max(0, leak.index - 30), leak.index + 40)}` : `${r.status}, ${txt.length} bytes`, 'medium');
}
// oversized bodies
for (const mb of [5, 30, 120]) {
  const big = '{"name":"' + 'a'.repeat(mb * 1024 * 1024) + '"}';
  const t0 = Date.now(); const r = await o.req('POST', '/api/parties', { body: big, headers: { 'content-type': 'application/json' }, timeout: 60000 });
  record('T8-body', 'dos', `${mb} MB JSON body to POST /api/parties`, r.status === 413 ? 'HELD' : r.status === 0 ? 'WEAK' : 'WEAK', `${r.status} after ${Date.now() - t0} ms ${r.error ?? r.text.slice(0, 60)}`, mb >= 30 ? 'medium' : 'low');
  const alive = await new Client().get('/api/me'); if (alive.status === 0) { record('T8-body-down', 'dos', 'server stopped answering after the large body', 'VULN', '', 'high'); break; }
}
// slow patterns
{
  const q = 'a'.repeat(50000) + '!';
  const t0 = Date.now(); const rs = await Promise.all([o.get(`/api/parties?q=${q}`), o.get(`/api/documents?q=${q}`), o.get(`/api/search?q=${q}`)]);
  const ms = Date.now() - t0;
  record('T8-slowq', 'dos', '50 000-character search strings', ms > 8000 ? 'WEAK' : 'HELD', `${ms} ms, ${rs.map((r) => r.status)}`, 'low');
  const t1 = Date.now(); await o.get(`/api/parties?q=${encodeURIComponent('%'.repeat(2000))}`); await o.get(`/api/parties?q=${encodeURIComponent('_%'.repeat(1000))}`);
  record('T8-like', 'dos', 'wildcard-heavy LIKE patterns', Date.now() - t1 > 8000 ? 'WEAK' : 'HELD', `${Date.now() - t1} ms`, 'low');
}
// CSV import abuse
{
  const rows = 'name\n' + Array.from({ length: 200000 }, (_, i) => `Cust ${i}`).join('\n');
  const t0 = Date.now(); const r = await o.post('/api/data/import', { kind: 'customers', csv: rows, commit: true });
  record('T8-import', 'dos', '200 000-row customer import in one call', r.status >= 200 && r.status < 300 ? 'WEAK' : 'HELD', `${r.status} ${Date.now() - t0} ms ${r.text.slice(0, 80)}`, 'medium');
  const form = await o.post('/api/data/import', { kind: 'customers', csv: 'name\n=cmd|\' /C calc\'!A0\n@SUM(1+1)\n+1+1', commit: true });
  const l = await o.get('/api/parties/export'); const bad = l.text.split('\n').filter((x) => /^"?[=@+]/.test(x));
  record('T8-import-formula', 'injection', 'imported cells starting with = + @ come back out of an export neutralised', bad.length ? 'VULN' : 'HELD', `${form.status}; raw formula lines in export: ${bad.length}`, 'medium');
}
// privacy / account: act on someone else
{
  const v = await newUser('victim');
  const r = await o.post('/api/privacy', { kind: 'erasure', userId: v.me.userId, details: 'delete them' });
  const list = await v.get('/api/privacy');
  record('T8-privacy', 'privacy', 'a request filed for another person\'s account appears on THEIR account', /delete them/.test(list.text) ? 'VULN' : 'HELD', `${r.status} ${r.text.slice(0, 60)}`, 'high');
  const sess = await o.get('/api/account'); console.log('  account keys:', Object.keys(sess.json ?? {}).join(','));
}
