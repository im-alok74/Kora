import { TaxError } from './money.js';

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The check character for the first 14 characters of a GSTIN (mod-36 weighted sum). */
export function gstinCheckChar(first14: string): string {
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    total += Math.floor(v / 36) + (v % 36);
  }
  return CHARS[(36 - (total % 36)) % 36]!;
}

/** Mirrors gstin_valid() in the database. A test compares the two on random input. */
export function gstinValid(g: string): boolean {
  return PATTERN.test(g) && gstinCheckChar(g) === g[14];
}

/** The first two digits of a GSTIN are the state code. */
export function gstinState(g: string): string {
  return g.slice(0, 2);
}

export function assertGstinMatchesState(gstin: string, stateCode: string): void {
  if (!gstinValid(gstin)) throw new TaxError('gstin_invalid', 'The GSTIN is not valid.');
  if (gstinState(gstin) !== stateCode) {
    throw new TaxError('gstin_state_mismatch', `The GSTIN belongs to state ${gstinState(gstin)}, not ${stateCode}.`);
  }
}
