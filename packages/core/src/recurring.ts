import { SYSTEM_USER, withTenant, type Sql, type Tx } from '@kora/db';
import { issueTx, persist, previewTotals, type DocIn, type LineIn } from './documents.js';
import { enqueue } from './jobs.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { isDate, str, todayIn, ValidationError } from './validation.js';
import { parseRupees } from '@kora/tax';
import { PAID_VIA } from './expenses.js';
import type { SendChannel } from './delivery.js';

export type RecurUnit = 'week' | 'month' | 'year';
export type RecurMode = 'draft' | 'issue' | 'issue_and_send';

const pad = (n: number) => String(n).padStart(2, '0');
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m is 1 to 12

/**
 * The k-th date of a schedule that starts on `start` and repeats every `n` units (k = 0 is the start itself).
 * Counting from the start, not from the previous run, keeps a monthly invoice on the 31st landing on the 28th or 30th
 * in short months and back on the 31st afterwards.
 */
export function occurrenceDate(start: string, n: number, unit: RecurUnit, k: number): string {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  if (unit === 'week') {
    const t = new Date(Date.UTC(y, m - 1, d + 7 * n * k));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }
  const months = unit === 'month' ? n * k : 12 * n * k;
  const total = (m - 1) + months;
  const yy = y + Math.floor(total / 12), mm = (total % 12) + 1;
  return `${yy}-${pad(mm)}-${pad(Math.min(d, daysInMonth(yy, mm)))}`;
}

/** The first occurrence on or after `date`. Used when a paused schedule is resumed, so it does not backfill. */
export function firstOccurrenceOnOrAfter(start: string, n: number, unit: RecurUnit, date: string): { k: number; date: string } {
  let k = 0;
  while (occurrenceDate(start, n, unit, k) < date) k++;
  return { k, date: occurrenceDate(start, n, unit, k) };
}

const addDays = (date: string, days: number): string => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

export interface RecurringIn {
  name: string;
  partyId: string;
  docType?: 'tax_invoice' | 'bill_of_supply';
  everyN?: number;
  unit: RecurUnit;
  startDate: string;
  endDate?: string | null;
  mode?: RecurMode;
  channel?: SendChannel | null;
  termsDays?: number;
  lines: LineIn[];
  notes?: string | null;
  terms?: string | null;
}

function clean(i: RecurringIn) {
  const name = str(i.name, 'Name', { required: true, max: 120 })!;
  if (!i.partyId) throw new ValidationError('Choose a customer.', 'partyId');
  const unit = i.unit;
  if (!['week', 'month', 'year'].includes(unit)) throw new ValidationError('Choose weekly, monthly or yearly.', 'unit');
  const everyN = i.everyN ?? 1;
  if (!Number.isInteger(everyN) || everyN < 1 || everyN > 24) throw new ValidationError('Repeat every 1 to 24 periods.', 'everyN');
  if (!isDate(i.startDate)) throw new ValidationError('Enter the start date as YYYY-MM-DD.', 'startDate');
  if (i.endDate && (!isDate(i.endDate) || i.endDate < i.startDate)) throw new ValidationError('The end date must be on or after the start date.', 'endDate');
  const mode = i.mode ?? 'draft';
  if (!['draft', 'issue', 'issue_and_send'].includes(mode)) throw new ValidationError('Choose what happens on each date.', 'mode');
  const channel = i.channel ?? null;
  if (mode === 'issue_and_send' && !['whatsapp', 'sms', 'email'].includes(channel ?? '')) throw new ValidationError('Choose WhatsApp, SMS or email for sending.', 'channel');
  const termsDays = i.termsDays ?? 0;
  if (!Number.isInteger(termsDays) || termsDays < 0 || termsDays > 365) throw new ValidationError('Payment terms are 0 to 365 days.', 'termsDays');
  const docType = i.docType ?? 'tax_invoice';
  if (!['tax_invoice', 'bill_of_supply'].includes(docType)) throw new ValidationError('Recurring documents are invoices or bills of supply.', 'docType');
  if (!Array.isArray(i.lines) || i.lines.length === 0) throw new ValidationError('Add at least one line.', 'lines');
  return {
    name, unit, everyN, mode, channel: mode === 'issue_and_send' ? channel : null, termsDays, docType,
    endDate: i.endDate ?? null, partyId: i.partyId, startDate: i.startDate,
    payload: { lines: i.lines, notes: str(i.notes, 'Notes', { max: 2000 }), terms: str(i.terms, 'Terms', { max: 2000 }) },
  };
}

/** Runs the same checks and tax calculation as a real invoice, so a bad template is refused now and not at 2 a.m. */
async function validateTemplate(sql: Sql, t: TenantSession, c: ReturnType<typeof clean>) {
  await previewTotals(sql, t, { docType: c.docType, partyId: c.partyId, lines: c.payload.lines });
}

export async function createRecurring(sql: Sql, t: TenantSession, input: RecurringIn) {
  const c = clean(input);
  await validateTemplate(sql, t, c);
  return inTenant(sql, t, 'document.write', async (tx) => {
    const [r] = await tx`
      insert into recurring_profile (business_id, name, party_id, doc_type, every_n, unit, start_date, end_date, occurrence, next_run_date,
                                     mode, channel, terms_days, payload, created_by)
      values (${t.businessId}, ${c.name}, ${c.partyId}, ${c.docType}, ${c.everyN}, ${c.unit}, ${c.startDate}, ${c.endDate}, 0, ${c.startDate},
              ${c.mode}, ${c.channel}, ${c.termsDays}, ${tx.json(c.payload as never)}, ${t.userId})
      returning id`;
    return { id: r!.id as string };
  });
}

/** The schedule itself (start, repeat, unit) is fixed once created; change what is invoiced, or pause and make a new one. */
export async function updateRecurring(sql: Sql, t: TenantSession, id: string, input: Omit<RecurringIn, 'unit' | 'startDate' | 'everyN'> & Partial<Pick<RecurringIn, 'unit' | 'startDate' | 'everyN'>>) {
  const cur = await getRecurring(sql, t, id);
  if (!cur) throw new ValidationError('Recurring invoice not found.');
  const p = cur.profile;
  const c = clean({ ...input, unit: p.unit as RecurUnit, startDate: p.start_date as string, everyN: p.every_n as number });
  await validateTemplate(sql, t, c);
  return inTenant(sql, t, 'document.write', async (tx) => {
    await tx`update recurring_profile set name = ${c.name}, party_id = ${c.partyId}, doc_type = ${c.docType}, end_date = ${c.endDate}, mode = ${c.mode},
                    channel = ${c.channel}, terms_days = ${c.termsDays}, payload = ${tx.json(c.payload as never)} where id = ${id}`;
    return { id };
  });
}

/**
 * Stop or resume a schedule, for either kind. Stopping only clears the flag, so the position is kept; resuming
 * re-reads the position from today, so a schedule that was paused for three months does not pour out three months
 * of back-dated work the moment it comes back.
 */
async function setActive(sql: Sql, t: TenantSession, id: string, active: boolean, kind: 'invoice' | 'expense') {
  const notFound = kind === 'expense' ? 'Recurring expense not found.' : 'Recurring invoice not found.';
  return inTenant(sql, t, kind === 'expense' ? 'expense.write' : 'document.write', async (tx) => {
    const [p] = await tx`select p.start_date, p.every_n, p.unit, b.timezone from recurring_profile p join business b on b.id = p.business_id
                          where p.id = ${id} and p.kind = ${kind} and p.archived_at is null for update of p`;
    if (!p) throw new ValidationError(notFound);
    if (!active) { await tx`update recurring_profile set active = false where id = ${id}`; return { id, active: false }; }
    // Resuming never backfills the weeks that were paused: carry on from the next date that has not passed.
    const next = firstOccurrenceOnOrAfter(p.start_date as string, p.every_n as number, p.unit as RecurUnit, todayIn(p.timezone as string));
    await tx`update recurring_profile set active = true, occurrence = ${next.k}, next_run_date = ${next.date} where id = ${id}`;
    return { id, active: true, nextRunDate: next.date };
  });
}

export const setRecurringActive = (sql: Sql, t: TenantSession, id: string, active: boolean) => setActive(sql, t, id, active, 'invoice');

/**
 * The dates a schedule will run on next, soonest first, stopping at its end date. It is plain date arithmetic, so the form can
 * show the dates before anything is saved. `occurrence` is how many dates have already gone by (0 for a new schedule).
 */
export function upcomingDates(p: { startDate: string; everyN: number; unit: RecurUnit; occurrence?: number; endDate?: string | null }, count = 6): string[] {
  const out: string[] = [];
  const first = p.occurrence ?? 0;
  for (let k = first; out.length < count && k < first + 1000; k++) {
    const d = occurrenceDate(p.startDate, p.everyN, p.unit, k);
    if (p.endDate && d > p.endDate) break;
    out.push(d);
  }
  return out;
}

/**
 * Skips the next date of a running schedule: no invoice is made for it, the schedule moves on to the following date, and the
 * skipped date shows in the history so nobody wonders where the invoice went.
 */
export async function skipNextRecurring(sql: Sql, t: TenantSession, id: string) {
  return inTenant(sql, t, 'document.write', async (tx) => {
    const [p] = await tx`select id, business_id, start_date, every_n, unit, end_date, occurrence, next_run_date, active from recurring_profile
                          where id = ${id} and kind = 'invoice' and archived_at is null for update`;
    if (!p) throw new ValidationError('Recurring invoice not found.');
    if (!p.active) throw new ValidationError('This schedule is paused. Resume it first.');
    const skipped = p.next_run_date as string;
    const k = Number(p.occurrence) + 1;
    const next = occurrenceDate(p.start_date as string, p.every_n as number, p.unit as RecurUnit, k);
    await tx`insert into recurring_run (business_id, profile_id, run_date, status, note)
             values (${t.businessId}, ${id}, ${skipped}, 'skipped', 'Skipped by you.') on conflict (profile_id, run_date) do nothing`;
    const finished = !!p.end_date && next > (p.end_date as string);
    await tx`update recurring_profile set occurrence = ${k}, next_run_date = ${next}, active = ${!finished} where id = ${id}`;
    return { id, skipped, nextRunDate: finished ? null : next };
  });
}

/** The next few runs of a saved schedule, and what each invoice would come to at today's prices and rates. */
export async function recurringPreview(sql: Sql, t: TenantSession, id: string, count = 6) {
  const cur = await getRecurring(sql, t, id);
  if (!cur) throw new ValidationError('Recurring invoice not found.');
  const p = cur.profile as unknown as Profile & { active: boolean };
  const dates = p.active ? upcomingDates({ startDate: p.start_date, everyN: p.every_n, unit: p.unit, occurrence: p.occurrence, endDate: p.end_date }, Math.min(count, 12)) : [];
  const totals = await previewTotals(sql, t, { docType: p.doc_type, partyId: p.party_id, lines: p.payload.lines });
  return {
    active: p.active, mode: p.mode, channel: p.channel, amountPaise: totals.grandTotal,
    dates: dates.map((date) => ({ date, dueDate: p.terms_days > 0 ? addDays(date, p.terms_days) : null })),
  };
}

export async function deleteRecurring(sql: Sql, t: TenantSession, id: string): Promise<void> {
  await inTenant(sql, t, 'document.write', async (tx) => {
    const r = await tx`delete from recurring_profile where id = ${id} and kind = 'invoice' returning id`;
    if (r.length === 0) throw new ValidationError('Recurring invoice not found.');
  });
}

export async function listRecurring(sql: Sql, t: TenantSession) {
  return inTenant(sql, t, 'document.read', (tx) => tx`
    select p.id, p.name, p.doc_type, p.every_n, p.unit, p.start_date, p.end_date, p.next_run_date, p.mode, p.channel, p.active, p.party_id,
           pa.name as party_name,
           (select count(*)::int from recurring_run r where r.profile_id = p.id and r.status = 'created') as created,
           (select count(*)::int from recurring_run r where r.profile_id = p.id and r.status = 'failed') as failed
      from recurring_profile p join party pa on pa.id = p.party_id
     where p.kind = 'invoice' and p.archived_at is null
     order by p.active desc, p.next_run_date`);
}

export async function getRecurring(sql: Sql, t: TenantSession, id: string) {
  return inTenant(sql, t, 'document.read', async (tx) => {
    const [p] = await tx`select p.*, pa.name as party_name from recurring_profile p join party pa on pa.id = p.party_id
                          where p.id = ${id} and p.kind = 'invoice' and p.archived_at is null`;
    if (!p) return null;
    const runs = await tx`select r.id, r.run_date, r.status, r.note, r.document_id, d.number, d.status as document_status
                            from recurring_run r left join document d on d.id = r.document_id
                           where r.profile_id = ${id} order by r.run_date desc limit 50`;
    return { profile: p, runs };
  });
}

type Profile = {
  id: string; business_id: string; kind: 'invoice' | 'expense'; party_id: string; doc_type: 'tax_invoice' | 'bill_of_supply'; every_n: number; unit: RecurUnit;
  start_date: string; end_date: string | null; occurrence: number; next_run_date: string; mode: RecurMode; channel: SendChannel | null;
  terms_days: number; payload: Record<string, any>; created_by: string;
};

/** Makes one invoice for one scheduled date, inside the caller's transaction. Returns the note to show on the run. */
type Made = { documentId?: string; expenseId?: string; note: string | null };

async function makeInvoice(tx: Tx, p: Profile, runDate: string): Promise<Made> {
  const t = { businessId: p.business_id, userId: p.created_by, role: 'owner' as const };
  const input: DocIn = {
    docType: p.doc_type, partyId: p.party_id, docDate: runDate, dueDate: p.terms_days > 0 ? addDays(runDate, p.terms_days) : null,
    notes: p.payload.notes, terms: p.payload.terms, lines: p.payload.lines,
  };
  const made = await persist(tx, t, null, input);
  if (p.mode === 'draft') return { documentId: made.id, note: 'Saved as a draft for you to review.' };
  await issueTx(tx, t, made.id);
  if (p.mode !== 'issue_and_send') return { documentId: made.id, note: null };

  const [c] = await tx`select phone, email from party where id = ${p.party_id}`;
  const to = (p.channel === 'email' ? c?.email : c?.phone) as string | null | undefined;
  if (!to) return { documentId: made.id, note: 'Issued, but not sent: the customer has no contact for this channel.' };
  const [del] = await tx`insert into delivery (business_id, document_id, channel, to_address, status)
                         values (${p.business_id}, ${made.id}, ${p.channel}, ${to}, 'queued') returning id`;
  await enqueue(tx, 'delivery.send', { deliveryId: del!.id, documentId: made.id, channel: p.channel, to, reminderId: null }, { businessId: p.business_id });
  return { documentId: made.id, note: null };
}

/**
 * Worker tick. For each schedule that is due in its own business's time zone, creates the invoice for every date that has
 * come up (at most 12 per tick, so a long outage catches up over a few ticks) and moves the schedule forward.
 * A recurring_run row per date, unique by profile and date, makes a doubled tick or a second worker harmless.
 * One bad run (an invalid line, say) is recorded on that run and does not stop the others.
 */
export async function processDueRecurring(sql: Sql, limit = 20): Promise<{ created: number; failed: number }> {
  const due = await sql`select id, business_id from due_recurring(${limit})`;
  let created = 0, failed = 0;
  for (const row of due) {
    await withTenant(sql, { businessId: row.business_id as string, userId: SYSTEM_USER }, async (tx) => {
      const [p] = await tx`select * from recurring_profile where id = ${row.id} and active for update skip locked` as unknown as Profile[];
      if (!p) return;
      const [b] = await tx`select timezone from business where id = ${p.business_id}`;
      const today = todayIn(b!.timezone as string);
      let k = p.occurrence, next = p.next_run_date, steps = 0, active = true;
      while (next <= today && steps < 12) {
        if (p.end_date && next > p.end_date) { active = false; break; }
        const [run] = await tx`insert into recurring_run (business_id, profile_id, run_date) values (${p.business_id}, ${p.id}, ${next})
                               on conflict (profile_id, run_date) do nothing returning id`;
        if (run) {
          try {
            const out = await tx.savepoint((sp) => (p.kind === 'expense' ? makeExpense(sp as Tx, p, next) : makeInvoice(sp as Tx, p, next)));
            await tx`update recurring_run set status = 'created', document_id = ${out.documentId ?? null}, expense_id = ${out.expenseId ?? null},
                                              note = ${out.note} where id = ${run.id}`;
            created++;
          } catch (e) {
            const what = p.kind === 'expense' ? 'Could not record the expense.' : 'Could not create the invoice.';
            await tx`update recurring_run set status = 'failed', note = ${((e as Error).message ?? what).slice(0, 300)} where id = ${run.id}`;
            failed++;
          }
        }
        k++; steps++;
        next = occurrenceDate(p.start_date, p.every_n, p.unit, k);
      }
      if (p.end_date && next > p.end_date) active = false;
      await tx`update recurring_profile set occurrence = ${k}, next_run_date = ${next}, active = ${active} where id = ${p.id}`;
    });
  }
  return { created, failed };
}

// ---------------------------------------------------------------- recurring expenses
//
// The same engine, the same tick, the same run rows. An expense profile carries what to spend instead of what to
// invoice, so only the template and the "make one" step differ; everything about the schedule is shared above.

export interface RecurringExpenseIn {
  name: string;
  category: string;
  amount: string;            // rupees, tax included
  gst?: string | null;       // rupees, the GST inside that amount
  vendor?: string | null;
  paidVia?: string;
  everyN?: number;
  unit: RecurUnit;
  startDate: string;
  endDate?: string | null;
  notes?: string | null;
}

/** Pure. Everything a recurring expense needs is checked here, so a bad schedule is refused now and not at 2 a.m. */
export function validateRecurringExpense(i: RecurringExpenseIn) {
  const name = str(i.name, 'Name', { required: true, max: 120 })!;
  const category = str(i.category, 'Category', { required: true, max: 60 })!;
  const unit = i.unit;
  if (!['week', 'month', 'year'].includes(unit)) throw new ValidationError('Choose weekly, monthly or yearly.', 'unit');
  const everyN = i.everyN ?? 1;
  if (!Number.isInteger(everyN) || everyN < 1 || everyN > 24) throw new ValidationError('Repeat every 1 to 24 periods.', 'everyN');
  if (!isDate(i.startDate)) throw new ValidationError('Enter the start date as YYYY-MM-DD.', 'startDate');
  if (i.endDate && (!isDate(i.endDate) || i.endDate < i.startDate)) throw new ValidationError('The end date must be on or after the start date.', 'endDate');
  let amount: bigint, gst = 0n;
  try { amount = parseRupees(String(i.amount ?? '')); } catch { throw new ValidationError('Enter the amount in rupees.', 'amount'); }
  if (amount <= 0n) throw new ValidationError('The amount must be more than zero.', 'amount');
  if (i.gst) { try { gst = parseRupees(String(i.gst)); } catch { throw new ValidationError('Enter the GST in rupees.', 'gst'); } }
  if (gst < 0n) throw new ValidationError('The GST cannot be negative.', 'gst');
  if (gst > amount) throw new ValidationError('The GST is more than the amount paid. The amount includes the GST.', 'gst');
  const paidVia = i.paidVia ?? 'cash';
  if (!(PAID_VIA as readonly string[]).includes(paidVia)) throw new ValidationError('Choose how it is paid.', 'paidVia');
  return {
    name, unit, everyN, startDate: i.startDate, endDate: i.endDate ?? null,
    payload: {
      category, amountPaise: amount.toString(), gstPaise: gst.toString(), paidVia,
      vendor: str(i.vendor, 'Vendor', { max: 120 }), notes: str(i.notes, 'Notes', { max: 1000 }),
    },
  };
}

export async function createRecurringExpense(sql: Sql, t: TenantSession, input: RecurringExpenseIn) {
  const c = validateRecurringExpense(input);
  return inTenant(sql, t, 'expense.write', async (tx) => {
    const [r] = await tx`
      insert into recurring_profile (business_id, kind, name, every_n, unit, start_date, end_date, occurrence, next_run_date, payload, created_by)
      values (${t.businessId}, 'expense', ${c.name}, ${c.everyN}, ${c.unit}, ${c.startDate}, ${c.endDate}, 0, ${c.startDate}, ${tx.json(c.payload as never)}, ${t.userId})
      returning id`;
    return { id: r!.id as string };
  });
}

/** As with invoices, the schedule itself is fixed once created: change what is spent, or stop it and start a new one. */
export async function updateRecurringExpense(sql: Sql, t: TenantSession, id: string, input: Omit<RecurringExpenseIn, 'unit' | 'startDate' | 'everyN'>) {
  return inTenant(sql, t, 'expense.write', async (tx) => {
    const [cur] = await tx`select every_n, unit, start_date::text as start_date from recurring_profile
                            where id = ${id} and kind = 'expense' and archived_at is null`;
    if (!cur) throw new ValidationError('Recurring expense not found.');
    const c = validateRecurringExpense({ ...input, unit: cur.unit as RecurUnit, startDate: cur.start_date as string, everyN: cur.every_n as number });
    await tx`update recurring_profile set name = ${c.name}, end_date = ${c.endDate}, payload = ${tx.json(c.payload as never)} where id = ${id}`;
    return { id };
  });
}

export const stopRecurringExpense = (sql: Sql, t: TenantSession, id: string) => setActive(sql, t, id, false, 'expense');
export const resumeRecurringExpense = (sql: Sql, t: TenantSession, id: string) => setActive(sql, t, id, true, 'expense');

/** Archived, not deleted: the expenses it already recorded, and the history of how they got there, stay in the books. */
export async function archiveRecurringExpense(sql: Sql, t: TenantSession, id: string): Promise<void> {
  await inTenant(sql, t, 'expense.write', async (tx) => {
    const r = await tx`update recurring_profile set archived_at = now(), active = false
                        where id = ${id} and kind = 'expense' and archived_at is null returning id`;
    if (r.length === 0) throw new ValidationError('Recurring expense not found.');
  });
}

export async function listRecurringExpenses(sql: Sql, t: TenantSession) {
  return inTenant(sql, t, 'expense.read', (tx) => tx`
    select p.id, p.name, p.every_n, p.unit, p.start_date::text as start_date, p.end_date::text as end_date, p.next_run_date::text as next_run_date,
           p.active, p.payload->>'category' as category, p.payload->>'vendor' as vendor, p.payload->>'amountPaise' as amount_paise,
           p.payload->>'gstPaise' as gst_paise, p.payload->>'paidVia' as paid_via,
           (select count(*)::int from recurring_run r where r.profile_id = p.id and r.status = 'created') as created,
           (select count(*)::int from recurring_run r where r.profile_id = p.id and r.status = 'failed') as failed
      from recurring_profile p
     where p.kind = 'expense' and p.archived_at is null
     order by p.active desc, p.next_run_date`);
}

/** The profile, its run history, and the expenses it has actually created. */
export async function getRecurringExpense(sql: Sql, t: TenantSession, id: string) {
  return inTenant(sql, t, 'expense.read', async (tx) => {
    const [p] = await tx`select * from recurring_profile where id = ${id} and kind = 'expense' and archived_at is null`;
    if (!p) return null;
    const runs = await tx`select r.id, r.run_date::text as run_date, r.status, r.note, r.expense_id
                            from recurring_run r where r.profile_id = ${id} order by r.run_date desc limit 50`;
    const expenses = await tx`
      select e.id, e.expense_date::text as expense_date, e.vendor, e.category, e.amount_paise, e.gst_paise, e.paid_via, e.notes
        from expense e join recurring_run r on r.expense_id = e.id
       where r.profile_id = ${id} order by e.expense_date desc limit 200`;
    return { profile: p, runs, expenses };
  });
}

/** Records one expense for one scheduled date, inside the caller's transaction. The GST carries from the profile. */
async function makeExpense(tx: Tx, p: Profile, runDate: string): Promise<Made> {
  const q = p.payload;
  const [e] = await tx`
    insert into expense (business_id, expense_date, vendor, category, amount_paise, gst_paise, paid_via, notes, created_by)
    values (${p.business_id}, ${runDate}, ${q.vendor ?? null}, ${q.category}, ${q.amountPaise}, ${q.gstPaise ?? '0'}, ${q.paidVia ?? 'cash'}, ${q.notes ?? null}, ${p.created_by})
    returning id`;
  return { expenseId: e!.id as string, note: null };
}
