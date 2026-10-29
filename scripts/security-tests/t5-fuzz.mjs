// T5: robustness. Every write route gets malformed and hostile values. A 500 or a leaked stack trace is a finding.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { record, seededOwner, uuidv4, findings } from './lib.mjs';

const o = await seededOwner('fz');
const ROOT = new URL('../../apps/web/app/api', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === 'route.ts') files.push(p); } })(ROOT);
const SKIP = /^(auth|portal|webhooks|v1|mock-gateway|gstin|cron|admin|billing|account|demo|ca\/upload)/;
const idFor = { documents: o.docId, parties: o.partyId };
const KEYS = ['name', 'legalName', 'title', 'amount', 'rate', 'quantity', 'qty', 'date', 'dueDate', 'docType', 'kind', 'partyId', 'email', 'phone', 'gstin', 'stateCode', 'notes', 'reason', 'method', 'text', 'csv', 'data', 'type', 'q', 'role', 'identifier', 'period', 'label', 'url', 'events', 'lines', 'items', 'ids', 'percent', 'discount', 'taxRateBp', 'hsnSac', 'unit', 'status', 'balance', 'stock', 'delta', 'note', 'category', 'from', 'to', 'limit', 'offset'];
const VALUES = {
  nul: null, arr: [], obj: {}, str: 'x', numneg: -1, huge: '9'.repeat(40), exp: '1e400', nan: 'NaN', tiny: '0.0000000001', bool: true, nullbyte: 'a\u0000b', long: 'x'.repeat(200000),
  deep: (() => { let v = 'x'; for (let i = 0; i < 3000; i++) v = [v]; return v; })(), sqlish: "'); drop table document;--", uni: '\ud800', bigint: 9007199254740993,
};
const stackRe = /\bat [\w.<>$ ]+ \(|node_modules|\.ts:\d+|PostgresError|ECONN|password authentication|relation "[a-z_]+" does not exist|violates .* constraint|syntax error at or near/i;
let calls = 0; const bad = new Map(); const leaks = new Map();
for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join('/').replace(/\/route\.ts$/, '');
  if (SKIP.test(rel)) continue;
  const src = readFileSync(file, 'utf8');
  const methods = [...new Set([...src.matchAll(/export (?:const|async function|function) (POST|PUT|PATCH)\b/g)].map((m) => m[1]))];
  let path = '/api'; let prev = '';
  for (const s of rel.split('/')) { path += '/' + (s.startsWith('[') ? (idFor[prev] ?? uuidv4()) : s); prev = s.startsWith('[') ? prev : s; }
  for (const m of methods) {
    for (const [vn, v] of Object.entries(VALUES)) {
      const body = vn === 'deep' || vn === 'long' ? { [KEYS[0]]: v, [KEYS[3]]: v } : Object.fromEntries(KEYS.map((k) => [k, v]));
      let raw; try { raw = JSON.stringify(body); } catch { continue; }
      const r = await o.req(m, path, { body: raw, headers: { 'content-type': 'application/json' }, timeout: 30000 });
      calls++;
      if (r.status === 0) bad.set(`${m} ${rel} [${vn}] hang/timeout`, r.error);
      else if (r.status >= 500) bad.set(`${m} ${rel} [${vn}]`, `${r.status} ${r.text.slice(0, 100)}`);
      if (stackRe.test(r.text) && r.status >= 400) leaks.set(`${m} ${rel} [${vn}]`, r.text.slice(0, 140));
    }
    // malformed JSON and wrong content type
    for (const [label, raw] of [['truncated json', '{"a":'], ['bare string', '"x"'], ['array body', '[1,2,3]'], ['empty body', '']]) {
      const r = await o.req(m, path, { body: raw, headers: { 'content-type': 'application/json' } }); calls++;
      if (r.status >= 500) bad.set(`${m} ${rel} [${label}]`, `${r.status} ${r.text.slice(0, 100)}`);
      if (stackRe.test(r.text) && r.status >= 400) leaks.set(`${m} ${rel} [${label}]`, r.text.slice(0, 140));
    }
  }
}
console.log(`fuzz calls: ${calls}`);
const byRoute = {}; for (const k of bad.keys()) { const r = k.split(' [')[0]; (byRoute[r] ??= []).push(k.split(' [')[1]?.replace(']', '')); }
for (const [r, vs] of Object.entries(byRoute)) record('T5-500', 'robustness', `${r} answers 500 for: ${vs.join(', ')}`, 'WEAK', [...bad.entries()].find(([k]) => k.startsWith(r))?.[1], 'low');
for (const [k, v] of leaks) record('T5-leak', 'disclosure', `internal detail in an error: ${k}`, 'WEAK', v, 'medium');
record('T5', 'robustness', `${calls} hostile requests to write routes`, bad.size ? 'WEAK' : 'HELD', `${bad.size} server errors on ${Object.keys(byRoute).length} routes; ${leaks.size} leaky errors`);
