import { formatRupees } from '@kora/tax';
import { services } from '../../../lib/server';

const HEAD = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };

/** A stand-in for the gateway's hosted checkout, so the whole payment loop can be tried without a gateway account. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === 'production' && process.env.KORA_ALLOW_MOCKS !== '1') return new Response('Not found', { status: 404 });
  const { id } = await ctx.params;
  if (!/^plink_[0-9a-f]{18}$/.test(id)) return new Response('Not found', { status: 404 });
  const [link] = await services().sql`select * from lookup_payment_link('mock', ${id})`;
  if (!link) return new Response('Not found', { status: 404 });
  const amount = formatRupees(BigInt(link.amount_paise as string));
  const paid = link.status === 'paid';
  return new Response(`<!doctype html><html lang="en-IN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test payment page</title>
<body style="font-family:system-ui;max-width:420px;margin:12vh auto;padding:0 16px;color:#17201d">
<p style="color:#8a5a00"><b>Test payment page.</b> No real money moves. This stands in for the payment gateway.</p>
<h1 style="font-weight:600">${paid ? 'Payment received' : 'Pay ' + amount}</h1>
${paid ? '<p>Thank you. You can close this page.</p>' : `<button id="pay" style="height:44px;padding:0 20px;border:0;border-radius:8px;background:#106cd9;color:#fff;font-size:16px;font-weight:600;cursor:pointer">Pay ${amount} (test)</button><p id="msg" role="status"></p>
<script>document.getElementById('pay').onclick=async()=>{const r=await fetch('/api/mock-gateway/${id}/pay',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});document.getElementById('msg').textContent=r.ok?'Payment received. Thank you.':'Could not complete the payment.';if(r.ok)document.getElementById('pay').remove()}</script>`}</body></html>`,
    { headers: { ...HEAD, 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" } });
}
