import { getPublicDocument, publicEstimateInfo } from '@kora/core';
import { renderDocumentHtml } from '@kora/pdf';
import { irnBlock, services, withUpi } from '../../../lib/server';
import { publicLimit } from '../../../lib/publicLimit';

export const runtime = 'nodejs';

const HEADERS = {
  'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex',
  'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};
// A quote page carries a small form to the same site, so it may post to itself and nowhere else.
const QUOTE_HEADERS = { ...HEADERS, 'content-security-policy': HEADERS['content-security-policy'].replace("form-action 'none'", "form-action 'self'") };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const PANEL_CSS = `<style>
.ans{max-width:760px;margin:16px auto;padding:16px;border:1px solid #cbd5d1;border-radius:10px;font:15px/1.5 system-ui;background:#fff;color:#14201d}
.ans h2{margin:0 0 6px;font-size:18px}.ans label{display:block;margin-top:10px;font-weight:600}
.ans input,.ans textarea{width:100%;box-sizing:border-box;padding:10px;border:1px solid #6b7c77;border-radius:6px;font:inherit;min-height:44px}
.ans textarea{min-height:84px}.ans .acts{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
.ans button{min-height:44px;padding:0 18px;border-radius:6px;border:1px solid #0b5d4f;background:#0b5d4f;color:#fff;font:600 15px system-ui;cursor:pointer}
.ans button.no{background:#fff;color:#14201d;border-color:#6b7c77}.ans .bad{color:#9b1c1c;font-weight:600}.ans .good{color:#0b5d4f;font-weight:600}
.ans input:focus,.ans textarea:focus,.ans button:focus{outline:3px solid #106cd9;outline-offset:2px}
</style>`;

/** The answer box under a shared quote. Shows the form while the quote is open, and what was answered afterwards. */
function answerPanel(token: string, e: { status: string; valid_until: string | null; decision: string | null; comment: string | null; name: string | null }, url: URL): string {
  const problem = url.searchParams.get('problem');
  const flash = problem ? `<p class="bad" role="alert">${esc(problem)}</p>` : url.searchParams.get('answered') ? '<p class="good" role="status">Thank you. Your answer has been sent.</p>' : '';
  if (e.status === 'accepted' || e.status === 'declined' || e.status === 'invoiced') {
    const word = e.status === 'declined' ? 'declined' : 'accepted';
    return `${PANEL_CSS}<div class="ans">${flash}<h2>You ${word} this quote</h2>${e.name ? `<p>Answered by ${esc(e.name)}.</p>` : ''}${e.comment ? `<p>Your comment: ${esc(e.comment)}</p>` : ''}</div>`;
  }
  if (e.status === 'expired') return `${PANEL_CSS}<div class="ans">${flash}<h2>This quote has expired</h2><p>It was valid until ${esc(e.valid_until)}. Please ask the sender for a fresh one.</p></div>`;
  if (e.status === 'cancelled') return `${PANEL_CSS}<div class="ans"><h2>This quote has been replaced</h2><p>The sender has issued a newer version. Please use the latest link they sent you.</p></div>`;
  if (e.status !== 'open') return '';
  return `${PANEL_CSS}<form class="ans" method="post" action="/i/${esc(token)}/answer">${flash}
<h2>Your answer</h2>${e.valid_until ? `<p>This quote is valid until ${esc(e.valid_until)}.</p>` : ''}
<label for="nm">Your name</label><input id="nm" name="name" maxlength="120" autocomplete="name" required>
<label for="cm">Comment (needed if you decline)</label><textarea id="cm" name="comment" maxlength="500"></textarea>
<div class="acts"><button name="action" value="accept">Accept this quote</button><button class="no" name="action" value="decline">Decline</button></div></form>`;
}

/** The public invoice page. No sign-in; the token in the link is the only credential. */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const limited = await publicLimit('invoice-page', 120, 'text');
  if (limited) return limited;
  const { token } = await ctx.params;
  const d = await getPublicDocument(services().sql, token);
  if (!d) {
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font-family:system-ui;max-width:420px;margin:15vh auto;padding:0 16px"><h1>This link is not valid</h1><p>It may have expired or been withdrawn. Ask the sender for a new one.</p>',
      { status: 404, headers: HEADERS });
  }
  const html = renderDocumentHtml({ ...(await withUpi({ doc: d, lines: d.lines, supplier: d.supplier_snapshot ?? {}, recipient: d.recipient_snapshot ?? null, template: d.template })), irn: await irnBlock(d.einvoice) });
  const bar = `<div style="position:sticky;top:0;background:#106cd9;color:#fff;padding:8px 16px;font:14px system-ui;display:flex;justify-content:space-between"><span>Shared with you</span><a style="color:#fff" href="/i/${token}/pdf">Download PDF</a></div>`;
  let panel = '';
  let headers = HEADERS;
  if (d.doc_type === 'estimate') {
    const info = await publicEstimateInfo(services().sql, token);
    if (info) { panel = answerPanel(token, info as never, new URL(req.url)); headers = QUOTE_HEADERS; }
  }
  return new Response(html.replace('<body>', `<body>${bar}`).replace('</body>', `${panel}</body>`), { headers });
}
