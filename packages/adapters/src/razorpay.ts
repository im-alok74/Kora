import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookSignatureError, type GatewayEvent, type PaymentGateway, type PaymentLink, type PaymentLinkRequest } from './payments.js';
import { ProviderError, type Fetch } from './live.js';

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  /** Set in the Razorpay dashboard for the webhook. A different value from the API secret. */
  webhookSecret: string;
  /** Where the customer lands after paying. */
  callbackUrl?: string;
  baseUrl?: string;
  fetch?: Fetch;
}

// Only methods the payment table accepts. Razorpay also reports wallet, emi, paylater, cardless_emi and more: those are stored as 'other',
// because a method the table refuses would roll the webhook back on every retry and the invoice would never show as paid.
const METHODS = new Set(['upi', 'card', 'netbanking', 'bank_transfer']);

/**
 * Razorpay Payment Links. Links are created through the REST API with the key id and secret. The webhook is the only thing that
 * marks an invoice paid: its body is verified with an HMAC-SHA256 of the raw bytes using the webhook secret before it is read.
 * The webhook address to register is {APP_URL}/api/webhooks/razorpay, with the "payment_link.paid" event ticked.
 */
export function createRazorpayGateway(cfg: RazorpayConfig): PaymentGateway {
  if (cfg.webhookSecret.length < 8) throw new Error('RAZORPAY_WEBHOOK_SECRET is too short');
  const f = cfg.fetch ?? fetch;
  const base = (cfg.baseUrl ?? 'https://api.razorpay.com').replace(/\/$/, '');
  return {
    name: 'razorpay',
    async createPaymentLink(req: PaymentLinkRequest): Promise<PaymentLink> {
      const contact = req.customer.phone?.replace(/\D/g, '');
      const body = {
        amount: Number(req.amountPaise), currency: 'INR', accept_partial: false, description: req.description.slice(0, 2000),
        reference_id: req.referenceId.slice(0, 40),
        customer: { ...(req.customer.name ? { name: req.customer.name.slice(0, 100) } : {}), ...(contact ? { contact: contact.length === 10 ? `+91${contact}` : `+${contact}` } : {}), ...(req.customer.email ? { email: req.customer.email } : {}) },
        // Kora sends the link itself, on the customer's channel of choice. Razorpay stays quiet.
        notify: { sms: false, email: false }, reminder_enable: false,
        ...(req.expiresAt ? { expire_by: Math.floor(req.expiresAt.getTime() / 1000) } : {}),
        ...(cfg.callbackUrl ? { callback_url: cfg.callbackUrl, callback_method: 'get' } : {}),
      };
      let res: Response;
      try {
        res = await f(`${base}/v1/payment_links`, {
          method: 'POST', signal: AbortSignal.timeout(15_000),
          headers: { authorization: `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64')}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (e) { throw new ProviderError('Razorpay', `could not be reached (${(e as Error).message})`); }
      const j: any = await res.json().catch(() => null);
      if (!res.ok) throw new ProviderError('Razorpay', String(j?.error?.description ?? res.statusText), res.status);
      if (!j?.id || !j?.short_url) throw new ProviderError('Razorpay', 'the answer had no link');
      return { gatewayLinkId: String(j.id), url: String(j.short_url) };
    },
    parseWebhook(rawBody, headers): GatewayEvent {
      const sig = headers['x-razorpay-signature'] ?? '';
      const want = createHmac('sha256', cfg.webhookSecret).update(rawBody).digest();
      const got = Buffer.from(/^[0-9a-f]+$/i.test(sig) ? sig : '', 'hex');
      if (got.length !== want.length || !timingSafeEqual(got, want)) throw new WebhookSignatureError();
      const eventId = headers['x-razorpay-event-id'];
      if (!eventId) throw new WebhookSignatureError('Missing event id.');
      let body: any;
      try { body = JSON.parse(rawBody); } catch { throw new WebhookSignatureError('Body is not JSON.'); }
      if (body?.event !== 'payment_link.paid') return { kind: 'ignored', eventId, type: String(body?.event ?? 'unknown') };
      const link = body.payload?.payment_link?.entity, pay = body.payload?.payment?.entity;
      // Links are made in rupees. An event in any other currency is kept in the inbox but never booked as rupees.
      const cur = String(pay?.currency ?? link?.currency ?? 'INR').toUpperCase();
      if (cur !== 'INR') return { kind: 'ignored', eventId, type: `payment_link.paid_in_${cur.slice(0, 3)}` };
      if (!link?.id || !pay?.id || !Number.isInteger(pay.amount) || pay.amount <= 0) throw new WebhookSignatureError('Malformed payment event.');
      return { kind: 'payment_link.paid', eventId, gatewayLinkId: String(link.id), gatewayPaymentId: String(pay.id), amountPaise: BigInt(pay.amount), method: METHODS.has(pay.method) ? pay.method : 'other' };
    },
  };
}

/** The signature Razorpay would send for a body. For tests and for replaying an event by hand. */
export const signRazorpayWebhook = (secret: string, rawBody: string) => createHmac('sha256', secret).update(rawBody).digest('hex');
