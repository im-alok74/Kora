import { liveMessenger } from './live.js';

/** Sends a document to a customer. Real providers: WhatsApp Business Cloud API, a transactional email service. */
export interface SendResult { providerMessageId: string }

export interface Messenger {
  sendWhatsApp(m: { to: string; text: string; documentUrl: string }): Promise<SendResult>;
  sendEmail(m: { to: string; subject: string; text: string; documentUrl: string }): Promise<SendResult>;
  sendSms(m: { to: string; text: string }): Promise<SendResult>;
}

export interface MockMessenger extends Messenger {
  outbox: ({ channel: 'whatsapp' | 'email' | 'sms'; to: string; text: string; documentUrl?: string })[];
  /** Make the next send fail, to test failure handling. */
  failNext(message?: string): void;
}

export function createMockMessenger(log: (line: string) => void = () => {}): MockMessenger {
  const outbox: MockMessenger['outbox'] = [];
  let failure: string | null = null;
  let n = 0;
  const go = async (channel: 'whatsapp' | 'email' | 'sms', to: string, text: string, documentUrl?: string) => {
    if (failure) { const f = failure; failure = null; throw new Error(f); }
    outbox.push({ channel, to, text, documentUrl });
    log(`[mock-${channel}] to ${to}: ${text}`);
    return { providerMessageId: `mock-${++n}` };
  };
  return {
    outbox,
    failNext(message = 'provider unavailable') { failure = message; },
    sendWhatsApp: (m) => go('whatsapp', m.to, m.text, m.documentUrl),
    sendEmail: (m) => go('email', m.to, m.subject + '\n' + m.text, m.documentUrl),
    sendSms: (m) => go('sms', m.to, m.text),
  };
}

/** The messenger named by MESSENGER. Only the mock exists until a provider is approved; the mock is refused in production unless KORA_ALLOW_MOCKS=1. */
export function messengerFromEnv(env: Record<string, string | undefined> = process.env, log: (line: string) => void = () => {}): Messenger {
  const provider = env.MESSENGER ?? 'mock';
  if (provider === 'live') return liveMessenger(env);
  if (provider !== 'mock') throw new Error(`Unknown MESSENGER "${provider}". Use mock or live.`);
  if (env.NODE_ENV === 'production' && env.KORA_ALLOW_MOCKS !== '1') {
    throw new Error('The mock messenger is not allowed in production. Connect a real provider, or set KORA_ALLOW_MOCKS=1 for a staging demo.');
  }
  return createMockMessenger(log);
}
