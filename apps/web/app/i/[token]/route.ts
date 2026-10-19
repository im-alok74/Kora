import { getPublicDocument } from '@kora/core';
import { renderDocumentHtml } from '@kora/pdf';
import { irnBlock, services, withUpi } from '../../../lib/server';

export const runtime = 'nodejs';

const HEADERS = {
  'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex',
  'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
};

/** The public invoice page. No sign-in; the token in the link is the only credential. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const d = await getPublicDocument(services().sql, token);
  if (!d) {
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font-family:system-ui;max-width:420px;margin:15vh auto;padding:0 16px"><h1>This link is not valid</h1><p>It may have expired or been withdrawn. Ask the sender for a new one.</p>',
      { status: 404, headers: HEADERS });
  }
  const html = renderDocumentHtml({ ...(await withUpi({ doc: d, lines: d.lines, supplier: d.supplier_snapshot ?? {}, recipient: d.recipient_snapshot ?? null, template: d.template })), irn: await irnBlock(d.einvoice) });
  const bar = `<div style="position:sticky;top:0;background:#0b5d4f;color:#fff;padding:8px 16px;font:14px system-ui;display:flex;justify-content:space-between"><span>Shared with you</span><a style="color:#fff" href="/i/${token}/pdf">Download PDF</a></div>`;
  return new Response(html.replace('<body>', `<body>${bar}`), { headers: HEADERS });
}
