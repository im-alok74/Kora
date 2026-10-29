// T4c: server-side request forgery through webhooks, CSRF, host header poisoning, method tricks.
import { Client, record, seededOwner, findings } from './lib.mjs';
const o = await seededOwner('ss');
const urls = [
  'http://127.0.0.1:3320/api/health', 'http://localhost:3320/api/health', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]:3320/', 'http://0x7f000001:3320/', 'http://2130706433:3320/',
  'http://127.1:3320/', 'http://0.0.0.0:3320/', 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://172.16.0.1/', 'http://100.64.0.1/', 'http://[::ffff:127.0.0.1]:3320/', 'http://[fd00::1]/',
  'http://user:pass@127.0.0.1:3320/', 'http://evil.example@127.0.0.1:3320/', 'http://127.0.0.1.nip.io:3320/', 'http://localtest.me:3320/', 'file:///etc/passwd', 'gopher://127.0.0.1:5432/', 'ftp://127.0.0.1/', 'javascript:alert(1)', 'http://metadata.google.internal/',
];
for (const url of urls) {
  const r = await o.post('/api/outbound-webhooks', { url, events: ['document.issued'] });
  if (r.status >= 200 && r.status < 300) {
    // Created. Does the test button actually connect?
    const t = await o.post(`/api/outbound-webhooks/${r.json?.id}/test`, {});
    const connected = /"ok":true|"status":2|200/.test(t.text) && !/not on the public|blocked/i.test(t.text);
    record('T4c-ssrf', 'ssrf', `webhook to ${url}`, connected ? 'VULN' : 'WEAK', `created (${r.status}); test call: ${t.status} ${t.text.slice(0, 110)}`, connected ? 'critical' : 'low');
  } else record('T4c-ssrf', 'ssrf', `webhook to ${url}`, 'HELD', `${r.status} ${r.text.slice(0, 90)}`);
}
// CSRF: a cross-site form post cannot be JSON. Does the server insist on it?
const forms = [
  ['urlencoded form to POST /api/parties', 'application/x-www-form-urlencoded', 'kind=customer&name=Csrf&stateCode=27'],
  ['text/plain JSON to POST /api/parties', 'text/plain', JSON.stringify({ kind: 'customer', name: 'Csrf2', stateCode: '27' })],
  ['multipart to POST /api/parties', 'multipart/form-data; boundary=x', '--x\r\nContent-Disposition: form-data; name="name"\r\n\r\nCsrf3\r\n--x--'],
];
for (const [label, ct, body] of forms) {
  const r = await o.req('POST', '/api/parties', { body, headers: { 'content-type': ct, origin: 'https://evil.example' } });
  const l = await o.get('/api/parties');
  record('T4c-csrf', 'csrf', label, /Csrf/.test(l.text) ? 'VULN' : 'HELD', `${r.status}`, 'high');
}
// DELETE does not need a JSON body: could a cross-site page trigger it? The cookie is SameSite=Lax, so a cross-site fetch carries no cookie. Prove the header is what protects it.
{
  const party = (await o.post('/api/parties', { kind: 'customer', name: 'DelTarget', stateCode: '27' })).json?.id;
  const noCookie = new Client(); noCookie.headers['x-business-id'] = o.businessId;
  const r = await noCookie.del(`/api/parties/${party}`);
  record('T4c-csrf-del', 'csrf', 'DELETE without the session cookie does nothing', r.status === 401 ? 'HELD' : 'VULN', `${r.status}`, 'high');
}
// Host header poisoning: do generated links use the Host header?
{
  const s = await o.req('POST', `/api/documents/${o.docId}/share`, { json: {}, headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' } });
  record('T4c-host', 'headers', 'share link built from the Host / X-Forwarded-Host header', /evil\.example/.test(s.text) ? 'VULN' : 'HELD', s.text.slice(0, 100), 'medium');
  const pl = await o.req('POST', `/api/documents/${o.docId}/payment-link`, { json: {}, headers: { 'x-forwarded-host': 'evil.example' } });
  record('T4c-host2', 'headers', 'payment link built from X-Forwarded-Host', /evil\.example/.test(pl.text) ? 'VULN' : 'HELD', pl.text.slice(0, 100), 'medium');
}
// Method tricks
for (const m of ['TRACE', 'PATCH', 'PUT']) { const r = await new Client().req(m, '/api/me'); record('T4c-method', 'headers', `${m} /api/me with no session`, [401, 405, 404].includes(r.status) ? 'HELD' : 'WEAK', `${r.status}`); }
const ov = await o.req('POST', '/api/parties', { json: { kind: 'customer', name: 'Override', stateCode: '27' }, headers: { 'x-http-method-override': 'DELETE' } });
record('T4c-override', 'csrf', 'X-HTTP-Method-Override is honoured', ov.status === 200 ? 'INFO' : 'HELD', `${ov.status}`);
