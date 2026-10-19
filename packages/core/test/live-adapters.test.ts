import { describe, expect, it } from 'vitest';
import {
  createRazorpayGateway, createMsg91, createResend, createWhatsApp, digitsOnly, isWebhookSignatureError, liveMessenger, liveOtpSender, messengerFromEnv,
  otpSenderFromEnv, ProviderError, signRazorpayWebhook, mockPaidEventBody,
} from '@kora/adapters';

type Call = { url: string; method?: string; headers: Record<string, string>; body: any };
/** A fetch that records the request and answers with whatever is given. */
function fakeFetch(answer: { status?: number; body?: unknown } = {}) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : null });
    const status = answer.status ?? 200;
    return { ok: status >= 200 && status < 300, status, statusText: 'x', text: async () => JSON.stringify(answer.body ?? {}), json: async () => answer.body ?? {} };
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('phone numbers', () => {
  it('turns every usual way of writing an Indian number into digits with the country code', () => {
    expect(digitsOnly('+919876543210')).toBe('919876543210');
    expect(digitsOnly('98765 43210')).toBe('919876543210');
    expect(digitsOnly('919876543210')).toBe('919876543210');
  });
});

describe('MSG91', () => {
  it('sends a sign-in code through the Flow API with the template and the code', async () => {
    const { f, calls } = fakeFetch({ body: { type: 'success', message: 'req-1' } });
    const r = await createMsg91({ authKey: 'KEY', otpTemplateId: 'T1', fetch: f }).sendOtp('+919876543210', '482913');
    expect(r.providerMessageId).toBe('req-1');
    expect(calls[0]).toMatchObject({ url: 'https://control.msg91.com/api/v5/flow', method: 'POST', headers: { authkey: 'KEY' } });
    expect(calls[0]!.body).toEqual({ template_id: 'T1', short_url: '0', recipients: [{ mobiles: '919876543210', OTP: '482913' }] });
  });
  it('treats a type of error in a 200 answer as a failure, and carries the provider message', async () => {
    const { f } = fakeFetch({ body: { type: 'error', message: 'Template not approved' } });
    await expect(createMsg91({ authKey: 'K', otpTemplateId: 'T', fetch: f }).sendOtp('9876543210', '123456')).rejects.toThrow(/Template not approved/);
    const bad = fakeFetch({ status: 401, body: { message: 'Authentication failure' } });
    await expect(createMsg91({ authKey: 'K', smsTemplateId: 'T', fetch: bad.f }).sendSms('9876543210', 'hi')).rejects.toThrow(/MSG91: Authentication failure/);
  });
  it('names the missing setting', () => {
    expect(() => createMsg91({ authKey: 'K' }).sendOtp('9876543210', '1')).toThrow(/MSG91_OTP_TEMPLATE_ID/);
  });
});

describe('Resend and WhatsApp', () => {
  it('sends email with the key in a bearer header', async () => {
    const { f, calls } = fakeFetch({ body: { id: 'em_1' } });
    const r = await createResend({ apiKey: 're_key', from: 'Kora <billing@example.com>', fetch: f }).send({ to: 'a@b.test', subject: 'Invoice', text: 'Hello' });
    expect(r.providerMessageId).toBe('em_1');
    expect(calls[0]).toMatchObject({ url: 'https://api.resend.com/emails', headers: { authorization: 'Bearer re_key' } });
    expect(calls[0]!.body).toEqual({ from: 'Kora <billing@example.com>', to: ['a@b.test'], subject: 'Invoice', text: 'Hello' });
  });
  it('sends a WhatsApp template message with the text and link as its one variable', async () => {
    const { f, calls } = fakeFetch({ body: { messages: [{ id: 'wamid.1' }] } });
    const r = await createWhatsApp({ token: 'T', phoneNumberId: '123', templateName: 'invoice_share', fetch: f }).sendTemplate('+91 98765 43210', 'Invoice\nINV/1  due\n https://x.test/i/abc');
    expect(r.providerMessageId).toBe('wamid.1');
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v20.0/123/messages');
    expect(calls[0]!.body).toMatchObject({ messaging_product: 'whatsapp', to: '919876543210', type: 'template', template: { name: 'invoice_share', language: { code: 'en' } } });
    expect(calls[0]!.body.template.components[0].parameters[0].text).toBe('Invoice INV/1 due https://x.test/i/abc');
  });
  it('reads the provider\'s own error text', async () => {
    const { f } = fakeFetch({ status: 400, body: { error: { message: 'Recipient phone number not in allowed list' } } });
    await expect(createWhatsApp({ token: 'T', phoneNumberId: '1', templateName: 'x', fetch: f }).sendTemplate('9876543210', 'hi')).rejects.toThrow(/not in allowed list/);
  });
  it('reports a network failure as a provider error, not a crash', async () => {
    const f = (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    const e = await createResend({ apiKey: 'k', from: 'a@b.test', fetch: f }).send({ to: 'x@y.test', subject: 's', text: 't' }).catch((x) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.message).toMatch(/could not be reached \(ECONNRESET\)/);
  });
});

describe('choosing providers from the environment', () => {
  it('uses the live providers when asked, and names what is missing at the moment of use', async () => {
    const otp = liveOtpSender({});
    await expect(otp.send({ channel: 'sms', to: '+919876543210', code: '123456' })).rejects.toThrow(/MSG91_AUTH_KEY/);
    await expect(otp.send({ channel: 'email', to: 'a@b.test', code: '123456' })).rejects.toThrow(/RESEND_API_KEY/);
    const m = liveMessenger({});
    expect(() => m.sendWhatsApp({ to: '1', text: 't', documentUrl: 'u' })).toThrow(/WHATSAPP_TOKEN/);
    expect(otpSenderFromEnv({ OTP_PROVIDER: 'live' })).toBeDefined();
    expect(messengerFromEnv({ MESSENGER: 'live' })).toBeDefined();
    expect(() => otpSenderFromEnv({ OTP_PROVIDER: 'carrier-pigeon' })).toThrow(/mock or live/);
    expect(() => messengerFromEnv({ MESSENGER: 'x' })).toThrow(/mock or live/);
  });
  it('still refuses the mocks in production unless told otherwise', () => {
    expect(() => messengerFromEnv({ NODE_ENV: 'production' })).toThrow(/not allowed in production/);
    expect(() => otpSenderFromEnv({ NODE_ENV: 'production' })).toThrow(/not allowed in production/);
    expect(messengerFromEnv({ NODE_ENV: 'production', MESSENGER: 'live' })).toBeDefined();
  });
});

describe('Razorpay', () => {
  const cfg = { keyId: 'rzp_test_1', keySecret: 'secret', webhookSecret: 'whsec_12345678' };
  it('creates a payment link with basic auth, the amount in paise, and no notifications of its own', async () => {
    const { f, calls } = fakeFetch({ body: { id: 'plink_abc', short_url: 'https://rzp.io/i/abc' } });
    const g = createRazorpayGateway({ ...cfg, callbackUrl: 'https://kora.test/pay/thanks', fetch: f });
    const l = await g.createPaymentLink({ amountPaise: 118000n, referenceId: '3f2b9a6e-0000-4000-8000-000000000001', description: 'INV/26-27/0001', customer: { name: 'Asha Stores', phone: '9876543210', email: 'a@b.test' }, expiresAt: new Date('2026-12-01T00:00:00Z') });
    expect(l).toEqual({ gatewayLinkId: 'plink_abc', url: 'https://rzp.io/i/abc' });
    expect(calls[0]!.url).toBe('https://api.razorpay.com/v1/payment_links');
    expect(calls[0]!.headers.authorization).toBe(`Basic ${Buffer.from('rzp_test_1:secret').toString('base64')}`);
    expect(calls[0]!.body).toMatchObject({
      amount: 118000, currency: 'INR', accept_partial: false, reference_id: '3f2b9a6e-0000-4000-8000-000000000001', notify: { sms: false, email: false },
      customer: { name: 'Asha Stores', contact: '+919876543210', email: 'a@b.test' }, expire_by: 1796083200, callback_url: 'https://kora.test/pay/thanks',
    });
  });
  it('carries Razorpay\'s error description when a link cannot be made', async () => {
    const { f } = fakeFetch({ status: 400, body: { error: { description: 'The amount must be at least INR 1.00' } } });
    await expect(createRazorpayGateway({ ...cfg, fetch: f }).createPaymentLink({ amountPaise: 50n, referenceId: 'r', description: 'd', customer: {} })).rejects.toThrow(/at least INR 1.00/);
  });
  it('verifies the webhook signature over the raw body, then reads a paid event', () => {
    const g = createRazorpayGateway(cfg);
    const body = mockPaidEventBody({ linkId: 'plink_abc', paymentId: 'pay_1', amountPaise: 118000n, method: 'upi' });
    const ok = g.parseWebhook(body, { 'x-razorpay-signature': signRazorpayWebhook(cfg.webhookSecret, body), 'x-razorpay-event-id': 'evt_1' });
    expect(ok).toEqual({ kind: 'payment_link.paid', eventId: 'evt_1', gatewayLinkId: 'plink_abc', gatewayPaymentId: 'pay_1', amountPaise: 118000n, method: 'upi' });
  });
  it('rejects a wrong or missing signature, a body changed after signing, and a missing event id', () => {
    const g = createRazorpayGateway(cfg);
    const body = mockPaidEventBody({ linkId: 'l', paymentId: 'p', amountPaise: 100n });
    const sig = signRazorpayWebhook(cfg.webhookSecret, body);
    const tryIt = (b: string, h: Record<string, string>) => { try { g.parseWebhook(b, h); return null; } catch (e) { return isWebhookSignatureError(e) ? 'refused' : String(e); } };
    expect(tryIt(body, { 'x-razorpay-event-id': 'e' })).toBe('refused');
    expect(tryIt(body, { 'x-razorpay-signature': 'deadbeef', 'x-razorpay-event-id': 'e' })).toBe('refused');
    expect(tryIt(body.replace('100', '999'), { 'x-razorpay-signature': sig, 'x-razorpay-event-id': 'e' })).toBe('refused');
    expect(tryIt(body, { 'x-razorpay-signature': signRazorpayWebhook('another-secret', body), 'x-razorpay-event-id': 'e' })).toBe('refused');
    expect(tryIt(body, { 'x-razorpay-signature': sig })).toBe('refused');
  });
  it('ignores events it does not act on, and maps unknown methods to other', () => {
    const g = createRazorpayGateway(cfg);
    const other = JSON.stringify({ event: 'payment.failed', payload: {} });
    expect(g.parseWebhook(other, { 'x-razorpay-signature': signRazorpayWebhook(cfg.webhookSecret, other), 'x-razorpay-event-id': 'e2' })).toEqual({ kind: 'ignored', eventId: 'e2', type: 'payment.failed' });
    const odd = mockPaidEventBody({ linkId: 'l', paymentId: 'p', amountPaise: 100n, method: 'paylater' });
    expect(g.parseWebhook(odd, { 'x-razorpay-signature': signRazorpayWebhook(cfg.webhookSecret, odd), 'x-razorpay-event-id': 'e3' })).toMatchObject({ method: 'other' });
  });
});
