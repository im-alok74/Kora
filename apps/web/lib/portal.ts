import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { otpSenderFromEnv, type OtpSender } from '@kora/adapters';
import { portalAccess } from '@kora/core';
import { json, services } from './server';

/** One cookie per portal link, so a customer with accounts at two businesses keeps both. */
export const portalCookie = (token: string) => `kora_portal_${createHash('sha256').update(token).digest('base64url').slice(0, 12)}`;

const g = globalThis as unknown as { __koraPortalOtp?: OtpSender };
export const portalSender = () => (g.__koraPortalOtp ??= otpSenderFromEnv());
export const portalSecret = () => {
  const s = process.env.OTP_HMAC_SECRET;
  if (!s) throw new Error('OTP_HMAC_SECRET is not set (see .env.example)');
  return s;
};
export const portalFixedCode = () => (process.env.KORA_ALLOW_MOCKS === '1' ? process.env.DEMO_FIXED_OTP || undefined : undefined);

export const PORTAL_GONE = { error: 'This link is not valid any more. Ask the business for a new one.' };

/** Returns an answer to send back if this visitor may not see the portal yet, or null to carry on. */
export async function portalGate(token: string): Promise<Response | null> {
  const session = (await cookies()).get(portalCookie(token))?.value ?? null;
  const a = await portalAccess(services().sql, token, session);
  if (a === 'invalid') return json(PORTAL_GONE, 404);
  if (a === 'code_needed') return json({ error: 'Enter the code we send you to open this page.', codeNeeded: true }, 401);
  return null;
}
