export const maxDuration = 30;
import { getTemplate, paymentReceiptData } from '@kora/core';
import { receiptNumber, renderPdf, renderReceiptHtml, type ReceiptInput } from '@kora/pdf';
import { json, tenantRoute } from '../../../../../lib/server';

export const runtime = 'nodejs';

/** A receipt for one payment, as a PDF. Add ?format=html to get the page itself. */
export const GET = tenantRoute(async ({ t, sql, params, req }) => {
  const data = await paymentReceiptData(sql, t, params.id!);
  if (!data) return json({ error: 'Payment not found.' }, 404);
  const html = renderReceiptHtml({ ...(data as unknown as ReceiptInput), accent: (await getTemplate(sql, t)).accent });
  if (new URL(req.url).searchParams.get('format') === 'html') return json({ html });
  const pdf = await renderPdf(html, 'A5');
  return new Response(new Uint8Array(pdf), {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${receiptNumber(data.payment as unknown as ReceiptInput['payment'])}.pdf"`, 'cache-control': 'no-store' },
  });
});
