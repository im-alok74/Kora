/** A user-fixable problem with input. The message is safe to show. */
export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
export const isValidationError = (e: unknown): e is ValidationError => e instanceof Error && e.name === 'ValidationError';

export function str(v: unknown, field: string, opts: { max?: number; required?: boolean } = {}): string | null {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (!s) {
    if (opts.required) throw new ValidationError(`${field} is required.`, field);
    return null;
  }
  if (s.length > (opts.max ?? 200)) throw new ValidationError(`${field} is too long.`, field);
  return s;
}

/** Today's date in the business time zone, as YYYY-MM-DD. */
export function todayIn(timezone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
}

export function isDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

/** Someone else changed this draft since the caller last saw it. Carries where to find the current version. */
export class ConflictError extends Error {
  constructor(public documentId: string, public serverRev: number) {
    super('This draft was changed somewhere else since you last opened it.');
    this.name = 'ConflictError';
  }
}
export const isConflictError = (e: unknown): e is ConflictError => e instanceof Error && e.name === 'ConflictError';
