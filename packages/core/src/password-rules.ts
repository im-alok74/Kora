/**
 * What the server refuses for a password, on top of the 8 to 128 character length. Not a strength meter (the sign-up form has one):
 * only the passwords that are guessed first. Returns the sentence to show, or null when the password is acceptable.
 */
const BASES = [
  'password', 'passwd', 'welcome', 'letmein', 'qwerty', 'qwertyuiop', 'asdfgh', 'asdfghjkl', 'zxcvbn', 'iloveyou', 'admin', 'administrator', 'login', 'master', 'monkey', 'dragon', 'football',
  'cricket', 'sunshine', 'princess', 'shadow', 'superman', 'batman', 'trustno', 'freedom', 'whatever', 'computer', 'internet', 'secret', 'changeme', 'default', 'guest', 'test', 'testing',
  'india', 'bharat', 'mumbai', 'delhi', 'kora', 'invoice', 'gst', 'abc', 'abcd', 'abcdef', 'abcdefgh', 'aaaa', 'hello', 'helloworld', 'google', 'facebook', 'whatsapp', 'ganesh', 'krishna', 'sachin',
];

/** Common letter-for-symbol swaps, so `P@ssw0rd` is read as `password`. */
const unleet = (s: string) => s.toLowerCase().replace(/[@4]/g, 'a').replace(/0/g, 'o').replace(/\$|5/g, 's').replace(/3/g, 'e').replace(/[1!|]/g, 'i').replace(/7/g, 't');

export function passwordProblem(password: string, personal: string[] = []): string | null {
  const pw = password;
  const lower = pw.toLowerCase();
  if (new Set(pw).size < 4) return 'That password is too simple. Use more than a few different characters.';
  if (/^\d+$/.test(pw) && pw.length < 14) return 'A password made only of digits is too easy to guess. Add letters.';
  const squashed = lower.replace(/[^a-z0-9]/g, '');
  const bits = personal.flatMap((p) => [p.toLowerCase().replace(/[^a-z0-9]/g, ''), ...p.toLowerCase().split(/[^a-z0-9]+/)]).filter((p) => p.length >= 4);
  if (bits.some((p) => squashed.includes(p))) return 'Do not use your name, email address or phone number in your password.';
  // Trailing digits and symbols come off first (password123, Welcome1!), then letter-for-symbol swaps are undone (p@ssw0rd).
  const stem = unleet(lower.replace(/[0-9!@#$%^&*._-]+$/g, '').replace(/^[0-9!@#$%^&*._-]+/g, '')).replace(/[^a-z]+/g, '');
  if (BASES.some((b) => stem === b || (stem.startsWith(b) && stem.length <= b.length + 2) || (b.length >= 5 && stem === b + b))) return 'That is one of the most guessed passwords. Pick something only you would think of.';
  if (/^(?:0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf|zxcv)/.test(lower) && pw.length < 12) return 'Avoid runs like 12345 or abcd. Pick something only you would think of.';
  return null;
}
