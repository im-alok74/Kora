/**
 * Decides whether an error is the caller's fault in a way the server can name, so it answers 400 instead of 500:
 * a body that is not valid JSON, or a value Postgres refuses outright (a NUL character, a number too large, a malformed date,
 * a negative LIMIT). Returns the sentence to show, or null when the error is not of this kind.
 * Postgres reports these as class 22 ("data exception"). 22P02 (a malformed id in the address) is handled separately as "not found".
 */
export function badInputMessage(e: unknown): string | null {
  if (e instanceof SyntaxError) return 'The request body is not valid JSON.';
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code.startsWith('22') && code !== '22P02') return 'One of the values is not acceptable. Check the text, numbers and dates you sent.';
  if (code === '2201W' || code === '2201X') return 'One of the values is not acceptable. Check the text, numbers and dates you sent.';
  return null;
}

/** The largest request body any API route accepts. The biggest real one is a 2 MB file sent as base64 (about 2.8 MB). */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
