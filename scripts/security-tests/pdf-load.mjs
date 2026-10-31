// PDF output under load: several businesses ask for their invoice PDF at the same time. Every answer must be a real PDF, none a server error.
//   OWNERS (default 6) businesses, EACH (default 15) requests each, all in flight together. The per-person heavy limit is 40 a minute, so EACH stays under it.
import { record, seededOwner } from './lib.mjs';
const OWNERS = Number(process.env.OWNERS ?? 6), EACH = Number(process.env.EACH ?? 15);
const owners = [];
for (let i = 0; i < OWNERS; i++) owners.push(await seededOwner(`pdf${i}`));
const times = [], bad = [];
const t0 = Date.now();
await Promise.all(owners.flatMap((o) => Array.from({ length: EACH }, async () => {
  const s = Date.now();
  const r = await o.req('GET', `/api/documents/${o.docId}/pdf`, { raw: true, timeout: 90000 });
  times.push(Date.now() - s);
  const ok = r.status === 200 && (r.headers.get('content-type') ?? '').includes('pdf') && String(r.text ?? '').startsWith('%PDF');
  if (!ok) bad.push(`${r.status} ${(r.headers.get('content-type') ?? '')} ${String(r.text ?? '').slice(0, 40)}`);
})));
times.sort((a, b) => a - b);
const q = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))];
const total = OWNERS * EACH;
record('PDF-load', 'pdf', `${total} PDFs from ${OWNERS} businesses at once: ${total - bad.length} good in ${Date.now() - t0} ms (median ${q(0.5)} ms, slowest 5% over ${q(0.95)} ms)`, bad.length ? 'VULN' : 'HELD', bad.slice(0, 3).join(' | '), 'medium');
process.exit(bad.length ? 1 : 0);
