import { LOOKS, invoiceSampleHtml } from '../../../lib/invoiceSamples';

export const dynamicParams = false;
export const generateStaticParams = () => LOOKS.map(([key]) => ({ key }));

/** A fictional sample invoice for the landing page gallery. It is shown inside a sandboxed frame, so it gets a CSP that allows no script. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const html = invoiceSampleHtml((await params).key);
  if (!html) return new Response('Not found', { status: 404 });
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600, s-maxage=86400', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'", 'x-robots-tag': 'noindex' } });
}
