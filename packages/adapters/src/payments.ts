import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface PaymentLinkRequest {
  amountPaise: bigint;
  /** Our reference, echoed back by the gateway: the document id. */
  referenceId: string;
  description: string;
  customer: { name?: string | null; phone?: string | null; email?: string | null };
  expiresAt?: Date;
}
export interface PaymentLink { gatewayLinkId: string; url: string }

export type GatewayEvent =
  | { kind: 'payment_link.paid'; eventId: string; gatewayLinkId: string; gatewayPaymentId: string; amountPaise: bigint; method: string }
  | { kind: 'ignored'; eventId: string; type: string };

/** Razorpay, Cashfree and others sit behind this. A second gateway is one new file. */
export interface PaymentGateway {
  readonly name: string;
  createPaymentLink(req: PaymentLinkRequest): Promise<PaymentLink>;
  /** Verifies the signature and turns the body into an event. Throws WebhookSignatureError when it does not verify. */
  parseWebhook(rawBody: string, headers: Record<string, string | undefined>): GatewayEvent;
}

export class WebhookSignatureError extends Error {
  constructor(message = 'Webhook signature did not verify.') { super(message); this.name = 'WebhookSignatureError'; }
}
export const isWebhookSignatureError = (e: unknown): e is WebhookSignatureError => e instanceof Error && e.name === 'WebhookSignatureError';

const METHODS = new Set(['upi', 'card', 'netbanking', 'wallet', 'emi', 'bank_transfer']);

/** The body shape follows Razorpay's payment_link.paid event, amounts in paise. */
export function mockPaidEventBody(a: { linkId: string; paymentId: string; amountPaise: bigint; method?: string; referenceId?: string }): string {
  return JSON.stringify({
    event: 'payment_link.paid',
    payload: {
      payment_link: { entity: { id: a.linkId, amount: Number(a.amountPaise), reference_id: a.referenceId ?? '' } },
      payment: { entity: { id: a.paymentId, amount: Number(a.amountPaise), method: a.method ?? 'upi' } },
    },
  });
}

export function signMockWebhook(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Development gateway. Links point at a page in our own app that "pays" by sending a signed webhook. */
export function createMockGateway(cfg: { secret: string; baseUrl: string }): PaymentGateway {
  if (cfg.secret.length < 16) throw new Error('Gateway webhook secret must be at least 16 characters');
  return {
    name: 'mock',
    async createPaymentLink() {
      const id = 'plink_' + randomBytes(9).toString('hex');
      return { gatewayLinkId: id, url: `${cfg.baseUrl.replace(/\/$/, '')}/mock-gateway/${id}` };
    },
    parseWebhook(rawBody, headers) {
      const sig = headers['x-mock-signature'] ?? '';
      const want = Buffer.from(signMockWebhook(cfg.secret, rawBody), 'hex');
      const got = Buffer.from(/^[0-9a-f]+$/i.test(sig) ? sig : '', 'hex');
      if (got.length !== want.length || !timingSafeEqual(got, want)) throw new WebhookSignatureError();
      const eventId = headers['x-mock-event-id'];
      if (!eventId) throw new WebhookSignatureError('Missing event id.');
      let body: any;
      try { body = JSON.parse(rawBody); } catch { throw new WebhookSignatureError('Body is not JSON.'); }
      if (body?.event !== 'payment_link.paid') return { kind: 'ignored', eventId, type: String(body?.event ?? 'unknown') };
      const link = body.payload?.payment_link?.entity, pay = body.payload?.payment?.entity;
      if (!link?.id || !pay?.id || !Number.isInteger(pay.amount) || pay.amount <= 0) throw new WebhookSignatureError('Malformed payment event.');
      return {
        kind: 'payment_link.paid', eventId, gatewayLinkId: String(link.id), gatewayPaymentId: String(pay.id),
        amountPaise: BigInt(pay.amount), method: METHODS.has(pay.method) ? pay.method : 'other',
      };
    },
  };
}
