import { assertGstinMatchesState } from '@kora/tax';
import type { Sql } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { str, ValidationError } from './validation.js';
import type { Address } from './parties.js';

export async function getBusiness(sql: Sql, t: TenantSession) {
  const rows = await inTenant(sql, t, 'document.read', (tx) => tx`
    select id, legal_name, trade_name, gstin, registration_type, state_code, turnover_band, address, phone, email,
           upi_vpa, bank_details, timezone, default_currency, einvoice_enabled, crossed_einvoice_threshold, default_notes, default_terms
      from business where id = ${t.businessId}`);
  return rows[0]!;
}

export interface BusinessProfileInput {
  legalName: string; tradeName?: string | null; gstin?: string | null; address?: Address; phone?: string | null;
  email?: string | null; upiVpa?: string | null;
  bank?: { accountName?: string; accountNumber?: string; ifsc?: string; bankName?: string };
  turnoverBand?: 'under_5cr' | 'over_5cr';
  /** Has aggregate turnover crossed the e-invoice limit in any year since 2017-18? Once true, it stays a reason to e-invoice. */
  crossedThreshold?: boolean;
  einvoiceEnabled?: boolean;
  /** Prefilled on every new document. Send an empty string to clear; leave out to keep what is there. */
  defaultNotes?: string | null;
  defaultTerms?: string | null;
}

export async function updateBusinessProfile(sql: Sql, t: TenantSession, i: BusinessProfileInput): Promise<void> {
  const legalName = str(i.legalName, 'Legal name', { required: true })!;
  const gstin = str(i.gstin, 'GSTIN', { max: 15 })?.toUpperCase() ?? null;
  const upi = str(i.upiVpa, 'UPI ID', { max: 100 });
  if (upi && !/^[a-zA-Z0-9._-]{2,100}@[a-zA-Z]{2,64}$/.test(upi)) throw new ValidationError('Enter a UPI ID like name@bank.', 'upiVpa');
  const ifsc = str(i.bank?.ifsc, 'IFSC', { max: 11 })?.toUpperCase();
  if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new ValidationError('IFSC is 11 characters, like HDFC0001234.', 'ifsc');
  const notesIn = i.defaultNotes === undefined ? null : str(i.defaultNotes ?? '', 'Default notes', { max: 2000 }) ?? '';
  const termsIn = i.defaultTerms === undefined ? null : str(i.defaultTerms ?? '', 'Default terms', { max: 2000 }) ?? '';
  const band = i.turnoverBand ?? null;
  if (band && !['under_5cr', 'over_5cr'].includes(band)) throw new ValidationError('Choose a turnover band.', 'turnoverBand');
  await inTenant(sql, t, 'settings.write', async (tx) => {
    if (gstin) {
      const [b] = await tx`select state_code from business where id = ${t.businessId}`;
      try { assertGstinMatchesState(gstin, b!.state_code as string); } catch (e) { throw new ValidationError((e as Error).message, 'gstin'); }
    }
    try {
      await tx`update business set legal_name = ${legalName}, trade_name = ${str(i.tradeName, 'Trade name')}, gstin = coalesce(${gstin}, gstin),
               address = ${tx.json((i.address ?? {}) as any)}, phone = ${str(i.phone, 'Phone', { max: 20 })},
               email = ${str(i.email, 'Email', { max: 254 })?.toLowerCase() ?? null}, upi_vpa = ${upi},
               bank_details = ${tx.json({ accountName: str(i.bank?.accountName, 'Account name'), accountNumber: str(i.bank?.accountNumber, 'Account number', { max: 30 }),
                                          ifsc: ifsc ?? null, bankName: str(i.bank?.bankName, 'Bank name') } as any)},
               turnover_band = coalesce(${band}, turnover_band),
               crossed_einvoice_threshold = coalesce(${i.crossedThreshold ?? null}, crossed_einvoice_threshold),
               einvoice_enabled = coalesce(${i.einvoiceEnabled ?? null}, einvoice_enabled),
               default_notes = case when ${notesIn}::text is null then default_notes else nullif(${notesIn ?? ''}, '') end,
               default_terms = case when ${termsIn}::text is null then default_terms else nullif(${termsIn ?? ''}, '') end
               where id = ${t.businessId}`;
    } catch (e) {
      const c = (e as { code?: string }).code;
      if (c === '23505') throw new ValidationError('A business with that GSTIN already exists.', 'gstin');
      if (c === '23514') throw new ValidationError('The GSTIN or registration type is not consistent.', 'gstin');
      if (c === '23000' || c === '23001') throw new ValidationError('GSTIN and state cannot change after documents are issued.', 'gstin');
      throw e;
    }
  });
}
