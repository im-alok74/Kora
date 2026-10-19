export type Identifier = { channel: 'sms' | 'email'; value: string };

/**
 * Normalises a login identifier. Phones are Indian mobiles stored as +91XXXXXXXXXX (starts 6 to 9).
 * Emails are lowercased. Anything else is rejected, so the same person cannot hold two accounts
 * by typing their number two ways.
 */
export function normaliseIdentifier(raw: string): Identifier {
  const s = raw.trim();
  if (s.includes('@')) {
    const e = s.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) throw new Error('Enter a valid email address.');
    return { channel: 'email', value: e };
  }
  const digits = s.replace(/[\s()-]/g, '');
  const m = /^(?:\+91|91|0)?([6-9][0-9]{9})$/.exec(digits);
  if (!m) throw new Error('Enter a valid 10-digit Indian mobile number.');
  return { channel: 'sms', value: `+91${m[1]}` };
}
