// T1: every API route and method, called with no session. Anything that answers 2xx or 5xx and is not meant to be public is a finding.
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { Client, record, uuidv4, findings } from './lib.mjs';

const ROOT = fileURLToPath(new URL('../../apps/web/app/api', import.meta.url));
const routes = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === 'route.ts') routes.push(p); } })(ROOT);

const PUBLIC = [/^auth\//, /^health$/, /^portal\//, /^webhooks\//, /^ca\/upload\//, /^mock-gateway\//, /^gstin/, /^cron\//, /^v1\//, /^demo$/, /^template\/gallery$/, /^template\/preview$/];
const anon = new Client('anon');
const rows = [];
for (const file of routes) {
  const rel = relative(ROOT, file).split(sep).join('/').replace(/\/route\.ts$/, '');
  const src = readFileSync(file, 'utf8');
  const methods = [...new Set([...src.matchAll(/export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]))];
  const path = '/api/' + rel.replace(/\[token\]/g, 'x'.repeat(32)).replace(/\[gstin\]/g, '27AAAAA0000A1Z5').replace(/\[(\w+)\]/g, () => uuidv4());
  for (const m of methods) {
    const r = await anon.req(m, path, m === 'GET' ? {} : { json: {} });
    const pub = PUBLIC.some((re) => re.test(rel));
    rows.push({ rel, m, status: r.status, pub });
    if (r.status >= 500 || r.status === 0) record(`T1-${rel}-${m}`, 'unauth', `${m} /api/${rel} with no session returned ${r.status}`, 'VULN', r.text.slice(0, 160), 'medium');
    else if (r.status >= 200 && r.status < 300 && !pub) record(`T1-${rel}-${m}`, 'unauth', `${m} /api/${rel} answered ${r.status} with no session`, 'VULN', r.text.slice(0, 160), 'high');
  }
}
const bad = rows.filter((r) => !r.pub && ![401, 403, 404, 405, 400, 415].includes(r.status));
console.log(`\nroutes: ${routes.length}, method calls: ${rows.length}, non-public calls not 401/403/404/405/400/415: ${bad.length}`);
const pubRows = rows.filter((r) => r.pub);
console.log('public-by-design calls (status):', pubRows.map((r) => `${r.m} ${r.rel}=${r.status}`).join(' | ').slice(0, 1500));
record('T1', 'unauth', `All ${rows.length} method calls on ${routes.length} routes checked with no session`, bad.length ? 'WEAK' : 'HELD', bad.map((b) => `${b.m} ${b.rel}=${b.status}`).join(', '));

