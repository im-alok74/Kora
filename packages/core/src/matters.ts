import { randomUUID } from 'node:crypto';
import { parseRupees } from '@kora/tax';
import type { Sql } from '@kora/db';
import { saveDraft, type LineIn } from './documents.js';
import { can, ForbiddenError } from './permissions.js';
import { recordPayment } from './payments.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { isDate, str, todayIn, ValidationError } from './validation.js';

const rs = (p: bigint | string | number) => { const n = BigInt(p); return `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`; };
const paise = (v: unknown, field: string): bigint => {
  try { return parseRupees(String(v ?? '')); } catch { throw new ValidationError('Enter the amount in rupees.', field); }
};

/**
 * "1:30", "1h 30m", "90m", "45 min" or plain hours like "1.5". Returns whole minutes, from 1 minute to 24 hours.
 * A bare number is hours, so "2" is two hours and "90" is refused: write "90m" for minutes.
 */
export function parseDuration(input: string): number {
  const s = String(input ?? '').trim().toLowerCase();
  let min: number | null = null;
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{1,2}):([0-5]?\d)$/))) min = Number(m[1]) * 60 + Number(m[2]);
  else if ((m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:ute)?s?)?)?$/)) && (m[1] || m[2])) min = Math.round(Number(m[1] ?? 0) * 60) + Number(m[2] ?? 0);
  else if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) min = Math.round(Number(m[1]) * 60);
  if (min === null || !Number.isFinite(min) || min < 1 || min > 1440) throw new ValidationError('Enter the time as 1:30, 1h 30m, 90m or 1.5 (hours). It must be between 1 minute and 24 hours.', 'duration');
  return min;
}
export const formatDuration = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
/** Paise for the minutes at an hourly rate, rounded half up. Worked out once, when the entry is saved. */
export const timeAmount = (minutes: number, ratePaise: bigint): bigint => (BigInt(minutes) * ratePaise + 30n) / 60n;

export interface MatterIn {
  partyId: string; title: string; reference?: string | null; rate?: string | null; sac?: string | null;
  reverseCharge?: boolean; tdsBp?: number; notes?: string | null; status?: 'open' | 'closed';
}

function cleanMatter(i: Partial<MatterIn>, creating: boolean) {
  const out: Record<string, unknown> = {};
  if (creating || i.title !== undefined) out.title = str(i.title, 'Title', { required: true, max: 160 });
  if (i.reference !== undefined) out.reference = str(i.reference, 'Reference', { max: 60 });
  if (i.rate !== undefined && i.rate !== null && String(i.rate).trim() !== '') out.rate_paise = paise(i.rate, 'rate').toString();
  else if (creating) out.rate_paise = '0';
  if (i.sac !== undefined && i.sac !== null && String(i.sac).trim() !== '') {
    if (!/^[0-9]{4,8}$/.test(String(i.sac).trim())) throw new ValidationError('The SAC is 4 to 8 digits.', 'sac');
    out.sac = String(i.sac).trim();
  }
  if (i.reverseCharge !== undefined) out.reverse_charge = !!i.reverseCharge;
  if (i.tdsBp !== undefined) {
    if (!Number.isInteger(i.tdsBp) || i.tdsBp < 0 || i.tdsBp > 2000) throw new ValidationError('TDS must be between 0% and 20%.', 'tdsBp');
    out.tds_bp = i.tdsBp;
  }
  if (i.notes !== undefined) out.notes = str(i.notes, 'Notes', { max: 2000 });
  if (i.status !== undefined) {
    if (!['open', 'closed'].includes(i.status)) throw new ValidationError('Choose open or closed.', 'status');
    out.status = i.status;
  }
  return out;
}

function mapMatterError(e: unknown): never {
  const code = (e as { code?: string }).code;
  if (code === '23505') throw new ValidationError('Another matter already uses that reference.', 'reference');
  if (code === '23503') throw new ValidationError('Choose a client from your customers.', 'partyId');
  throw e;
}

export async function createMatter(sql: Sql, t: TenantSession, i: MatterIn): Promise<{ id: string }> {
  const c = cleanMatter(i, true);
  return inTenant(sql, t, 'matter.write', async (tx) => {
    const [p] = await tx`select id from party where id = ${i.partyId} and kind in ('customer', 'both')`;
    if (!p) throw new ValidationError('Choose a client from your customers.', 'partyId');
    try {
      const [r] = await tx`insert into matter (business_id, party_id, title, reference, rate_paise, sac, reverse_charge, tds_bp, notes, created_by)
                           values (${t.businessId}, ${i.partyId}, ${c.title as string}, ${(c.reference as string | null) ?? null}, ${c.rate_paise as string},
                                   ${(c.sac as string | undefined) ?? '998212'}, ${(c.reverse_charge as boolean | undefined) ?? false}, ${(c.tds_bp as number | undefined) ?? 0},
                                   ${(c.notes as string | null) ?? null}, ${t.userId}) returning id`;
      return { id: r!.id as string };
    } catch (e) { return mapMatterError(e); }
  });
}

export async function updateMatter(sql: Sql, t: TenantSession, id: string, i: Partial<Omit<MatterIn, 'partyId'>>): Promise<void> {
  const c = cleanMatter(i, false);
  if (Object.keys(c).length === 0) return;
  await inTenant(sql, t, 'matter.write', async (tx) => {
    try {
      const r = await tx`update matter set ${tx(c as Record<string, never>)} where id = ${id} returning id`;
      if (r.length === 0) throw new ValidationError('Matter not found.');
    } catch (e) { mapMatterError(e); }
  });
}

export async function listMatters(sql: Sql, t: TenantSession, f: { status?: string; q?: string } = {}) {
  const like = f.q ? `%${f.q.replace(/[%_\\]/g, '\\$&')}%` : null;
  return inTenant(sql, t, 'matter.read', (tx) => tx`
    select m.id, m.title, m.reference, m.status, m.rate_paise::text as rate_paise, m.opened_on::text as opened_on, p.name as party_name,
           coalesce((select sum(e.amount_paise) from matter_entry e where e.matter_id = m.id and e.billable and e.invoiced_document_id is null), 0)::text as unbilled_paise,
           coalesce((select sum(e.minutes) from matter_entry e where e.matter_id = m.id and e.kind = 'time' and e.billable and e.invoiced_document_id is null), 0)::int as unbilled_minutes,
           coalesce((select sum(case when k.kind = 'deposit' then k.amount_paise else -k.amount_paise end) from client_fund_entry k where k.matter_id = m.id), 0)::text as held_paise
      from matter m join party p on p.id = m.party_id
     where (${f.status ?? null}::text is null or m.status = ${f.status ?? null})
       and (${like}::text is null or m.title ilike ${like} or m.reference ilike ${like} or p.name ilike ${like})
     order by (m.status = 'open') desc, m.created_at desc limit 300`);
}

export async function getMatter(sql: Sql, t: TenantSession, id: string) {
  return inTenant(sql, t, 'matter.read', async (tx) => {
    const [m] = await tx`select m.id, m.title, m.reference, m.status, m.rate_paise::text as rate_paise, m.sac, m.reverse_charge, m.tds_bp, m.notes, m.opened_on::text as opened_on,
                                m.party_id, p.name as party_name, p.gstin as party_gstin
                           from matter m join party p on p.id = m.party_id where m.id = ${id}`;
    if (!m) return null;
    const entries = await tx`select e.id, e.kind, e.entry_date::text as entry_date, e.description, e.minutes, e.rate_paise::text as rate_paise, e.amount_paise::text as amount_paise,
                                    e.billable, e.pure_agent, e.invoiced_document_id, d.number as invoice_number, d.status as invoice_status
                               from matter_entry e left join document d on d.id = e.invoiced_document_id
                              where e.matter_id = ${id} order by e.entry_date desc, e.created_at desc`;
    const funds = await tx`select id, entry_date::text as entry_date, kind, amount_paise::text as amount_paise, note from client_fund_entry where matter_id = ${id} order by entry_date desc, created_at desc`;
    const events = await tx`select id, event_date::text as event_date, kind, title, notes, done from matter_event where matter_id = ${id} order by done, event_date`;
    const payable = await tx`select id, number, doc_date::text as doc_date, (grand_total_paise - amount_settled_paise)::text as outstanding_paise
                               from document where party_id = ${m.party_id} and status = 'issued' and doc_type in ('tax_invoice', 'bill_of_supply', 'debit_note')
                                and grand_total_paise > amount_settled_paise order by doc_date, number`;
    const open = entries.filter((e) => e.billable && !e.invoiced_document_id);
    const sum = (rows: Record<string, unknown>[]) => rows.reduce((s, r) => s + BigInt(r.amount_paise as string), 0n).toString();
    const held = funds.reduce((s, k) => s + (k.kind === 'deposit' ? 1n : -1n) * BigInt(k.amount_paise as string), 0n);
    return {
      matter: m, entries, funds, events, payable,
      unbilled: { amountPaise: sum(open), minutes: open.reduce((s, e) => s + ((e.minutes as number | null) ?? 0), 0), count: open.length },
      heldPaise: held.toString(),
    };
  });
}

export async function addTime(sql: Sql, t: TenantSession, matterId: string, i: { date?: string; duration: string; description: string; rate?: string | null; billable?: boolean }) {
  const minutes = parseDuration(i.duration);
  const description = str(i.description, 'Description', { required: true, max: 300 })!;
  return inTenant(sql, t, 'matter.write', async (tx) => {
    const [m] = await tx`select rate_paise::text as rate, status from matter where id = ${matterId}`;
    if (!m) throw new ValidationError('Matter not found.');
    if (m.status === 'closed') throw new ValidationError('This matter is closed. Reopen it to add time.');
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const date = i.date || todayIn(b!.timezone as string);
    if (!isDate(date)) throw new ValidationError('Enter the date as YYYY-MM-DD.', 'date');
    const rate = i.rate && String(i.rate).trim() ? paise(i.rate, 'rate') : BigInt(m.rate as string);
    if (rate <= 0n) throw new ValidationError('Set an hourly rate on the matter, or enter one for this entry.', 'rate');
    const amount = timeAmount(minutes, rate);
    if (amount <= 0n) throw new ValidationError('That time is too small to charge.', 'duration');
    const [r] = await tx`insert into matter_entry (business_id, matter_id, kind, entry_date, description, minutes, rate_paise, amount_paise, billable, created_by)
                         values (${t.businessId}, ${matterId}, 'time', ${date}, ${description}, ${minutes}, ${rate.toString()}, ${amount.toString()}, ${i.billable ?? true}, ${t.userId}) returning id`;
    return { id: r!.id as string, amountPaise: amount.toString() };
  });
}

export async function addExpense(sql: Sql, t: TenantSession, matterId: string, i: { date?: string; description: string; amount: string; pureAgent?: boolean; billable?: boolean }) {
  const description = str(i.description, 'Description', { required: true, max: 300 })!;
  const amount = paise(i.amount, 'amount');
  if (amount <= 0n) throw new ValidationError('The amount must be more than zero.', 'amount');
  return inTenant(sql, t, 'matter.write', async (tx) => {
    const [m] = await tx`select status from matter where id = ${matterId}`;
    if (!m) throw new ValidationError('Matter not found.');
    if (m.status === 'closed') throw new ValidationError('This matter is closed. Reopen it to add expenses.');
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const date = i.date || todayIn(b!.timezone as string);
    if (!isDate(date)) throw new ValidationError('Enter the date as YYYY-MM-DD.', 'date');
    const [r] = await tx`insert into matter_entry (business_id, matter_id, kind, entry_date, description, amount_paise, billable, pure_agent, created_by)
                         values (${t.businessId}, ${matterId}, 'expense', ${date}, ${description}, ${amount.toString()}, ${i.billable ?? true}, ${i.pureAgent ?? false}, ${t.userId}) returning id`;
    return { id: r!.id as string };
  });
}

/** Only unbilled entries can be changed. The database enforces this too. */
export async function setEntryBillable(sql: Sql, t: TenantSession, entryId: string, billable: boolean): Promise<void> {
  await inTenant(sql, t, 'matter.write', async (tx) => {
    try {
      const r = await tx`update matter_entry set billable = ${billable} where id = ${entryId} returning id`;
      if (r.length === 0) throw new ValidationError('Entry not found.');
    } catch (e) { const c = (e as { code?: string }).code; if (c === '23514' && e instanceof Error) throw new ValidationError(e.message); throw e; }
  });
}

export async function removeEntry(sql: Sql, t: TenantSession, entryId: string): Promise<void> {
  await inTenant(sql, t, 'matter.write', async (tx) => {
    try {
      const r = await tx`delete from matter_entry where id = ${entryId} returning id`;
      if (r.length === 0) throw new ValidationError('Entry not found.');
    } catch (e) { const c = (e as { code?: string }).code; if (c === '23514' && e instanceof Error) throw new ValidationError(e.message); throw e; }
  });
}

/** Client money received or returned. The balance cannot go below zero (the database refuses). */
export async function addFunds(sql: Sql, t: TenantSession, matterId: string, i: { kind: 'deposit' | 'refund'; amount: string; date?: string; note?: string | null }) {
  if (!['deposit', 'refund'].includes(i.kind)) throw new ValidationError('Choose received or returned. To pay an invoice from this money, use Pay an invoice.', 'kind');
  const amount = paise(i.amount, 'amount');
  if (amount <= 0n) throw new ValidationError('The amount must be more than zero.', 'amount');
  const note = str(i.note, 'Note', { max: 300 });
  return inTenant(sql, t, 'matter.write', async (tx) => {
    const [m] = await tx`select id from matter where id = ${matterId}`;
    if (!m) throw new ValidationError('Matter not found.');
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const date = i.date || todayIn(b!.timezone as string);
    if (!isDate(date)) throw new ValidationError('Enter the date as YYYY-MM-DD.', 'date');
    try {
      const [r] = await tx`insert into client_fund_entry (business_id, matter_id, entry_date, kind, amount_paise, note, created_by)
                           values (${t.businessId}, ${matterId}, ${date}, ${i.kind}, ${amount.toString()}, ${note}, ${t.userId}) returning id`;
      return { id: r!.id as string };
    } catch (e) { const c = (e as { code?: string }).code; if (c === '23514' && e instanceof Error) throw new ValidationError(e.message, 'amount'); throw e; }
  });
}

/**
 * Makes a draft tax invoice from the matter's unbilled, billable entries, one narrative line each, and marks them as billed.
 * Entries are claimed first so two people clicking at once cannot bill the same time twice; a failed draft frees them again.
 * The owner reviews and issues the draft like any other. Whether disbursements carry GST, and whether reverse charge applies,
 * are the owner's and their CA's call: the matter holds both settings.
 */
export async function billMatter(sql: Sql, t: TenantSession, matterId: string, opts: { upTo?: string } = {}): Promise<{ id: string; lines: number }> {
  if (opts.upTo !== undefined && !isDate(opts.upTo)) throw new ValidationError('Enter the date as YYYY-MM-DD.', 'upTo');
  const claim = randomUUID();
  const claimed = await inTenant(sql, t, 'document.write', async (tx) => {
    const [m] = await tx`select m.id, m.title, m.reference, m.sac, m.reverse_charge, m.tds_bp, m.party_id from matter m where m.id = ${matterId}`;
    if (!m) throw new ValidationError('Matter not found.');
    const rows = await tx`update matter_entry set claim_id = ${claim}, claimed_at = now()
                           where matter_id = ${matterId} and billable and invoiced_document_id is null
                             and (claim_id is null or claimed_at < now() - interval '10 minutes')
                             and (${opts.upTo ?? null}::date is null or entry_date <= ${opts.upTo ?? null}::date)
                       returning id, kind, entry_date::text as entry_date, description, minutes, rate_paise::text as rate_paise, amount_paise::text as amount_paise, pure_agent`;
    return { m, rows: [...rows].sort((a, b) => (a.entry_date as string).localeCompare(b.entry_date as string)) };
  });
  const release = () => inTenant(sql, t, 'document.write', (tx) => tx`update matter_entry set claim_id = null, claimed_at = null where claim_id = ${claim}`);
  if (claimed.rows.length === 0) throw new ValidationError('There is nothing unbilled on this matter.');
  try {
    const lines: LineIn[] = claimed.rows.map((e) => e.kind === 'time'
      ? { name: `${e.entry_date}: ${e.description} (${formatDuration(e.minutes as number)} at Rs ${rs(e.rate_paise as string)} an hour)`, hsnSac: claimed.m.sac as string, quantity: '1', rate: rs(e.amount_paise as string), taxRateBp: 1800, kind: 'service' as const }
      : e.kind === 'fee'
      ? { name: `${e.entry_date}: ${e.description}`, hsnSac: claimed.m.sac as string, quantity: '1', rate: rs(e.amount_paise as string), taxRateBp: 1800, kind: 'service' as const }
      : { name: `${e.entry_date}: ${e.description}${e.pure_agent ? ' (paid on your behalf, at cost)' : ''}`, hsnSac: claimed.m.sac as string, quantity: '1', rate: rs(e.amount_paise as string), taxRateBp: e.pure_agent ? 0 : 1800, kind: 'service' as const });
    const ref = claimed.m.reference ? `${claimed.m.reference}: ` : '';
    const { id } = await saveDraft(sql, t, {
      docType: 'tax_invoice', partyId: claimed.m.party_id as string, lines, reverseCharge: !!claimed.m.reverse_charge, tdsBp: claimed.m.tds_bp as number,
      notes: `Matter: ${ref}${claimed.m.title}`,
    });
    await inTenant(sql, t, 'document.write', (tx) => tx`update matter_entry set invoiced_document_id = ${id}, claim_id = null, claimed_at = null where claim_id = ${claim}`);
    return { id, lines: lines.length };
  } catch (e) {
    await release().catch(() => {});
    throw e;
  }
}

/** A lump sum for a stage of work or a period: a fixed fee, or one month of a retainer. No hours; it is billed like any other entry. */
export async function addFee(sql: Sql, t: TenantSession, matterId: string, i: { date?: string; description: string; amount: string; billable?: boolean }) {
  const description = str(i.description, 'Description', { required: true, max: 300 })!;
  const amount = paise(i.amount, 'amount');
  if (amount <= 0n) throw new ValidationError('The fee must be more than zero.', 'amount');
  return inTenant(sql, t, 'matter.write', async (tx) => {
    const [m] = await tx`select status from matter where id = ${matterId}`;
    if (!m) throw new ValidationError('Matter not found.');
    if (m.status === 'closed') throw new ValidationError('This matter is closed. Reopen it to add a fee.');
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const date = i.date || todayIn(b!.timezone as string);
    if (!isDate(date)) throw new ValidationError('Enter the date as YYYY-MM-DD.', 'date');
    const [r] = await tx`insert into matter_entry (business_id, matter_id, kind, entry_date, description, amount_paise, billable, created_by)
                         values (${t.businessId}, ${matterId}, 'fee', ${date}, ${description}, ${amount.toString()}, ${i.billable ?? true}, ${t.userId}) returning id`;
    return { id: r!.id as string };
  });
}

/**
 * Pays an invoice from money held for the client. The money leaves the ledger first (the database refuses to go below zero),
 * then the payment is recorded on the invoice. If the payment cannot be recorded, a correcting deposit puts the money back,
 * so the ledger and the invoice never disagree.
 */
export async function payInvoiceFromHeld(sql: Sql, t: TenantSession, matterId: string, i: { documentId: string; amount?: string }): Promise<{ paidPaise: string }> {
  if (!can(t.role, 'matter.write')) throw new ForbiddenError('matter.write');
  if (!can(t.role, 'payment.write')) throw new ForbiddenError('payment.write');
  const plan = await inTenant(sql, t, 'matter.write', async (tx) => {
    const [m] = await tx`select id, party_id, title, reference from matter where id = ${matterId}`;
    if (!m) throw new ValidationError('Matter not found.');
    const [d] = await tx`select id, party_id, status, doc_type, number, grand_total_paise, amount_settled_paise from document where id = ${i.documentId}`;
    if (!d || d.status !== 'issued' || !['tax_invoice', 'bill_of_supply', 'debit_note'].includes(d.doc_type as string)) throw new ValidationError('Choose an issued invoice.', 'documentId');
    if (d.party_id !== m.party_id) throw new ValidationError('That invoice is for a different client than this matter.', 'documentId');
    const outstanding = BigInt(d.grand_total_paise as string) - BigInt(d.amount_settled_paise as string);
    if (outstanding <= 0n) throw new ValidationError('That invoice is already paid.', 'documentId');
    const [h] = await tx`select coalesce(sum(case when kind = 'deposit' then amount_paise else -amount_paise end), 0)::text as held from client_fund_entry where matter_id = ${matterId}`;
    const held = BigInt(h!.held as string);
    const want = i.amount && String(i.amount).trim() ? paise(i.amount, 'amount') : (held < outstanding ? held : outstanding);
    if (want <= 0n) throw new ValidationError('There is no money held for this client.', 'amount');
    if (want > outstanding) throw new ValidationError(`The invoice has only Rs ${rs(outstanding)} still due.`, 'amount');
    if (want > held) throw new ValidationError(`Only Rs ${rs(held)} is held for this client.`, 'amount');
    return { want, number: d.number as string, label: `${m.reference ? `${m.reference}: ` : ''}${m.title}` };
  });
  const note = `Paid from money held for ${plan.label}`;
  try {
    await inTenant(sql, t, 'matter.write', async (tx) => {
      const [b] = await tx`select timezone from business where id = ${t.businessId}`;
      await tx`insert into client_fund_entry (business_id, matter_id, entry_date, kind, amount_paise, note, document_id, created_by)
               values (${t.businessId}, ${matterId}, ${todayIn(b!.timezone as string)}, 'applied', ${plan.want.toString()}, ${`Kept to pay ${plan.number}`}, ${i.documentId}, ${t.userId})`;
    });
  } catch (e) {
    const c = (e as { code?: string }).code;
    if (c === '23514' && e instanceof Error) throw new ValidationError(e.message, 'amount');
    throw e;
  }
  try {
    await recordPayment(sql, t, { documentId: i.documentId, amount: rs(plan.want), method: 'client_money', note });
  } catch (e) {
    await inTenant(sql, t, 'matter.write', async (tx) => {
      const [b] = await tx`select timezone from business where id = ${t.businessId}`;
      await tx`insert into client_fund_entry (business_id, matter_id, entry_date, kind, amount_paise, note, created_by)
               values (${t.businessId}, ${matterId}, ${todayIn(b!.timezone as string)}, 'deposit', ${plan.want.toString()}, ${`Put back: the payment on ${plan.number} could not be recorded`}, ${t.userId})`;
    });
    throw e;
  }
  return { paidPaise: plan.want.toString() };
}

// ---------------------------------------------------------------- hearings and deadlines
export const EVENT_KINDS = ['hearing', 'deadline', 'other'] as const;

export async function addEvent(sql: Sql, t: TenantSession, matterId: string, i: { date: string; kind?: string; title: string; notes?: string | null }) {
  if (!isDate(String(i.date))) throw new ValidationError('Enter the date as YYYY-MM-DD.', 'date');
  const kind = i.kind ?? 'hearing';
  if (!(EVENT_KINDS as readonly string[]).includes(kind)) throw new ValidationError('Choose hearing, deadline or other.', 'kind');
  const title = str(i.title, 'Title', { required: true, max: 160 })!;
  const notes = str(i.notes, 'Notes', { max: 1000 });
  return inTenant(sql, t, 'matter.write', async (tx) => {
    const [m] = await tx`select id from matter where id = ${matterId}`;
    if (!m) throw new ValidationError('Matter not found.');
    const [r] = await tx`insert into matter_event (business_id, matter_id, event_date, kind, title, notes, created_by)
                         values (${t.businessId}, ${matterId}, ${i.date}, ${kind}, ${title}, ${notes}, ${t.userId}) returning id`;
    return { id: r!.id as string };
  });
}

export async function setEventDone(sql: Sql, t: TenantSession, eventId: string, done: boolean): Promise<void> {
  await inTenant(sql, t, 'matter.write', async (tx) => {
    const r = await tx`update matter_event set done = ${done} where id = ${eventId} returning id`;
    if (r.length === 0) throw new ValidationError('That date was not found.');
  });
}

export async function removeEvent(sql: Sql, t: TenantSession, eventId: string): Promise<void> {
  await inTenant(sql, t, 'matter.write', async (tx) => {
    const r = await tx`delete from matter_event where id = ${eventId} returning id`;
    if (r.length === 0) throw new ValidationError('That date was not found.');
  });
}

/** What is coming up across every matter the person can see: anything overdue and not done, then the next N days. */
export async function upcomingEvents(sql: Sql, t: TenantSession, days = 30) {
  const n = Math.max(1, Math.min(365, Math.floor(days)));
  return inTenant(sql, t, 'matter.read', async (tx) => {
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const today = todayIn(b!.timezone as string);
    const rows = await tx`select e.id, e.matter_id, e.event_date::text as event_date, e.kind, e.title, e.notes, e.done, m.title as matter_title, m.reference as matter_reference,
                                 (e.event_date - ${today}::date)::int as days_left
                            from matter_event e join matter m on m.id = e.matter_id
                           where m.status = 'open' and not e.done and e.event_date <= (${today}::date + ${n}::int)
                           order by e.event_date, e.created_at limit 200`;
    return { today, events: rows };
  });
}

export async function listEvents(sql: Sql, t: TenantSession, matterId: string) {
  return inTenant(sql, t, 'matter.read', (tx) => tx`select id, event_date::text as event_date, kind, title, notes, done from matter_event where matter_id = ${matterId} order by done, event_date`);
}

// ---------------------------------------------------------------- who can see a matter
/**
 * An owner can make a matter private. Owners always see it; staff and accountants see it only if listed.
 * The database applies this to the matter, its entries, its client money and its dates, not just the screens.
 * Note: an invoice made from a private matter is an ordinary invoice, visible to anyone who can see invoices.
 */
export async function setMatterAccess(sql: Sql, t: TenantSession, matterId: string, i: { restricted: boolean; userIds?: string[] }): Promise<void> {
  const ids = [...new Set(i.userIds ?? [])];
  await inTenant(sql, t, 'member.manage', async (tx) => {
    const [m] = await tx`select id from matter where id = ${matterId}`;
    if (!m) throw new ValidationError('Matter not found.');
    if (ids.length) {
      const ok = await tx`select user_id from member where business_id = ${t.businessId} and user_id = any(${ids}::uuid[])`;
      if (ok.length !== ids.length) throw new ValidationError('Choose people who belong to this business.', 'userIds');
    }
    await tx`delete from matter_access where matter_id = ${matterId}`;
    if (i.restricted) for (const u of ids) await tx`insert into matter_access (matter_id, user_id, business_id) values (${matterId}, ${u}, ${t.businessId})`;
    await tx`update matter set restricted = ${!!i.restricted} where id = ${matterId}`;
  });
}

/** For the owner's screen: every person in the business and whether they are listed. */
export async function getMatterAccess(sql: Sql, t: TenantSession, matterId: string) {
  return inTenant(sql, t, 'member.manage', async (tx) => {
    const [m] = await tx`select restricted from matter where id = ${matterId}`;
    if (!m) return null;
    const people = await tx`select mb.user_id, mb.role, coalesce(u.display_name, u.email, u.phone) as who,
                                   exists (select 1 from matter_access a where a.matter_id = ${matterId} and a.user_id = mb.user_id) as listed
                              from member mb join app_user u on u.id = mb.user_id where mb.business_id = ${t.businessId} order by mb.role, who`;
    return { restricted: m.restricted as boolean, people };
  });
}
