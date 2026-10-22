import { parseRupees } from '@kora/tax';
import type { Sql } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { isDate, str, ValidationError } from './validation.js';
import type { Column } from './registers.js';

const rs = (p: bigint) => `${p < 0n ? '-' : ''}${(p < 0n ? -p : p) / 100n}.${((p < 0n ? -p : p) % 100n).toString().padStart(2, '0')}`;

/** Rupees as typed, optionally with a minus sign, into paise. */
function signedRupees(text: unknown, what: string): bigint {
  const raw = String(text ?? '').trim();
  const neg = raw.startsWith('-');
  try { const v = parseRupees(neg ? raw.slice(1) : raw); return neg ? -v : v; } catch { throw new ValidationError(`${what}: enter an amount in rupees.`, 'amount'); }
}

export interface PartyExtrasInput {
  tags?: string[];
  /** Rupees. Empty or null removes the limit. */
  creditLimit?: string | null;
  /** Rupees, positive if they owed you, negative if you owed them, on the date given. Empty or null clears it. */
  openingBalance?: string | null;
  openingBalanceOn?: string | null;
}

export function cleanTags(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ValidationError('Tags must be a list.', 'tags');
  const tags = [...new Set(raw.map((t) => String(t).trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean))];
  if (tags.length > 10) throw new ValidationError('A party can have at most 10 tags.', 'tags');
  const bad = tags.find((t) => t.length > 30 || !/^[a-z0-9][a-z0-9\-_.&]*$/.test(t));
  if (bad) throw new ValidationError(`The tag "${bad}" should be up to 30 letters, numbers or dashes.`, 'tags');
  return tags;
}

/** Tags, credit limit and opening balance for one customer or vendor. Fields left out are not changed. */
export async function setPartyExtras(sql: Sql, t: TenantSession, id: string, i: PartyExtrasInput): Promise<void> {
  const sets: { tags?: string[]; limit?: bigint | null; opening?: bigint; on?: string | null } = {};
  if (i.tags !== undefined) sets.tags = cleanTags(i.tags);
  if (i.creditLimit !== undefined) {
    const raw = String(i.creditLimit ?? '').trim();
    if (raw === '') sets.limit = null;
    else { const v = signedRupees(raw, 'Credit limit'); if (v < 0n) throw new ValidationError('The credit limit cannot be negative.', 'creditLimit'); sets.limit = v; }
  }
  if (i.openingBalance !== undefined) {
    const raw = String(i.openingBalance ?? '').trim();
    sets.opening = raw === '' ? 0n : signedRupees(raw, 'Opening balance');
    if (sets.opening !== 0n) {
      if (!i.openingBalanceOn || !isDate(i.openingBalanceOn)) throw new ValidationError('Give the date of the opening balance as YYYY-MM-DD.', 'openingBalanceOn');
      sets.on = i.openingBalanceOn;
    } else sets.on = null;
  }
  await inTenant(sql, t, 'party.write', async (tx) => {
    const [p] = await tx`select id from party where id = ${id}`;
    if (!p) throw new ValidationError('Customer not found.');
    if (sets.tags !== undefined) await tx`update party set tags = ${sets.tags} where id = ${id}`;
    if ('limit' in sets) await tx`update party set credit_limit_paise = ${sets.limit === null ? null : sets.limit!.toString()} where id = ${id}`;
    if (sets.opening !== undefined) await tx`update party set opening_balance_paise = ${sets.opening.toString()}, opening_balance_on = ${sets.on ?? null} where id = ${id}`;
  });
}

export async function getPartyExtras(sql: Sql, t: TenantSession, id: string) {
  const rows = await inTenant(sql, t, 'party.read', (tx) => tx`
    select tags, credit_limit_paise::text as credit_limit_paise, opening_balance_paise::text as opening_balance_paise, opening_balance_on::text as opening_balance_on, merged_into
      from party where id = ${id}`);
  if (!rows[0]) throw new ValidationError('Customer not found.');
  return { ...rows[0], credit: await partyCreditStatus(sql, t, id) };
}

// ---------------------------------------------------------------- notes
export async function addPartyNote(sql: Sql, t: TenantSession, partyId: string, body: string) {
  const text = str(body, 'Note', { required: true, max: 2000 })!;
  return inTenant(sql, t, 'party.write', async (tx) => {
    const [p] = await tx`select id from party where id = ${partyId}`;
    if (!p) throw new ValidationError('Customer not found.');
    const [r] = await tx`insert into party_note (business_id, party_id, body, created_by) values (${t.businessId}, ${partyId}, ${text}, ${t.userId}) returning id`;
    return { id: r!.id as string };
  });
}

export async function listPartyNotes(sql: Sql, t: TenantSession, partyId: string) {
  const rows = await inTenant(sql, t, 'party.read', (tx) => tx`
    select n.id, n.body, n.created_at, n.created_by, coalesce(m.display_name, m.email, m.phone, 'Someone who has left') as author
      from party_note n left join list_members() m on m.user_id = n.created_by where n.party_id = ${partyId} order by n.created_at desc`);
  return rows.map((r) => ({ id: r.id as string, body: r.body as string, createdAt: r.created_at as string, author: r.author as string, mine: r.created_by === t.userId }));
}

/** A person can remove their own note, an owner anyone's. */
export async function removePartyNote(sql: Sql, t: TenantSession, partyId: string, noteId: string): Promise<void> {
  await inTenant(sql, t, 'party.write', async (tx) => {
    const [n] = await tx`select created_by from party_note where id = ${noteId} and party_id = ${partyId}`;
    if (!n) throw new ValidationError('Note not found.');
    if (n.created_by !== t.userId && t.role !== 'owner') throw new ValidationError('Only the person who wrote a note, or an owner, can remove it.');
    await tx`delete from party_note where id = ${noteId}`;
  });
}

// ---------------------------------------------------------------- credit limit
/** How much is owed, against the limit. Opening balance counts; money held from advances is taken off. Merged duplicates count with the party. */
export async function partyCreditStatus(sql: Sql, t: TenantSession, partyId: string) {
  return inTenant(sql, t, 'party.read', async (tx) => {
    const [p] = await tx`select credit_limit_paise, opening_balance_paise from party where id = ${partyId}`;
    if (!p) throw new ValidationError('Customer not found.');
    const [r] = await tx`select coalesce(sum(outstanding_paise), 0)::text as o from receivable where party_id in (select party_family(${partyId}))`;
    const [h] = await tx`
      select coalesce(sum(p.amount_paise - coalesce((select sum(a.amount_paise) from payment_allocation a where a.payment_id = p.id), 0)
                                         - coalesce((select sum(x.amount_paise) from payment_refund x where x.payment_id = p.id), 0)), 0)::text as held
        from payment p where p.party_id in (select party_family(${partyId})) and p.method not in ('tds', 'client_money')`;
    const [o] = await tx`select coalesce(sum(opening_balance_paise), 0)::text as o from party where id in (select party_family(${partyId}))`;
    const owed = BigInt(r!.o as string) + BigInt(o!.o as string) - BigInt(h!.held as string);
    const limit = p.credit_limit_paise === null ? null : BigInt(p.credit_limit_paise as string);
    return {
      limitPaise: limit === null ? null : limit.toString(), owedPaise: owed.toString(),
      availablePaise: limit === null ? null : (limit - owed).toString(), over: limit !== null && owed > limit,
    };
  });
}

// ---------------------------------------------------------------- duplicates and merging
const nameKey = (n: string) => n.toLowerCase().replace(/\b(pvt|private|ltd|limited|llp|co|company|inc|the)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const phoneKey = (p: string | null) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : null; };

/** Parties that look like the same one: same GSTIN, same mobile number, same email, or the same name once "Pvt Ltd" and punctuation are ignored. */
export async function findDuplicateParties(sql: Sql, t: TenantSession) {
  const rows = await inTenant(sql, t, 'party.read', (tx) => tx`
    select id, kind, name, gstin, phone, email, created_at from party where archived_at is null and merged_into is null order by created_at`);
  const groups = new Map<string, { reasons: string[]; parties: Record<string, any>[] }>();
  const add = (reason: string, key: string | null, pick: (r: Record<string, any>) => string | null) => {
    if (!key) return;
    const members = rows.filter((r) => pick(r) === key);
    if (members.length < 2) return;
    const sig = members.map((m) => m.id).sort().join(',');
    const g = groups.get(sig) ?? { reasons: [], parties: members };
    if (!g.reasons.includes(reason)) g.reasons.push(reason);
    groups.set(sig, g);
  };
  for (const r of rows) {
    add('same GSTIN', r.gstin ? String(r.gstin).toUpperCase() : null, (x) => (x.gstin ? String(x.gstin).toUpperCase() : null));
    add('same mobile number', phoneKey(r.phone as string | null), (x) => phoneKey(x.phone as string | null));
    add('same email', r.email ? String(r.email).toLowerCase() : null, (x) => (x.email ? String(x.email).toLowerCase() : null));
    add('same name', nameKey(r.name as string) || null, (x) => nameKey(x.name as string) || null);
  }
  return [...groups.values()].map((g) => ({ reason: g.reasons.join(' and ').replace(/^./, (c) => c.toUpperCase()), parties: g.parties.map((p) => ({ id: p.id as string, kind: p.kind as string, name: p.name as string, gstin: p.gstin as string | null, phone: p.phone as string | null, email: p.email as string | null })) }));
}

/**
 * Folds a duplicate into the party that stays. Everything that can move does: drafts, payments, bills, projects, recurring schedules,
 * contact people, addresses and notes. Issued and cancelled documents cannot change hands, so they stay on the old record, which is
 * archived and marked as merged; the account pages and statements of the party that stays read them from there, so the totals are whole.
 */
export async function mergeParties(sql: Sql, t: TenantSession, keepId: string, dropId: string) {
  if (keepId === dropId) throw new ValidationError('Choose two different parties to merge.');
  return inTenant(sql, t, 'party.write', async (tx) => {
    const [a] = await tx`select * from party where id = ${keepId} for update`;
    const [b] = await tx`select * from party where id = ${dropId} for update`;
    if (!a || !b) throw new ValidationError('Customer not found.');
    if (a.merged_into || b.merged_into) throw new ValidationError('One of these has already been merged into another.');
    if (a.archived_at) throw new ValidationError('The party that stays must not be archived.');
    const kind = a.kind === b.kind ? a.kind : 'both';
    const tags = [...new Set([...(a.tags as string[]), ...(b.tags as string[])])].slice(0, 10);
    const opening = BigInt(a.opening_balance_paise as string) + BigInt(b.opening_balance_paise as string);
    const moved: Record<string, number> = {};
    const count = (k: string, r: { count: number }) => { moved[k] = r.count; };
    count('drafts', await tx`update document set party_id = ${keepId} where party_id = ${dropId} and status = 'draft'`);
    count('payments', await tx`update payment set party_id = ${keepId} where party_id = ${dropId}`);
    count('bills', await tx`update purchase_bill set party_id = ${keepId} where party_id = ${dropId}`);
    count('matters', await tx`update matter set party_id = ${keepId} where party_id = ${dropId}`);
    count('recurring', await tx`update recurring_profile set party_id = ${keepId} where party_id = ${dropId}`);
    count('contacts', await tx`update contact_person set party_id = ${keepId}, is_primary = false where party_id = ${dropId}`);
    count('addresses', await tx`update party_address set party_id = ${keepId}, is_default_billing = false, is_default_shipping = false where party_id = ${dropId}`);
    count('notes', await tx`update party_note set party_id = ${keepId} where party_id = ${dropId}`);
    await tx`update portal_link set revoked_at = now() where party_id = ${dropId} and revoked_at is null`;
    await tx`update party set kind = ${kind}, tags = ${tags},
               gstin = coalesce(gstin, null), phone = coalesce(phone, ${b.phone}), email = coalesce(email, ${b.email}),
               udyam_number = coalesce(udyam_number, ${b.udyam_number}), msme_class = coalesce(msme_class, ${b.msme_class}),
               credit_limit_paise = coalesce(credit_limit_paise, ${b.credit_limit_paise}),
               opening_balance_paise = ${opening.toString()}, opening_balance_on = ${opening === 0n ? null : (a.opening_balance_on ?? b.opening_balance_on)}
             where id = ${keepId}`;
    // The duplicate keeps its own GSTIN, phone and so on; it is archived and points at the party that stays.
    await tx`update party set archived_at = now(), merged_into = ${keepId}, opening_balance_paise = 0, opening_balance_on = null where id = ${dropId}`;
    await tx`insert into party_note (business_id, party_id, body, created_by)
             values (${t.businessId}, ${keepId}, ${`Merged with "${String(b.name)}"${b.gstin ? ` (GSTIN ${b.gstin})` : ''}. Its issued documents stay on the old record and are included here.`}, ${t.userId})`;
    return { moved };
  });
}

// ---------------------------------------------------------------- export
export const PARTY_EXPORT_COLUMNS: Column<any>[] = [
  { key: 'name', label: 'Name' }, { key: 'type', label: 'Type' }, { key: 'gstin', label: 'GSTIN' }, { key: 'state_code', label: 'State code' }, { key: 'phone', label: 'Mobile' },
  { key: 'email', label: 'Email' }, { key: 'address', label: 'Address' }, { key: 'city', label: 'City' }, { key: 'pincode', label: 'Pincode' }, { key: 'tags', label: 'Tags' },
  { key: 'credit_limit', label: 'Credit limit (Rs)' }, { key: 'opening_balance', label: 'Opening balance (Rs)' }, { key: 'opening_balance_on', label: 'Opening balance date' },
  { key: 'udyam_number', label: 'Udyam number' }, { key: 'msme_class', label: 'MSME size' },
];

/** Every active customer or vendor, in the same columns the import reads back. */
export async function partiesExport(sql: Sql, t: TenantSession, f: { kind?: 'customer' | 'vendor' } = {}) {
  const rows = await inTenant(sql, t, 'party.read', (tx) => tx`
    select name, kind, gstin, state_code, phone, email, billing_address, tags, credit_limit_paise, opening_balance_paise, opening_balance_on::text as on, udyam_number, msme_class
      from party where archived_at is null and merged_into is null and (${f.kind ?? null}::text is null or kind = ${f.kind ?? ''} or kind = 'both') order by name`);
  return rows.map((r) => ({
    name: r.name as string, type: r.kind as string, gstin: (r.gstin as string | null) ?? '', state_code: r.state_code as string, phone: (r.phone as string | null) ?? '', email: (r.email as string | null) ?? '',
    address: ((r.billing_address as Record<string, string>)?.line1 ?? ''), city: ((r.billing_address as Record<string, string>)?.city ?? ''), pincode: ((r.billing_address as Record<string, string>)?.pincode ?? ''),
    tags: (r.tags as string[]).join(', '), credit_limit: r.credit_limit_paise === null ? '' : rs(BigInt(r.credit_limit_paise as string)),
    opening_balance: BigInt(r.opening_balance_paise as string) === 0n ? '' : rs(BigInt(r.opening_balance_paise as string)), opening_balance_on: (r.on as string | null) ?? '',
    udyam_number: (r.udyam_number as string | null) ?? '', msme_class: (r.msme_class as string | null) ?? '',
  }));
}
