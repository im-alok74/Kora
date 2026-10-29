// T9: reflected XSS and open redirects on public pages; clickjacking of the client upload page.
import { Client, record, findings } from './lib.mjs';
const a = new Client();
const sm = await a.get('/sitemap.xml');
const paths = [...new Set([...sm.text.matchAll(/<loc>https?:\/\/[^/]+(\/[^<]*)<\/loc>/g)].map((m) => m[1]).concat(['/', '/login', '/pricing', '/help', '/tools', '/download', '/privacy', '/terms', '/send/abc', '/portal/abc', '/i/abc', '/pay/thanks', '/samples', '/import-guide', '/setup']))];
const CAN = `"><svg onload=alert(7331)>'`;
let n = 0, refl = 0;
for (const p of paths) {
  for (const k of ['q', 'next', 'redirect', 'returnTo', 'error', 'message', 'from', 'to', 'ref', 'utm_source', 'signup', 'demo']) {
    const r = await a.get(`${p}${p.includes('?') ? '&' : '?'}${k}=${encodeURIComponent(CAN)}`);
    n++;
    if (r.text.includes('<svg onload=alert(7331)>') || r.text.includes(`'"><svg`) ) { refl++; record('T9-reflect', 'xss', `${p}?${k}= reflects a script payload unescaped`, 'VULN', '', 'high'); }
    const loc = r.headers.get('location') ?? '';
    if (r.status >= 300 && r.status < 400 && /evil|7331/.test(loc)) record('T9-redirect', 'redirect', `${p}?${k}= redirects to ${loc}`, 'VULN', '', 'medium');
  }
}
record('T9', 'xss', `${n} requests to ${paths.length} public pages with a payload in 12 parameter names`, refl ? 'VULN' : 'HELD', `${refl} unescaped reflections`);
// open redirect attempts on known redirecting routes
for (const p of ['//evil.example', '/\\evil.example', 'https://evil.example', '/%2f%2fevil.example']) {
  const r = await a.get(`/login?next=${encodeURIComponent(p)}`);
  const r2 = await a.get(p.startsWith('/') ? p : '/' + p);
  record('T9-open-redirect', 'redirect', `path-based redirect with ${p}`, /evil\.example/.test(r2.headers.get('location') ?? '') ? 'VULN' : 'HELD', `${r2.status}`);
}
const send = await a.get('/send/anything'); record('T9-send-frame', 'headers', 'client upload page cannot be framed by another site', /SAMEORIGIN|DENY/i.test(send.headers.get('x-frame-options') ?? '') ? 'HELD' : 'VULN', `${send.headers.get('x-frame-options')}`, 'low');
record('T9-send-referrer', 'headers', 'client upload page does not leak its token in a Referer header', /no-referrer/i.test(send.text) || /no-referrer/i.test(send.headers.get('referrer-policy') ?? '') ? 'HELD' : 'WEAK', `meta/header: ${send.headers.get('referrer-policy')}`, 'low');
