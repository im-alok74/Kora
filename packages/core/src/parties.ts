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
}

function clean(i: PartyInput) {
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
  return { kind, name, gstin, stateCode, phone, email, billing: i.billingAddress ?? {}, shipping: i.shippingAddress ?? null };
}

export async function createParty(sql: Sql, t: TenantSession, input: PartyInput): Promise<string> {
  const p = clean(input);
  return inTenant(sql, t, 'party.write', async (tx) => {
    const [r] = await tx`
      insert into party (business_id, kind, name, gstin, phone, email, billing_address, shipping_address, state_code)
      values (${t.businessId}, ${p.kind}, ${p.name}, ${p.gstin}, ${p.phone}, ${p.email}, ${tx.json(p.billing as any)},
              ${p.shipping ? tx.json(p.shipping as any) : null}, ${p.stateCode})
      returning id`;
    return r!.id as string;
  });
}

export async function updateParty(sql: Sql, t: TenantSession, id: string, input: PartyInput): Promise<void> {
  const p = clean(input);
  await inTenant(sql, t, 'party.write', async (tx) => {
    const r = await tx`
      update party set kind = ${p.kind}, name = ${p.name}, gstin = ${p.gstin}, phone = ${p.phone}, email = ${p.email},
             billing_address = ${tx.json(p.billing as any)}, shipping_address = ${p.shipping ? tx.json(p.shipping as any) : null},
             state_code = ${p.stateCode}
       where id = ${id} returning id`;
    if (r.length === 0) throw new ValidationError('Customer not found.');
  });
}

export async function listParties(sql: Sql, t: TenantSession, f: { q?: string; kind?: string; limit?: number } = {}) {
  return inTenant(sql, t, 'party.read', (tx) => tx`
    select id, kind, name, gstin, phone, email, state_code, billing_address, shipping_address
      from party
     where archived_at is null
       and (${f.q ?? null}::text is null or name ilike ${'%' + (f.q ?? '') + '%'} or gstin ilike ${'%' + (f.q ?? '') + '%'})
       and (${f.kind ?? null}::text is null or kind = ${f.kind ?? ''} or kind = 'both')
     order by name limit ${Math.min(f.limit ?? 100, 500)}`);
}

export async function getParty(sql: Sql, t: TenantSession, id: string) {
  const rows = await inTenant(sql, t, 'party.read', (tx) => tx`select * from party where id = ${id}`);
  return rows[0] ?? null;
}

export async function archiveParty(sql: Sql, t: TenantSession, id: string): Promise<void> {
  await inTenant(sql, t, 'party.write', (tx) => tx`update party set archived_at = now() where id = ${id}`);
}
