import type { Sql } from '@kora/db';
import type { Address } from './parties.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { str, ValidationError } from './validation.js';

export interface ContactPersonInput {
  name: string;
  designation?: string | null;
  email?: string | null;
  phone?: string | null;
  /** The person to write to by default. A party has at most one. */
  isPrimary?: boolean;
}

export interface PartyAddressInput {
  /** What the people in the business call this place, for example "Head office" or "Bhiwandi godown". */
  label: string;
  address?: Address;
  stateCode: string;
  isDefaultBilling?: boolean;
  isDefaultShipping?: boolean;
}

export function validateContactPerson(i: ContactPersonInput) {
  const name = str(i.name, 'Contact name', { required: true, max: 200 })!;
  const designation = str(i.designation, 'Designation', { max: 100 });
  const email = str(i.email, 'Email', { max: 254 })?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('Enter a valid email address.', 'email');
  const phone = str(i.phone, 'Phone', { max: 20 });
  return { name, designation, email, phone, primary: !!i.isPrimary };
}

export function validatePartyAddress(i: PartyAddressInput) {
  const label = str(i.label, 'Label', { required: true, max: 60 })!;
  const stateCode = str(i.stateCode, 'State', { required: true, max: 2 })!;
  if (!/^[0-9]{2}$/.test(stateCode)) throw new ValidationError('Choose the state of this address.', 'stateCode');
  return { label, stateCode, address: i.address ?? {}, billing: !!i.isDefaultBilling, shipping: !!i.isDefaultShipping };
}

/** Both child tables hang off the party by its composite key, so a missing or other-tenant party fails the same way. */
function partyMissing(e: unknown): never {
  if ((e as { code?: string }).code === '23503') throw new ValidationError('Customer not found.', 'partyId');
  throw e as Error;
}

// ---------------------------------------------------------------- contact persons

export async function createContactPerson(sql: Sql, t: TenantSession, partyId: string, input: ContactPersonInput): Promise<string> {
  const c = validateContactPerson(input);
  return inTenant(sql, t, 'party.write', async (tx) => {
    try {
      if (c.primary) await tx`update contact_person set is_primary = false where party_id = ${partyId} and is_primary`;
      const [r] = await tx`insert into contact_person (business_id, party_id, name, designation, email, phone, is_primary)
                           values (${t.businessId}, ${partyId}, ${c.name}, ${c.designation}, ${c.email}, ${c.phone}, ${c.primary}) returning id`;
      return r!.id as string;
    } catch (e) { partyMissing(e); }
  });
}

export async function updateContactPerson(sql: Sql, t: TenantSession, id: string, input: ContactPersonInput): Promise<void> {
  const c = validateContactPerson(input);
  await inTenant(sql, t, 'party.write', async (tx) => {
    if (c.primary) await tx`update contact_person set is_primary = false where is_primary and party_id = (select party_id from contact_person where id = ${id})`;
    const r = await tx`update contact_person set name = ${c.name}, designation = ${c.designation}, email = ${c.email}, phone = ${c.phone}, is_primary = ${c.primary}
                        where id = ${id} and archived_at is null returning id`;
    if (r.length === 0) throw new ValidationError('Contact person not found.');
  });
}

export async function listContactPersons(sql: Sql, t: TenantSession, partyId: string) {
  return inTenant(sql, t, 'party.read', (tx) => tx`
    select id, name, designation, email, phone, is_primary
      from contact_person
     where party_id = ${partyId} and archived_at is null
     order by is_primary desc, name`);
}

export async function archiveContactPerson(sql: Sql, t: TenantSession, id: string): Promise<void> {
  await inTenant(sql, t, 'party.write', async (tx) => {
    // The primary flag goes with the person, so the spot is free for whoever takes over.
    const r = await tx`update contact_person set archived_at = now(), is_primary = false where id = ${id} and archived_at is null returning id`;
    if (r.length === 0) throw new ValidationError('Contact person not found.');
  });
}

export async function setPrimaryContactPerson(sql: Sql, t: TenantSession, partyId: string, id: string): Promise<void> {
  await inTenant(sql, t, 'party.write', async (tx) => {
    await tx`update contact_person set is_primary = false where party_id = ${partyId} and is_primary`;
    const r = await tx`update contact_person set is_primary = true where id = ${id} and party_id = ${partyId} and archived_at is null returning id`;
    if (r.length === 0) throw new ValidationError('Contact person not found.');
  });
}

// ---------------------------------------------------------------- addresses

export async function createPartyAddress(sql: Sql, t: TenantSession, partyId: string, input: PartyAddressInput): Promise<string> {
  const a = validatePartyAddress(input);
  return inTenant(sql, t, 'party.write', async (tx) => {
    try {
      if (a.billing) await tx`update party_address set is_default_billing = false where party_id = ${partyId} and is_default_billing`;
      if (a.shipping) await tx`update party_address set is_default_shipping = false where party_id = ${partyId} and is_default_shipping`;
      const [r] = await tx`insert into party_address (business_id, party_id, label, address, state_code, is_default_billing, is_default_shipping)
                           values (${t.businessId}, ${partyId}, ${a.label}, ${tx.json(a.address as never)}, ${a.stateCode}, ${a.billing}, ${a.shipping}) returning id`;
      return r!.id as string;
    } catch (e) {
      if (String((e as { constraint_name?: string }).constraint_name ?? '').includes('state_code'))
        throw new ValidationError('Choose the state of this address.', 'stateCode');
      partyMissing(e);
    }
  });
}

export async function updatePartyAddress(sql: Sql, t: TenantSession, id: string, input: PartyAddressInput): Promise<void> {
  const a = validatePartyAddress(input);
  await inTenant(sql, t, 'party.write', async (tx) => {
    if (a.billing) await tx`update party_address set is_default_billing = false where is_default_billing and party_id = (select party_id from party_address where id = ${id})`;
    if (a.shipping) await tx`update party_address set is_default_shipping = false where is_default_shipping and party_id = (select party_id from party_address where id = ${id})`;
    try {
      const r = await tx`update party_address set label = ${a.label}, address = ${tx.json(a.address as never)}, state_code = ${a.stateCode},
                                is_default_billing = ${a.billing}, is_default_shipping = ${a.shipping}
                          where id = ${id} and archived_at is null returning id`;
      if (r.length === 0) throw new ValidationError('Address not found.');
    } catch (e) {
      if ((e as { code?: string }).code === '23503') throw new ValidationError('Choose the state of this address.', 'stateCode');
      throw e;
    }
  });
}

export async function listPartyAddresses(sql: Sql, t: TenantSession, partyId: string) {
  return inTenant(sql, t, 'party.read', (tx) => tx`
    select id, label, address, state_code, is_default_billing, is_default_shipping
      from party_address
     where party_id = ${partyId} and archived_at is null
     order by is_default_billing desc, is_default_shipping desc, label`);
}

export async function archivePartyAddress(sql: Sql, t: TenantSession, id: string): Promise<void> {
  await inTenant(sql, t, 'party.write', async (tx) => {
    const r = await tx`update party_address set archived_at = now(), is_default_billing = false, is_default_shipping = false
                        where id = ${id} and archived_at is null returning id`;
    if (r.length === 0) throw new ValidationError('Address not found.');
  });
}

/** Marks one address as where the bill goes, or where the goods go. The party keeps at most one of each. */
export async function setDefaultAddress(sql: Sql, t: TenantSession, partyId: string, id: string, kind: 'billing' | 'shipping'): Promise<void> {
  if (kind !== 'billing' && kind !== 'shipping') throw new ValidationError('Choose billing or shipping.', 'kind');
  await inTenant(sql, t, 'party.write', async (tx) => {
    if (kind === 'billing') await tx`update party_address set is_default_billing = false where party_id = ${partyId} and is_default_billing`;
    else await tx`update party_address set is_default_shipping = false where party_id = ${partyId} and is_default_shipping`;
    const r = kind === 'billing'
      ? await tx`update party_address set is_default_billing = true where id = ${id} and party_id = ${partyId} and archived_at is null returning id`
      : await tx`update party_address set is_default_shipping = true where id = ${id} and party_id = ${partyId} and archived_at is null returning id`;
    if (r.length === 0) throw new ValidationError('Address not found.');
  });
}
