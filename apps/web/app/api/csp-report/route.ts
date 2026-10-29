import { log } from '@kora/core';
import { publicLimit } from '../../../lib/publicLimit';

/**
 * Where the browser reports what the report-only script policy would have blocked. Public by nature (the browser sends it, with no cookie),
 * so it is rate limited, takes at most 8 KB, and only writes one short log line per report. It answers 204 whatever it receives.
 */
export async function POST(req: Request) {
  if (await publicLimit('csp', 60)) return new Response(null, { status: 204 });
  try {
    const raw = (await req.text()).slice(0, 8192);
    const j = JSON.parse(raw) as Record<string, unknown>;
    const r = ((j['csp-report'] ?? (Array.isArray(j) ? (j[0] as Record<string, unknown>)?.body : j)) ?? {}) as Record<string, unknown>;
    const s = (k: string) => String(r[k] ?? r[k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] ?? '').slice(0, 200);
    log('warn', 'csp_violation', { directive: s('effective-directive') || s('violated-directive'), blocked: s('blocked-uri'), document: s('document-uri').replace(/[?#].*$/, ''), source: s('source-file').replace(/[?#].*$/, ''), line: s('line-number') });
  } catch { /* not a report; ignore */ }
  return new Response(null, { status: 204 });
}
