import { TaxError } from './money.js';

/**
 * Slabs, in basis points of a percent (1800 = 18.00%). A starting list only: a practising CA
 * must confirm it before beta. Callers can pass their own list to the compute functions.
 */
export const DEFAULT_ALLOWED_RATE_BP: ReadonlySet<number> = new Set([0, 25, 300, 500, 1200, 1800, 2800, 4000]);

export type SupplyKind = 'goods' | 'service';

/**
 * Where the supply is deemed to happen, as a state code.
 * Goods: the ship-to state, else the bill-to state. Services: the recipient's registered state,
 * else the state of their address. Export (96) is not modelled until v1.5.
 */
export function resolvePlaceOfSupply(a: {
  kind: SupplyKind; billToState: string; shipToState?: string | null; recipientRegisteredState?: string | null;
}): string {
  const s = a.kind === 'goods'
    ? (a.shipToState || a.billToState)
    : (a.recipientRegisteredState || a.billToState);
  if (s === '96') throw new TaxError('unsupported_place_of_supply', 'Exports are not supported yet.');
  return s;
}

export type TurnoverBand = 'under_5cr' | 'over_5cr';
export interface HsnPolicy {
  minDigits: Record<TurnoverBand, number>;
  /** 'reject' stops issue; 'warn' lets it through with a message. Set by the CA-approved config. */
  onShort: 'reject' | 'warn';
}
export const DEFAULT_HSN_POLICY: HsnPolicy = { minDigits: { under_5cr: 4, over_5cr: 6 }, onShort: 'reject' };

export function checkHsn(hsn: string | null | undefined, band: TurnoverBand, policy: HsnPolicy = DEFAULT_HSN_POLICY):
  { ok: true } | { ok: false; level: 'error' | 'warn'; message: string } {
  const min = policy.minDigits[band];
  if (hsn && /^[0-9]{4,8}$/.test(hsn) && hsn.length >= min) return { ok: true };
  const message = `HSN or SAC needs at least ${min} digits for this turnover band.`;
  return { ok: false, level: policy.onShort === 'reject' ? 'error' : 'warn', message };
}

/** Prefix plus number: max 16 characters, only letters, digits, slash and hyphen (GST rule 46). */
export function validateInvoiceNumber(number: string): void {
  if (number.length > 16) throw new TaxError('number_too_long', 'An invoice number can have at most 16 characters.');
  if (!/^[A-Za-z0-9/-]+$/.test(number)) {
    throw new TaxError('number_bad_characters', 'An invoice number can only use letters, digits, / and -.');
  }
}

/** GST state and territory codes. A test checks this against the database seed so they cannot drift. */
export const STATE_NAMES: Readonly<Record<string, string>> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
  '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep',
  '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana',
  '37': 'Andhra Pradesh', '38': 'Ladakh', '96': 'Other Country', '97': 'Other Territory', '99': 'Centre Jurisdiction',
};
