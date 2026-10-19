/** Sends a one-time code. Real providers (SMS with DLT registration, transactional email) implement this. */
export interface OtpSender {
  send(msg: { channel: 'sms' | 'email'; to: string; code: string }): Promise<void>;
}

export interface MockOtpSender extends OtpSender {
  /** Everything "sent", for tests and the dev console. */
  outbox: { channel: 'sms' | 'email'; to: string; code: string }[];
}

/** Development sender. Nothing leaves the machine. */
export function createMockOtpSender(log: (line: string) => void = console.log): MockOtpSender {
  const outbox: MockOtpSender['outbox'] = [];
  return {
    outbox,
    async send(msg) {
      outbox.push(msg);
      log(`[mock-otp] ${msg.channel} to ${msg.to}: ${msg.code}`);
    },
  };
}

/** Picks the sender from OTP_PROVIDER. Only 'mock' exists until a provider account is approved. */
export function otpSenderFromEnv(env: Record<string, string | undefined> = process.env): OtpSender {
  const provider = env.OTP_PROVIDER ?? 'mock';
  if (provider === 'mock') {
    if (env.NODE_ENV === 'production' && env.KORA_ALLOW_MOCKS !== '1') throw new Error('OTP_PROVIDER=mock is not allowed in production. Set KORA_ALLOW_MOCKS=1 for a staging demo.');
    return createMockOtpSender();
  }
  throw new Error(`Unknown OTP_PROVIDER "${provider}". Real providers need credentials and DLT approval first.`);
}
