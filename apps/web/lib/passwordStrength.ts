/** A simple, honest strength guide for the sign-up form. The server only requires 8 characters; this tells people how to do better. */
export type Strength = { score: 0 | 1 | 2 | 3 | 4; label: string; tip: string; ok: boolean };

const COMMON = ['password', 'password1', '12345678', '123456789', '1234567890', 'qwertyui', 'qwerty123', 'iloveyou', 'admin123', 'welcome1', 'letmein1', 'abcd1234', 'india123', 'kora1234', 'password@123', 'pass@123'];

export function passwordStrength(pw: string, personal: string[] = []): Strength {
  if (!pw) return { score: 0, label: '', tip: 'Use at least 8 characters.', ok: false };
  if (pw.length < 8) return { score: 1, label: 'Too short', tip: `Add ${8 - pw.length} more character${8 - pw.length === 1 ? '' : 's'}. A few random words make a good password.`, ok: false };
  const lower = pw.toLowerCase();
  if (COMMON.includes(lower)) return { score: 1, label: 'Too common', tip: 'This is one of the most guessed passwords. Pick something only you would think of.', ok: false };
  const squashed = lower.replace(/[^a-z0-9]/g, '');
  const bits = personal.flatMap((p) => [p.toLowerCase().replace(/[^a-z0-9]/g, ''), ...p.toLowerCase().split(/[^a-z0-9]+/)]).filter((p) => p.length >= 4);
  if (bits.some((p) => squashed.includes(p))) return { score: 1, label: 'Easy to guess', tip: 'Do not use your name, email or phone number in your password.', ok: false };
  if (/^(.)\1+$/.test(pw) || /^(0123|1234|2345|3456|4567|5678|6789|abcd|qwer)/.test(lower) && pw.length < 12) return { score: 1, label: 'Easy to guess', tip: 'Avoid runs like 12345 or the same character repeated.', ok: false };
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  const unique = new Set(pw).size;
  let pts = 0;
  if (pw.length >= 10) pts++;
  if (pw.length >= 14) pts++;
  if (kinds >= 3) pts++;
  if (unique >= 8) pts++;
  if (kinds === 1 && pw.length < 12) pts = Math.min(pts, 1);
  const score = Math.max(2, Math.min(4, 1 + pts)) as 2 | 3 | 4;
  const label = score === 2 ? 'Fair' : score === 3 ? 'Good' : 'Strong';
  const tip = score === 4 ? 'Strong. Keep it somewhere safe.' : score === 3 ? 'Good. A longer password is stronger still.' : 'Fine to use. Make it longer, or mix letters and numbers, to make it stronger.';
  return { score, label, tip, ok: true };
}
