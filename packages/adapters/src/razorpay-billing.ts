import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { WebhookSignatureError } from './payments.js';
import { ProviderError, type Fetch } from './live.js';

/**
 * Kora's own subscriptions through Razorpay Subscriptions (autopay). Separate from the payment links businesses use to collect from
 * their customers: its own webhook address ({APP_URL}/api/webhooks/razorpay-billing), its own webhook secret, and plans that the
 * owner creates once in the Razorpay dashboard (their ids go in RAZORPAY_PLAN_BUSINESS and RAZORPAY_PLAN_FIRM).
 */
export type BillingEventType = 'subscription.activated' | 'subscription.charged' | 'subscription.pending' | 'subscription.halted' | 'subscription.cancelled' | 'subscription.completed';
export type BillingEvent =
  | { kind: 'subscription'; eventId: string; type: BillingEventType; subscriptionId: string; periodEnd: Date | null; paymentId: string | null; amountPaise: bigint | null }
  | { kind: 'ignored'; eventId: string; type: string };

export interface SubscriptionRequest {
  gatewayPlanId: string;
  /** Billing cycles to authorise. Razorpay needs a count; a large one means "until cancelled". */
  totalCount: number;
  notes: Record<string, string>;
}
export interface Subscription { id: string; url: string }

export interface BillingGateway {
  readonly name: 'razorpay' | 'mock';
  createSubscription(req: SubscriptionRequest): Promise<Subscription>;
  /** atCycleEnd: stop renewing but keep the plan to the end of the paid period. */
  cancelSubscription(id: string, atCycleEnd: boolean): Promise<void>;
  parseWebhook(rawBody: string, headers: Record<string, string | undefined>): BillingEvent;
}

export interface RazorpayBillingConfig { keyId: string; keySecret: string; webhookSecret: string; baseUrl?: string; fetch?: Fetch }

const HANDLED = new Set<string>(['subscription.activated', 'subscription.charged', 'subscription.pending', 'subscription.halted', 'subscription.cancelled', 'subscription.completed']);

function parse(secret: string, rawBody: string, headers: Record<string, string | undefined>, header: string): BillingEvent {
  const sig = headers[header] ?? '';
  const want = createHmac('sha256', secret).update(rawBody).digest();
  const got = Buffer.from(/^[0-9a-f]+$/i.test(sig) ? sig : '', 'hex');
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new WebhookSignatureError();
  const eventId = headers['x-razorpay-event-id'] ?? headers['x-mock-event-id'];
  if (!eventId) throw new WebhookSignatureError('Missing event id.');
  let body: any;
  try { body = JSON.parse(rawBody); } catch { throw new WebhookSignatureError('Body is not JSON.'); }
  const type = String(body?.event ?? 'unknown');
  if (!HANDLED.has(type)) return { kind: 'ignored', eventId, type };
  const sub = body.payload?.subscription?.entity, pay = body.payload?.payment?.entity;
  if (!sub?.id) throw new WebhookSignatureError('Malformed subscription event.');
  const end = Number.isInteger(sub.current_end) && sub.current_end > 0 ? new Date(sub.current_end * 1000) : null;
  // Only a charge in rupees is booked. Razorpay's payment amount is in paise.
  const paid = type === 'subscription.charged' && pay?.id && Number.isInteger(pay.amount) && pay.amount > 0 && String(pay.currency ?? 'INR').toUpperCase() === 'INR';
  return { kind: 'subscription', eventId, type: type as BillingEventType, subscriptionId: String(sub.id), periodEnd: end,
           paymentId: paid ? String(pay.id) : null, amountPaise: paid ? BigInt(pay.amount) : null };
}

export function createRazorpayBilling(cfg: RazorpayBillingConfig): BillingGateway {
  if (cfg.webhookSecret.length < 8) throw new Error('RAZORPAY_BILLING_WEBHOOK_SECRET is too short');
  const f = cfg.fetch ?? fetch;
  const base = (cfg.baseUrl ?? 'https://api.razorpay.com').replace(/\/$/, '');
  const auth = `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString('base64')}`;
  async function call(path: string, body: unknown): Promise<any> {
    let res: Response;
    try {
      res = await f(`${base}${path}`, { method: 'POST', signal: AbortSignal.timeout(15_000), headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) { throw new ProviderError('Razorpay', `could not be reached (${(e as Error).message})`); }
    const j: any = await res.json().catch(() => null);
    if (!res.ok) throw new ProviderError('Razorpay', String(j?.error?.description ?? res.statusText), res.status);
    return j;
  }
  return {
    name: 'razorpay',
    async createSubscription(req) {
      const j = await call('/v1/subscriptions', { plan_id: req.gatewayPlanId, total_count: req.totalCount, quantity: 1, customer_notify: 1, notes: req.notes });
      if (!j?.id || !j?.short_url) throw new ProviderError('Razorpay', 'the answer had no subscription link');
      return { id: String(j.id), url: String(j.short_url) };
    },
    async cancelSubscription(id, atCycleEnd) {
      await call(`/v1/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 });
    },
    parseWebhook: (rawBody, headers) => parse(cfg.webhookSecret, rawBody, headers, 'x-razorpay-signature'),
  };
}

/** Development billing: the "checkout" is a page in our own app; events are signed with a shared secret like the mock gateway's. */
export function createMockBilling(cfg: { secret: string; baseUrl: string }): BillingGateway {
  if (cfg.secret.length < 16) throw new Error('Billing webhook secret must be at least 16 characters');
  return {
    name: 'mock',
    async createSubscription() {
      const id = 'sub_' + randomBytes(9).toString('hex');
      return { id, url: `${cfg.baseUrl.replace(/\/$/, '')}/app/billing?mock_subscription=${id}` };
    },
    async cancelSubscription() { /* nothing at a mock gateway */ },
    parseWebhook: (rawBody, headers) => parse(cfg.secret, rawBody, headers, 'x-mock-signature'),
  };
}

export const signBillingWebhook = (secret: string, rawBody: string) => createHmac('sha256', secret).update(rawBody).digest('hex');

/** The body shape follows Razorpay's subscription events. For tests and for replaying an event by hand. */
export function billingEventBody(a: { type: string; subscriptionId: string; periodEnd?: Date; paymentId?: string; amountPaise?: bigint }): string {
  return JSON.stringify({
    event: a.type,
    payload: {
      subscription: { entity: { id: a.subscriptionId, ...(a.periodEnd ? { current_end: Math.floor(a.periodEnd.getTime() / 1000) } : {}) } },
      ...(a.paymentId ? { payment: { entity: { id: a.paymentId, amount: Number(a.amountPaise ?? 0n), currency: 'INR' } } } : {}),
    },
  });
}
