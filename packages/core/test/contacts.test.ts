import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeTestDb, type TestDb } from '@kora/db/src/testing.js';
import {
  addMember, archiveContactPerson, archivePartyAddress, createBusiness, createContactPerson, createParty, createPartyAddress, listContactPersons, listPartyAddresses,
  resolveTenant, setDefaultAddress, setPrimaryContactPerson, updateContactPerson, updatePartyAddress, type TenantSession,
} from '../src/index.js';

let db: TestDb;
let owner: TenantSession, ca: TenantSession, other: TenantSession;
let party: string, otherParty: string;

beforeAll(async () => {
  db = await makeTestDb();
  const mk = async (e: string) => (await db.owner`insert into app_user (email) values (${e}) returning id`)[0]!.id as string;
  const [o, c, x] = [await mk('o@c.test'), await mk('ca@c.test'), await mk('x@c.test')];
  const bid = await createBusiness(db.web, o, { legalName: 'Contact Co', gstin: '27AAPFU0939F1ZV', stateCode: '27', registrationType: 'regular' });
  await addMember(db.web, o, bid, c, 'accountant');
  owner = await resolveTenant(db.web, o, bid); ca = await resolveTenant(db.web, c, bid);
  other = await resolveTenant(db.web, x, await createBusiness(db.web, x, { legalName: 'Other Co', gstin: null, stateCode: '29', registrationType: 'unregistered' }));
  party = await createParty(db.web, owner, { kind: 'customer', name: 'Mehta Traders', stateCode: '27' });
  otherParty = await createParty(db.web, other, { kind: 'customer', name: 'Someone Else', stateCode: '29' });
}, 60_000);
afterAll(async () => { await db?.drop(); });

describe('contact persons', () => {
  it('are listed with the primary one first, and the party keeps its own phone and email', async () => {
    const accounts = await createContactPerson(db.web, owner, party, { name: 'Sunita Rao', designation: 'Accounts', phone: '9820011111', email: 'Sunita@Mehta.test' });
    await createContactPerson(db.web, owner, party, { name: 'Anil Mehta', designation: 'Director' });
    await setPrimaryContactPerson(db.web, owner, party, accounts);
    const list = await listContactPersons(db.web, owner, party);
    expect(list.map((c) => c.name)).toEqual(['Sunita Rao', 'Anil Mehta']);
    expect(list[0]).toMatchObject({ is_primary: true, designation: 'Accounts', email: 'sunita@mehta.test' });
    expect((await db.owner`select phone, email from party where id = ${party}`)[0]).toMatchObject({ phone: null, email: null });
  });

  it('allow only one primary per party, however it is set', async () => {
    const list = await listContactPersons(db.web, owner, party);
    const [sunita, anil] = [list[0]!, list[1]!];
    await createContactPerson(db.web, owner, party, { name: 'Ravi Shah', isPrimary: true });              // a new primary moves the flag
    expect((await listContactPersons(db.web, owner, party)).filter((c) => c.is_primary).map((c) => c.name)).toEqual(['Ravi Shah']);
    await updateContactPerson(db.web, owner, anil.id, { name: 'Anil Mehta', designation: 'Director', isPrimary: true });
    expect((await listContactPersons(db.web, owner, party)).filter((c) => c.is_primary).map((c) => c.name)).toEqual(['Anil Mehta']);
    await setPrimaryContactPerson(db.web, owner, party, sunita.id);
    const primary = (await listContactPersons(db.web, owner, party)).filter((c) => c.is_primary);
    expect(primary.map((c) => c.name)).toEqual(['Sunita Rao']);
    expect((await db.owner`select count(*)::int as n from contact_person where party_id = ${party} and is_primary and archived_at is null`)[0]!.n).toBe(1);
  });

  it('are archived rather than deleted, and give up the primary spot', async () => {
    const primary = (await listContactPersons(db.web, owner, party)).find((c) => c.is_primary)!;
    await archiveContactPerson(db.web, owner, primary.id);
    expect((await listContactPersons(db.web, owner, party)).some((c) => c.id === primary.id)).toBe(false);
    expect((await db.owner`select count(*)::int as n from contact_person where id = ${primary.id}`)[0]!.n).toBe(1);
    await expect(archiveContactPerson(db.web, owner, primary.id)).rejects.toThrow(/not found/);
    const next = (await listContactPersons(db.web, owner, party))[0]!;
    await setPrimaryContactPerson(db.web, owner, party, next.id);                                        // the freed spot can be taken
    expect((await listContactPersons(db.web, owner, party)).filter((c) => c.is_primary)).toHaveLength(1);
  });

  it('refuse a missing name and a bad email', async () => {
    await expect(createContactPerson(db.web, owner, party, { name: '  ' })).rejects.toThrow(/Contact name is required/);
    await expect(createContactPerson(db.web, owner, party, { name: 'X', email: 'not-an-email' })).rejects.toThrow(/valid email address/);
    await expect(createContactPerson(db.web, owner, party, { name: 'x'.repeat(201) })).rejects.toThrow(/too long/);
  });

  it('cannot be written by an accountant, and are invisible across businesses', async () => {
    await expect(createContactPerson(db.web, ca, party, { name: 'No' })).rejects.toThrow();
    expect(await listContactPersons(db.web, ca, party)).not.toHaveLength(0);
    expect(await listContactPersons(db.web, other, party)).toEqual([]);
    await expect(createContactPerson(db.web, other, party, { name: 'Intruder' })).rejects.toThrow(/Customer not found/);
    await expect(createContactPerson(db.web, owner, otherParty, { name: 'Intruder' })).rejects.toThrow(/Customer not found/);
  });
});

describe('the address book', () => {
  it('holds several labelled addresses, each with its own state', async () => {
    const office = await createPartyAddress(db.web, owner, party, { label: 'Head office', stateCode: '27', address: { line1: '12 Linking Road', city: 'Mumbai', pincode: '400050' }, isDefaultBilling: true });
    await createPartyAddress(db.web, owner, party, { label: 'Bhiwandi godown', stateCode: '27', address: { line1: 'Plot 9, MIDC', city: 'Bhiwandi' }, isDefaultShipping: true });
    await createPartyAddress(db.web, owner, party, { label: 'Bengaluru branch', stateCode: '29', address: { city: 'Bengaluru' } });
    const list = await listPartyAddresses(db.web, owner, party);
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ id: office, label: 'Head office', is_default_billing: true, state_code: '27' });
    expect(list.find((a) => a.label === 'Bengaluru branch')).toMatchObject({ state_code: '29', is_default_billing: false, is_default_shipping: false });
    expect((await db.owner`select billing_address from party where id = ${party}`)[0]!.billing_address).toEqual({});
  });

  it('keeps at most one default of each kind', async () => {
    const list = await listPartyAddresses(db.web, owner, party);
    const branch = list.find((a) => a.label === 'Bengaluru branch')!;
    const godown = list.find((a) => a.label === 'Bhiwandi godown')!;
    await setDefaultAddress(db.web, owner, party, branch.id, 'billing');
    await setDefaultAddress(db.web, owner, party, branch.id, 'shipping');
    let now = await listPartyAddresses(db.web, owner, party);
    expect(now.filter((a) => a.is_default_billing).map((a) => a.label)).toEqual(['Bengaluru branch']);
    expect(now.filter((a) => a.is_default_shipping).map((a) => a.label)).toEqual(['Bengaluru branch']);
    await updatePartyAddress(db.web, owner, godown.id, { label: 'Bhiwandi godown', stateCode: '27', isDefaultShipping: true });   // an edit moves the flag too
    now = await listPartyAddresses(db.web, owner, party);
    expect(now.filter((a) => a.is_default_shipping).map((a) => a.label)).toEqual(['Bhiwandi godown']);
    for (const kind of ['is_default_billing', 'is_default_shipping'] as const)
      expect((await db.owner.unsafe(`select count(*)::int as n from party_address where party_id = $1 and ${kind} and archived_at is null`, [party]))[0]!.n).toBe(1);
  });

  it('frees both default spots when an address is archived', async () => {
    const billing = (await listPartyAddresses(db.web, owner, party)).find((a) => a.is_default_billing)!;
    await archivePartyAddress(db.web, owner, billing.id);
    const now = await listPartyAddresses(db.web, owner, party);
    expect(now.some((a) => a.id === billing.id)).toBe(false);
    expect(now.filter((a) => a.is_default_billing)).toHaveLength(0);
    await setDefaultAddress(db.web, owner, party, now[0]!.id, 'billing');
    expect((await listPartyAddresses(db.web, owner, party)).filter((a) => a.is_default_billing)).toHaveLength(1);
  });

  it('refuses a missing label, a missing state and a state that does not exist', async () => {
    await expect(createPartyAddress(db.web, owner, party, { label: '   ', stateCode: '27' })).rejects.toThrow(/Label is required/);
    await expect(createPartyAddress(db.web, owner, party, { label: 'Nowhere', stateCode: '' })).rejects.toThrow(/State is required/);
    await expect(createPartyAddress(db.web, owner, party, { label: 'Nowhere', stateCode: '88' })).rejects.toThrow(/state of this address/);
    await expect(setDefaultAddress(db.web, owner, party, (await listPartyAddresses(db.web, owner, party))[0]!.id, 'postal' as never)).rejects.toThrow(/billing or shipping/);
  });

  it('stays inside its business', async () => {
    expect(await listPartyAddresses(db.web, other, party)).toEqual([]);
    await expect(createPartyAddress(db.web, other, party, { label: 'Intruder', stateCode: '29' })).rejects.toThrow(/Customer not found/);
    const mine = (await listPartyAddresses(db.web, owner, party))[0]!;
    await expect(setDefaultAddress(db.web, other, otherParty, mine.id, 'billing')).rejects.toThrow(/Address not found/);
    await expect(archivePartyAddress(db.web, other, mine.id)).rejects.toThrow(/Address not found/);
    await expect(createPartyAddress(db.web, ca, party, { label: 'No', stateCode: '27' })).rejects.toThrow();
  });
});
