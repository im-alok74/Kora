// T4a: XSS, SQL injection, CSV/formula injection, headers, CORS, exposed files.
import { Client, record, seededOwner, findings } from './lib.mjs';

const XSS = `"><img src=x onerror=alert(document.domain)><script>alert(1)</script>`;
const o = await seededOwner('xss');
// Put the payload everywhere a user can type text.
const p = (await o.post('/api/parties', { kind: 'customer', name: XSS, stateCode: '27', email: 'a@b.test', notes: XSS })).json?.id;
await o.put(`/api/business`, { legalName: `Evil ${XSS}`, tradeName: XSS }).catch(() => {});
const doc = await o.post('/api/documents', { docType: 'tax_invoice', partyId: p, notes: XSS, terms: XSS, lines: [{ name: XSS, description: XSS, hsnSac: '998313', quantity: '1', rate: '100', taxRateBp: 1800, kind: 'service' }] });
const id = doc.json?.id; await o.post(`/api/documents/${id}/issue`, {});
const share = await o.post(`/api/documents/${id}/share`, {}); const tok = share.json?.url?.split('/').pop();
console.log('doc', doc.status, id, 'share', share.status);

const pages = {
  'public invoice page /i/<token>': tok ? (await new Client().get(`/i/${tok}`)).text : '',
  'invoice HTML /api/documents/<id>/html': (await o.get(`/api/documents/${id}/html`)).text,
  'invoice preview html': (await o.post('/api/documents/preview-html', { docType: 'tax_invoice', partyId: p, notes: XSS, lines: [{ name: XSS, hsnSac: '998313', quantity: '1', rate: '1', taxRateBp: 1800, kind: 'service' }] })).text,
};
for (const [name, html] of Object.entries(pages)) {
  const raw = /<img src=x onerror=alert/.test(html) || /<script>alert\(1\)<\/script>/.test(html);
  record('T4a-xss', 'xss', `stored XSS payload in ${name}`, html.length < 50 ? 'INFO' : raw ? 'VULN' : 'HELD', html.length < 50 ? `no html returned (${html.slice(0, 50)})` : raw ? 'payload appears unescaped' : 'payload is escaped', 'high');
}
// The CSP on those pages: would a missed escape still run?
const inv = await new Client().get(`/i/${tok}`);
const csp = inv.headers.get('content-security-policy');
record('T4a-csp', 'headers', 'public invoice page has a script-blocking Content-Security-Policy', /script-src|default-src 'none'/.test(csp ?? '') ? 'HELD' : 'WEAK', `CSP: ${csp ?? '(none)'}`, 'medium');
const app = await o.get('/app'); const csp2 = app.headers.get('content-security-policy'); const ro = app.headers.get('content-security-policy-report-only');
record('T4a-csp-app', 'headers', 'the signed-in app has a script-src policy (enforced, or report-only while it is being rolled out)', /script-src/.test(csp2 ?? '') ? 'HELD' : /script-src/.test(ro ?? '') ? 'WEAK' : 'WEAK', `enforced: ${csp2 ?? '(none)'} | report-only: ${(ro ?? '(none)').slice(0, 90)}`, 'medium');

// SQL injection
const sqli = ["' OR '1'='1", "'; drop table party;--", "%' UNION SELECT null--", '\\', "\u0000"];
for (const q of sqli) {
  const outs = await Promise.all([o.get(`/api/parties?q=${encodeURIComponent(q)}`), o.get(`/api/documents?q=${encodeURIComponent(q)}&status=${encodeURIComponent(q)}`), o.get(`/api/search?q=${encodeURIComponent(q)}`), o.get(`/api/items?q=${encodeURIComponent(q)}`)]);
  const bad = outs.filter((r) => r.status >= 500);
  record('T4a-sqli', 'injection', `SQL metacharacters in search/filter: ${JSON.stringify(q)}`, bad.length ? 'WEAK' : 'HELD', outs.map((r) => r.status).join(','), 'high');
}
const after = await o.get('/api/parties'); record('T4a-sqli-intact', 'injection', 'party table survived the injection attempts', after.status === 200 ? 'HELD' : 'VULN', `${after.status}`, 'critical');
// numeric / ordering params
const nums = await Promise.all([o.get('/api/documents?limit=-1'), o.get('/api/documents?limit=999999999'), o.get('/api/documents?offset=abc'), o.get('/api/documents?limit=1;select pg_sleep(5)')]);
record('T4a-limit', 'injection', 'odd limit/offset values', nums.some((r) => r.status >= 500) ? 'WEAK' : 'HELD', nums.map((r) => r.status).join(','), 'low');
const big = await o.get('/api/documents?limit=999999999'); record('T4a-limit-cap', 'dos', 'a huge limit is capped (no way to dump everything in one call)', (big.json?.documents?.length ?? 0) <= 500 ? 'HELD' : 'WEAK', `${big.json?.documents?.length} rows`, 'low');

// CSV / formula injection through exports
const f = (await o.post('/api/parties', { kind: 'customer', name: '=HYPERLINK("http://evil.test","click")', stateCode: '27' })).json?.id;
const exp = await o.get('/api/parties/export');
const line = exp.text.split('\n').find((l) => /HYPERLINK/.test(l)) ?? '';
record('T4a-csv', 'injection', 'customer export neutralises formulas (= + - @)', !line ? 'INFO' : /^"?[=+\-@]/.test(line.split(',')[0]) || /,"?=HYPERLINK/.test(line) ? 'VULN' : 'HELD', `row: ${line.slice(0, 90)}`, 'medium');
const rep = await o.get('/api/reports/ageing?format=csv'); const rl = rep.text.split('\n').find((l) => /HYPERLINK/.test(l)) ?? '';
record('T4a-csv2', 'injection', 'report CSV neutralises formulas', !rl ? 'INFO' : /(^|,)"?=HYPERLINK/.test(rl) ? 'VULN' : 'HELD', `row: ${rl.slice(0, 90)}`, 'medium');

// Headers, CORS, version leaks
const h = await new Client().get('/', {});
const hh = (n) => h.headers.get(n);
record('T4a-hdr', 'headers', 'basic hardening headers present', hh('x-content-type-options') && hh('strict-transport-security') && hh('x-frame-options') && hh('referrer-policy') ? 'HELD' : 'WEAK', `nosniff=${hh('x-content-type-options')} hsts=${!!hh('strict-transport-security')} xfo=${hh('x-frame-options')}`, 'low');
record('T4a-powered', 'headers', 'X-Powered-By hidden', hh('x-powered-by') ? 'WEAK' : 'HELD', `x-powered-by: ${hh('x-powered-by')}`, 'low');
const cors = await new Client().req('GET', '/api/me', { headers: { origin: 'https://evil.example' } });
record('T4a-cors', 'headers', 'no permissive CORS on the API', cors.headers.get('access-control-allow-origin') ? 'VULN' : 'HELD', `ACAO: ${cors.headers.get('access-control-allow-origin')}`, 'high');
const opt = await o.req('OPTIONS', '/api/documents', { headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
record('T4a-preflight', 'headers', 'preflight from another origin gets no CORS grant', opt.headers.get('access-control-allow-origin') ? 'VULN' : 'HELD', `${opt.status} ACAO: ${opt.headers.get('access-control-allow-origin')}`, 'high');
const framed = await o.get('/app'); record('T4a-frame', 'headers', 'clickjacking: pages cannot be framed by other sites', /SAMEORIGIN|DENY/i.test(framed.headers.get('x-frame-options') ?? '') ? 'HELD' : 'VULN', `${framed.headers.get('x-frame-options')}`, 'medium');

// exposed files
for (const path of ['/.env', '/.git/config', '/package.json', '/_next/static/chunks/main.js.map', '/api/../.env', '/%2e%2e/%2e%2e/etc/passwd', '/.next/BUILD_ID', '/next.config.mjs', '/supabase/config.toml', '/api/health?verbose=1', '/admin', '/api/admin/panel', '/_next/image?url=http://127.0.0.1:3320/api/health&w=64&q=75']) {
  const r = await new Client().get(path);
  const leaks = r.status === 200 && /DATABASE_URL|OTP_HMAC|\[core\]|root:x:|"name": ?"@kora|sourceMappingURL|mappings/.test(r.text);
  record('T4a-exposed', 'exposure', `GET ${path}`, leaks ? 'VULN' : 'HELD', `${r.status} ${r.text.slice(0, 60).replace(/\n/g, ' ')}`, leaks ? 'critical' : '');
}
