import { gstinCheckChar, gstinValid, STATE_NAMES } from '@kora/tax';

/** The fourth letter of a PAN says what kind of taxpayer it belongs to. */
export const PAN_HOLDER: Readonly<Record<string, string>> = {
  P: 'Individual', C: 'Company', H: 'Hindu Undivided Family', F: 'Firm or LLP', A: 'Association of Persons', T: 'Trust',
  B: 'Body of Individuals', L: 'Local authority', J: 'Artificial juridical person', G: 'Government',
};

export type GstinReport = {
  gstin: string;
  valid: boolean;
  /** Plain sentences, one per thing that is wrong. Empty when valid. */
  problems: string[];
  /** What can be read from the number. Filled in as far as the text allows. */
  state?: { code: string; name: string };
  pan?: string;
  holder?: string;
  entity?: string;
  checkChar?: { found: string; expected: string };
};

/** Tidies what a person pasted: no spaces or dashes, capital letters. */
export const cleanGstin = (s: string) => s.replace(/[\s\-_.]/g, '').toUpperCase();

/**
 * Reads a GSTIN. Validity is the engine's own `gstinValid`; everything else here only explains why a number fails
 * and what a good number says. It cannot tell whether the number is registered: only the GST portal can.
 */
export function inspectGstin(raw: string): GstinReport {
  const gstin = cleanGstin(raw);
  const problems: string[] = [];
  const r: GstinReport = { gstin, valid: false, problems };
  if (!gstin) { problems.push('Enter a GSTIN. It has 15 letters and digits.'); return r; }
  if (!/^[0-9A-Z]+$/.test(gstin)) problems.push('A GSTIN has only letters and digits. Remove any other symbol.');
  if (gstin.length !== 15) problems.push(`A GSTIN has 15 characters. This one has ${gstin.length}.`);
  const code = gstin.slice(0, 2);
  if (/^\d{2}$/.test(code)) {
    if (STATE_NAMES[code]) r.state = { code, name: STATE_NAMES[code]! };
    else problems.push(`${code} is not a GST state code.`);
  } else if (gstin.length >= 2) problems.push('The first two characters must be the state code, two digits.');
  const pan = gstin.slice(2, 12);
  if (pan.length === 10) {
    if (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
      r.pan = pan;
      r.holder = PAN_HOLDER[pan[3]!];
      if (!r.holder) problems.push(`The fourth letter of the PAN (${pan[3]}) is not a known holder type.`);
    } else problems.push('Characters 3 to 12 must be a PAN: five letters, four digits, then a letter.');
  }
  if (gstin.length >= 13) {
    if (/^[1-9A-Z]$/.test(gstin[12]!)) r.entity = gstin[12]!;
    else problems.push('The 13th character is the registration number for this PAN in the state. It cannot be 0.');
  }
  if (gstin.length >= 14 && gstin[13] !== 'Z') problems.push('The 14th character must be the letter Z.');
  if (gstin.length === 15 && /^[0-9A-Z]{15}$/.test(gstin)) {
    const expected = gstinCheckChar(gstin.slice(0, 14));
    r.checkChar = { found: gstin[14]!, expected };
    if (expected !== gstin[14]) problems.push(`The last character (check character) should be ${expected}, not ${gstin[14]}. A digit may have been mistyped.`);
  }
  r.valid = gstinValid(gstin);
  if (!r.valid && problems.length === 0) problems.push('This is not a valid GSTIN.');
  return r;
}
