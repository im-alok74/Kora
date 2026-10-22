/** A friendly check of a mobile number or email before anything is sent. The server checks again. Returns "" when it looks fine. */
export function identifierProblem(v: string): string {
  const s = v.trim();
  if (!s) return 'Enter your mobile number or email.';
  if (s.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? '' : 'That email does not look right. Check it for typing mistakes.';
  const digits = s.replace(/[\s()+-]/g, '');
  return /^(91|0)?[6-9][0-9]{9}$/.test(digits) ? '' : 'Enter a valid 10-digit Indian mobile number (it starts with 6, 7, 8 or 9) or an email address.';
}
