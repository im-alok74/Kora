// Runs the attack scripts one after another against a LOCAL copy of the app and fails when any of them finds a VULN that is not expected.
//   BASE                 the address of the local app (default http://localhost:3320; localhost only, the scripts refuse anything else)
//   PT_DATABASE_URL      the owner connection of the local database, so the sign-in limiter can be cleared between scripts (needs psql; or set PT_DOCKER_DB to the container name)
// Output lines: "ok" the defence held, "VULN" exploitable, "weak" partial, "info" for the reader.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)).replace(/^\/([A-Za-z]:)/, '$1');
/** t2-idor tries every route against another business's ids and also reports harmless no-op answers (a delete that finds nothing says 200); t2b-verify proves nothing changed, so that one gates. */
const INFO_ONLY = new Set(['t2-idor']);
const SCRIPTS = ['t1-unauth', 't2-idor', 't2b-verify', 't3-auth', 't3b-roles', 't3c', 't4a-inject', 't4b-upload', 't4c2-ssrf-https', 't5-fuzz', 't6-logic', 't6b-races', 't7-misc', 't8-more', 't9-reflect'];

/**
 * Findings that are expected because the test copy runs with the staging switches on (that is how the scripts sign in without a real code),
 * and nothing else. Each needs a reason; an unexpected VULN fails the run.
 */
const EXPECTED = {
  'T1-health-GET': 'the health check says down while a staging switch is on, which is exactly its job',
  'T1-csp-report-POST': 'browsers post violation reports without a session; the route is public on purpose and only logs',
  'T7-mockpay': 'the fake payment page is open on purpose in this staging copy; on a live deployment it is closed (isLiveDeployment)',
};

const clear = () => {
  if (!process.env.PT_DATABASE_URL) return;
  const r = spawnSync('docker', ['exec', process.env.PT_DOCKER_DB ?? 'kora-db-1', 'psql', '-U', 'kora_owner', '-d', 'kora', '-c', 'truncate rate_event'], { encoding: 'utf8' });
  const p = r.status === 0 ? r : spawnSync('psql', [process.env.PT_DATABASE_URL, '-c', 'truncate rate_event'], { encoding: 'utf8' });
  if (p.status !== 0) console.log(`(could not clear the limiter: ${String(p.stderr ?? p.error).trim().slice(0, 120)})`);
};

const only = process.argv.slice(2);
let unexpected = 0, ran = 0;
const summary = [];
for (const name of SCRIPTS.filter((n) => !only.length || only.includes(n))) {
  clear();
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(here, `${name}.mjs`)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env, timeout: 20 * 60_000 });
  ran++;
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const lines = out.split('\n');
  const vulns = lines.filter((l) => /^\s*VULN\s/.test(l));
  const bad = INFO_ONLY.has(name) ? [] : vulns.filter((l) => !Object.keys(EXPECTED).some((id) => l.includes(`[${id}]`)));
  const crashed = r.status !== 0;
  summary.push(`${name.padEnd(16)} ${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s  ok ${lines.filter((l) => /^\s*ok\s/.test(l)).length}  weak ${lines.filter((l) => /^\s*weak\s/.test(l)).length}  VULN ${vulns.length}${bad.length ? ` (${bad.length} unexpected)` : ''}${crashed ? '  SCRIPT FAILED' : ''}`);
  if (bad.length || crashed) {
    unexpected += bad.length + (crashed ? 1 : 0);
    console.log(`\n--- ${name}: ${bad.length} unexpected VULN${crashed ? ', and the script itself failed' : ''}`);
    for (const l of bad) console.log(l);
    if (crashed) console.log(lines.slice(-12).join('\n'));
  }
}
console.log('\n' + summary.join('\n'));
for (const [id, why] of Object.entries(EXPECTED)) console.log(`expected: [${id}] ${why}`);
console.log(unexpected ? `\nFAILED: ${unexpected} unexpected finding(s) in ${ran} scripts` : `\nPASSED: no unexpected findings in ${ran} scripts`);
process.exit(unexpected ? 1 : 0);
