// Checks that Kora is up and that background work is not stuck. Used by .github/workflows/watch.yml.
//
//   KORA_SITE_URL   the public address, for example https://kora.example.com (a repository secret)
//   CRON_SECRET     the bearer secret of /api/cron/tick and /api/admin/jobs (a repository secret)
//   MAX_WAIT_MIN    how old the oldest waiting job may be before this fails. Default 15
//
// It only reads: GET /api/health and GET /api/admin/jobs. Exit code 0 means healthy, 1 means a problem (GitHub then emails the
// repository owner), 78 means the secrets are not set yet (the workflow treats that as a notice, not a failure).

/**
 * Pure decision, kept apart from the network so it can be tested.
 * `jobs` is the JSON answer of GET /api/admin/jobs: { counts: [{ queue, status, n, oldest_waiting }], failed: [...] }.
 * Returns a list of problems; an empty list means healthy.
 */
export function evaluate({ health, jobs, now = Date.now(), maxWaitMin = 15 }) {
  const problems = [];
  if (health?.schema === 'unknown') problems.push('Schema readiness is unknown; verify migration files are included in the deployment.');
  if (!health || health.status !== 'ok') problems.push(`The health check did not answer ok (${health ? JSON.stringify(health) : 'no answer'}).`);
  if (!jobs || !Array.isArray(jobs.counts)) {
    problems.push('The queue route did not return counts.');
    return problems;
  }
  for (const row of jobs.counts) {
    if (row.status === 'running' && row.oldest_running && now - Date.parse(row.oldest_running) > 10 * 60000) problems.push(`Queue ${row.queue}: a running lease has expired. Investigate before replay.`);
    if (row.status === 'queued' && row.oldest_waiting) {
      const waitedMin = (now - new Date(row.oldest_waiting).getTime()) / 60000;
      if (Number.isFinite(waitedMin) && waitedMin > maxWaitMin) {
        problems.push(`Queue ${row.queue}: ${row.n} job(s) waiting, the oldest for ${Math.round(waitedMin)} minutes (limit ${maxWaitMin}).`);
      }
    }
    if (row.status === 'failed' && Number(row.n) > 0) problems.push(`Queue ${row.queue}: ${row.n} job(s) have failed for good. Look at the last errors on /api/admin/jobs.`);
  }
  return problems;
}

async function get(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, body };
}

async function main() {
  const base = (process.env.KORA_SITE_URL ?? '').trim().replace(/\/+$/, '');
  const secret = process.env.CRON_SECRET ?? '';
  if (!base || !secret) {
    console.log('KORA_SITE_URL or CRON_SECRET is not set as a repository secret, so there is nothing to check yet.');
    process.exit(78);
  }
  if (!/^https:\/\//.test(base)) {
    console.error('KORA_SITE_URL must start with https://');
    process.exit(1);
  }
  let health = null, jobs = null;
  try { health = (await get(`${base}/api/health`, { authorization: `Bearer ${secret}` })).body; } catch (e) { health = { status: `unreachable (${e.message})` }; }
  try {
    const r = await get(`${base}/api/admin/jobs`, { authorization: `Bearer ${secret}` });
    if (r.status === 200) jobs = r.body; else console.error(`/api/admin/jobs answered ${r.status}`);
  } catch (e) { console.error(`/api/admin/jobs could not be reached (${e.message})`); }
  const problems = evaluate({ health, jobs, maxWaitMin: Number(process.env.MAX_WAIT_MIN ?? 15) });
  if (problems.length === 0) { console.log('Healthy: the site answers and no job is stuck.'); return; }
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
