import { randomBytes } from 'node:crypto';
import { applyGatewayEvent } from '@kora/core';
import { mockPaidEventBody, signMockWebhook } from '@kora/adapters';
import { json, services } from '../../../../../lib/server';

/** Demo only: acts as the gateway's checkout page and sends our own webhook, signed, through the real handler. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === 'production' && process.env.KORA_ALLOW_MOCKS !== '1') return json({ error: 'Not found.' }, 404);
  const { id } = await ctx.params;
  if (!/^plink_[0-9a-f]{18}$/.test(id)) return json({ error: 'Not found.' }, 404);
  const svc = services();
  const [link] = await svc.sql`select * from lookup_payment_link('mock', ${id})`;
  if (!link) return json({ error: 'Not found.' }, 404);
  if (link.status !== 'created') return json({ error: 'This link has already been paid.' }, 409);
  const body = mockPaidEventBody({ linkId: id, paymentId: 'pay_' + randomBytes(8).toString('hex'), amountPaise: BigInt(link.amount_paise as string) });
  const eventId = 'evt_' + randomBytes(8).toString('hex');
  const evt = svc.gateway.parseWebhook(body, { 'x-mock-signature': signMockWebhook(svc.gatewaySecret, body), 'x-mock-event-id': eventId });
  await applyGatewayEvent(svc.sql, 'mock', evt, JSON.parse(body));
  return json({ ok: true });
}
