import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Time-based one-time passwords (RFC 6238, SHA-1, 6 digits, 30 second steps), the kind every authenticator app speaks. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Not a valid base32 secret.');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newTotpSecret = (): string => base32Encode(randomBytes(20));

export const totpStep = (nowMs = Date.now()): number => Math.floor(nowMs / 1000 / 30);

/** The code for a time step. */
export function totpAt(secret: string, step: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  const bin = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/**
 * Checks a code against this step and one either side (clock drift). Returns the step that matched, or null.
 * The caller keeps the last step used and refuses anything at or before it, so a code cannot be used twice.
 */
export function verifyTotp(secret: string, code: string, nowMs = Date.now(), window = 1): number | null {
  if (!/^[0-9]{6}$/.test(code)) return null;
  const now = totpStep(nowMs);
  for (let d = -window; d <= window; d++) {
    const step = now + d;
    if (step >= 0 && timingSafeEqual(Buffer.from(totpAt(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}

export const otpauthUri = (secret: string, account: string, issuer = 'Kora') =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// ---------------------------------------------------------------- keeping the secret
const key = (secret: string) => createHash('sha256').update(`kora-mfa-key:${secret}`).digest();

/** AES-256-GCM. The stored value is iv, tag and ciphertext. A database dump alone does not reveal anyone's authenticator secret. */
export function sealSecret(plain: string, appSecret: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(appSecret), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}

export function openSecret(blob: Buffer, appSecret: string): string {
  const d = createDecipheriv('aes-256-gcm', key(appSecret), blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString('utf8');
}

/** Ten single-use recovery codes like 4F9K-2M7Q. Shown once; only their hashes are kept. */
export function newRecoveryCodes(n = 10): string[] {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: n }, () => { const b = randomBytes(8); const s = Array.from(b, (x) => A[x % A.length]).join(''); return `${s.slice(0, 4)}-${s.slice(4)}`; });
}
export const normaliseRecovery = (s: string) => s.replace(/[\s-]/g, '').toUpperCase();
