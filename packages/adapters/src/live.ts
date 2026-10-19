import type { OtpSender } from './otp.js';
import type { Messenger, SendResult } from './messenger.js';

/**
 * Real providers, switched on by environment variables. Nothing here runs until the keys exist, and every provider takes an
 * injectable fetch so the exact requests can be tested without calling anyone. Each call has a timeout and any non-2xx answer
 * becomes an error carrying the provider's own message, so the job queue retries and the screen can say why.
 *
 *   SMS         MSG91 (Flow API, needs an approved DLT template)   MSG91_AUTH_KEY, MSG91_OTP_TEMPLATE_ID, MSG91_SMS_TEMPLATE_ID
 *   Email       Resend                                              RESEND_API_KEY, EMAIL_FROM
 *   WhatsApp    Meta WhatsApp Cloud API (approved template)         WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_NAME
 */
export type Fetch = typeof fetch;

export class ProviderError extends Error {
  constructor(public provider: string, message: string, public status?: number) { super(`${provider}: ${message}`); this.name = 'ProviderError'; }
}

async function call(provider: string, f: Fetch, url: string, init: RequestInit, timeoutMs = 15_000): Promise<any> {
  let res: Response;
  try { res = await f(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) { throw new ProviderError(provider, `could not be reached (${(e as Error).message})`); }
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const why = body?.message ?? body?.error?.message ?? body?.error ?? body?.errors?.[0]?.message ?? text.slice(0, 200) ?? res.statusText;
    throw new ProviderError(provider, String(why || res.statusText), res.status);
  }
  return body;
}

/** +919876543210 or 9876543210 to 919876543210, the form MSG91 and WhatsApp want. */
export const digitsOnly = (to: string): string => {
  const d = to.replace(/\D/g, '');
  return d.length === 10 ? `91${d}` : d;
};

// ---------------------------------------------------------------- MSG91
export interface Msg91Config { authKey: string; otpTemplateId?: string; smsTemplateId?: string; otpVar?: string; smsVar?: string; fetch?: Fetch }

export function createMsg91(cfg: Msg91Config) {
  const f = cfg.fetch ?? fetch;
  const flow = async (templateId: string, mobile: string, vars: Record<string, string>): Promise<SendResult> => {
    const b = await call('MSG91', f, 'https://control.msg91.com/api/v5/flow', {
      method: 'POST', headers: { authkey: cfg.authKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ template_id: templateId, short_url: '0', recipients: [{ mobiles: digitsOnly(mobile), ...vars }] }),
    });
    if (b?.type && b.type !== 'success') throw new ProviderError('MSG91', String(b.message ?? 'the message was not accepted'));
    return { providerMessageId: String(b?.message ?? 'msg91') };
  };
  return {
    sendOtp: (to: string, code: string) => {
      if (!cfg.otpTemplateId) throw new ProviderError('MSG91', 'MSG91_OTP_TEMPLATE_ID is not set');
      return flow(cfg.otpTemplateId, to, { [cfg.otpVar ?? 'OTP']: code });
    },
    sendSms: (to: string, text: string) => {
      if (!cfg.smsTemplateId) throw new ProviderError('MSG91', 'MSG91_SMS_TEMPLATE_ID is not set');
      return flow(cfg.smsTemplateId, to, { [cfg.smsVar ?? 'MESSAGE']: text.slice(0, 300) });
    },
  };
}

// ---------------------------------------------------------------- Resend
export interface ResendConfig { apiKey: string; from: string; fetch?: Fetch }

export function createResend(cfg: ResendConfig) {
  const f = cfg.fetch ?? fetch;
  return {
    async send(m: { to: string; subject: string; text: string }): Promise<SendResult> {
      const b = await call('Resend', f, 'https://api.resend.com/emails', {
        method: 'POST', headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: cfg.from, to: [m.to], subject: m.subject, text: m.text }),
      });
      return { providerMessageId: String(b?.id ?? 'resend') };
    },
  };
}

// ---------------------------------------------------------------- WhatsApp Cloud API
export interface WhatsAppConfig { token: string; phoneNumberId: string; templateName: string; language?: string; apiVersion?: string; fetch?: Fetch }

export function createWhatsApp(cfg: WhatsAppConfig) {
  const f = cfg.fetch ?? fetch;
  return {
    /** Business-initiated messages must use an approved template. The template's single variable carries the message and the link. */
    async sendTemplate(to: string, text: string): Promise<SendResult> {
      const b = await call('WhatsApp', f, `https://graph.facebook.com/${cfg.apiVersion ?? 'v20.0'}/${cfg.phoneNumberId}/messages`, {
        method: 'POST', headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to: digitsOnly(to), type: 'template',
          template: { name: cfg.templateName, language: { code: cfg.language ?? 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: text.replace(/\s+/g, ' ').slice(0, 1000) }] }] },
        }),
      });
      return { providerMessageId: String(b?.messages?.[0]?.id ?? 'whatsapp') };
    },
  };
}

// ---------------------------------------------------------------- putting them together
const have = (env: Record<string, string | undefined>, ...names: string[]) => names.every((n) => !!env[n]);

/** Sign-in codes. 'live' sends SMS through MSG91 and email through Resend; each needs its own keys, checked when it is used. */
export function liveOtpSender(env: Record<string, string | undefined>, fetchImpl?: Fetch): OtpSender {
  const sms = have(env, 'MSG91_AUTH_KEY', 'MSG91_OTP_TEMPLATE_ID')
    ? createMsg91({ authKey: env.MSG91_AUTH_KEY!, otpTemplateId: env.MSG91_OTP_TEMPLATE_ID, otpVar: env.MSG91_OTP_VAR, fetch: fetchImpl }) : null;
  const mail = have(env, 'RESEND_API_KEY', 'EMAIL_FROM') ? createResend({ apiKey: env.RESEND_API_KEY!, from: env.EMAIL_FROM!, fetch: fetchImpl }) : null;
  return {
    async send(m) {
      if (m.channel === 'sms') {
        if (!sms) throw new ProviderError('MSG91', 'MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID are not set');
        await sms.sendOtp(m.to, m.code);
      } else {
        if (!mail) throw new ProviderError('Resend', 'RESEND_API_KEY and EMAIL_FROM are not set');
        await mail.send({ to: m.to, subject: 'Your Kora sign-in code', text: `Your Kora sign-in code is ${m.code}. It works once and expires in 10 minutes. If you did not ask for it, ignore this message.` });
      }
    },
  };
}

/** Documents and reminders. A channel whose keys are missing fails with a message that names the missing settings. */
export function liveMessenger(env: Record<string, string | undefined>, fetchImpl?: Fetch): Messenger {
  const wa = have(env, 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TEMPLATE_NAME')
    ? createWhatsApp({ token: env.WHATSAPP_TOKEN!, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!, templateName: env.WHATSAPP_TEMPLATE_NAME!, language: env.WHATSAPP_TEMPLATE_LANG, fetch: fetchImpl }) : null;
  const mail = have(env, 'RESEND_API_KEY', 'EMAIL_FROM') ? createResend({ apiKey: env.RESEND_API_KEY!, from: env.EMAIL_FROM!, fetch: fetchImpl }) : null;
  const sms = have(env, 'MSG91_AUTH_KEY', 'MSG91_SMS_TEMPLATE_ID')
    ? createMsg91({ authKey: env.MSG91_AUTH_KEY!, smsTemplateId: env.MSG91_SMS_TEMPLATE_ID, smsVar: env.MSG91_SMS_VAR, fetch: fetchImpl }) : null;
  return {
    sendWhatsApp(m) {
      if (!wa) throw new ProviderError('WhatsApp', 'WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TEMPLATE_NAME are not set');
      return wa.sendTemplate(m.to, `${m.text} ${m.documentUrl}`);
    },
    sendEmail(m) {
      if (!mail) throw new ProviderError('Resend', 'RESEND_API_KEY and EMAIL_FROM are not set');
      return mail.send({ to: m.to, subject: m.subject, text: `${m.text}\n\n${m.documentUrl}` });
    },
    sendSms(m) {
      if (!sms) throw new ProviderError('MSG91', 'MSG91_AUTH_KEY and MSG91_SMS_TEMPLATE_ID are not set');
      return sms.sendSms(m.to, m.text);
    },
  };
}
