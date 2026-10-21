import { CURRENCIES } from '@kora/tax';
import { assertGstinMatchesState, gstinState } from '@kora/tax';
import type { Sql } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { str, ValidationError } from './validation.js';

export interface Address { line1?: string; line2?: string; city?: string; pincode?: string; stateCode?: string }

export interface PartyInput {
  kind: 'customer' | 'vendor' | 'both';
  name: string;
  gstin?: string | null;
  stateCode?: string | null;
  phone?: string | null;
  email?: string | null;
  billingAddress?: Address;
  shippingAddress?: Address | null;
  /** What this customer is usually quoted in. Quotes (estimates, proforma) can use it; tax invoices are always in rupees. */
  currency?: string;
  /** Udyam registration number and class, for vendors that are micro, small or medium enterprises. */
  udyamNumber?: string | null;
  msmeClass?: 'micro' | 'small' | 'medium' | null;
}

export function validateParty(i: PartyInput) {
  const kind = i.kind ?? 'customer';
  if (!['customer', 'vendor', 'both'].includes(kind)) throw new ValidationError('Choose customer, vendor or both.', 'kind');
  const name = str(i.name, 'Name', { required: true, max: 200 })!;
  const gstin = str(i.gstin, 'GSTIN', { max: 15 })?.toUpperCase() ?? null;
  let stateCode = str(i.stateCode, 'State', { max: 2 });
  if (gstin) {
    stateCode = stateCode ?? gstinState(gstin);
    try { assertGstinMatchesState(gstin, stateCode); }
    catch (e) { throw new ValidationError((e as Error).message, 'gstin'); }
  }
  if (!stateCode) throw new ValidationError('Choose the state of the customer.', 'stateCode');
  const phone = str(i.phone, 'Phone', { max: 20 });
  const email = str(i.email, 'Email', { max: 254 })?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('Enter a valid email address.', 'email');
  const currency = String(i.currency ?? 'INR').toUpperCase();
  if (!(CURRENCIES as readonly string[]).includes(currency)) throw new ValidationError('Choose one of the supported currencies.', 'currency');
  const udyamNumber = str(i.udyamNumber, 'Udyam number', { max: 30 })?.toUpperCase() ?? null;
  if (udyamNumber && !/^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/.test(udyamNumber)) throw new ValidationError('Enter the Udyam number like UDYAM-MH-12-0001234.', 'udyamNumber');
  const msmeClass = i.msmeClass ?? null;
  if (msmeClass && !['micro', 'small', 'medium'].includes(msmeClass)) throw new ValidationError('Choose micro, small or medium.', 'msmeClass');
  if (udyamNumber && !msmeClass) throw new ValidationError('Choose whether the vendor is micro, small or medium.', 'msmeClass');
  if (msmeClass && !udyamNumber) throw new ValidationError('Enter the Udyam number of the vendor.', 'udyamNumber');
  return { kind, name, gstin, stateCode, phone, email, currency, udyamNumber, msmeClass, billing: i.billingAddress ?? {}, shipping: i.shippingAddress ?? null };
}

export async function createParty(sql: Sql, t: TenantSession, input: PartyInput): Promise<string> {
  const p = validateParty(input);
  return inTenant(sql, t, 'party.write', async (tx) => {
    const [r] = await tx`
      insert into party (business_id, kind, name, gstin, phone, email, billing_address, shipping_address, state_code, currency, udyam_number, msme_class)
      values (${t.businessId}, ${p.kind}, ${p.name}, ${p.gstin}, ${p.phone}, ${p.email}, ${tx.json(p.billing as any)},
              ${p.shipping ? tx.json(p.shipping as any) : null}, ${p.stateCode}, ${p.currency}, ${p.udyamNumber}, ${p.msmeClass})
      returning id`;
    return r!.id as string;
  });
}

export async function updateParty(sql: Sql, t: TenantSession, id: string, input: PartyInput): Promise<void> {
  const p = validateParty(input);
  await inTenant(sql, t, 'party.write', async (tx) => {
    const r = await tx`
      update party set kind = ${p.kind}, name = ${p.name}, gstin = ${p.gstin}, phone = ${p.phone}, email = ${p.email},
             billing_address = ${tx.json(p.billing as any)}, shipping_address = ${p.shipping ? tx.json(p.shipping as any) : null},
             state_code = ${p.stateCode}, currency = ${p.currency}, udyam_number = ${p.udyamNumber}, msme_class = ${p.msmeClass}
       where id = ${id} returning id`;
    if (r.length === 0) throw new ValidationError('Customer not found.');
  });
}

export async function listParties(sql: Sql, t: TenantSession, f: { q?: string; kind?: string; limit?: number; offset?: number } = {}) {
  return inTenant(sql, t, 'party.read', (tx) => tx`
    select id, kind, name, gstin, phone, email, state_code, currency, billing_address, shipping_address, udyam_number, msme_class
      from party
     where archived_at is null
       and (${f.q ?? null}::text is null or name ilike ${'%' + (f.q ?? '') + '%'} or gstin ilike ${'%' + (f.q ?? '') + '%'})
       and (${f.kind ?? null}::text is null or kind = ${f.kind ?? ''} or kind = 'both')
     order by name limit ${Math.min(f.limit ?? 100, 500)} offset ${f.offset ?? 0}`);
}

export async function getParty(sql: Sql, t: TenantSession, id: string) {
  const rows = await inTenant(sql, t, 'party.read', (tx) => tx`select * from party where id = ${id}`);
  return rows[0] ?? null;
}

export async function archiveParty(sql: Sql, t: TenantSession, id: string): Promise<void> {
  await inTenant(sql, t, 'party.write', (tx) => tx`update party set archived_at = now() where id = ${id}`);
}
