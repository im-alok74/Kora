import type { Sql } from '@kora/db';
import { cancelDocument, deleteDraft, issueDocument } from './documents.js';
import { gstDeadlines } from './firm.js';
import { can } from './permissions.js';
import { itcSummary } from './purchases.js';
import { sendReminderNow } from './reminders.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { todayIn, ValidationError } from './validation.js';

/** Things that look across the whole business: search, the list of what needs attention, a customer's full picture, and bulk actions. */

// ---------------------------------------------------------------- search
export interface SearchHit { kind: 'document' | 'customer' | 'item' | 'matter' | 'bill' | 'expense'; id: string; title: string; subtitle: string; href: string }

const like = (q: string) => `%${q.replace(/[%_\\]/g, '\\$&')}%`;

/**
 * One search box over documents, customers and vendors, items, matters, purchase bills and expenses.
 * Each group is searched only if the person's role may read it, and a group that fails never hides the others.
 */
export async function globalSearch(sql: Sql, t: TenantSession, raw: string): Promise<{ q: string; hits: SearchHit[] }> {
  const q = String(raw ?? '').trim().slice(0, 80);
  if (q.length < 2) return { q, hits: [] };
  const p = like(q);
  const groups: [boolean, () => Promise<SearchHit[]>][] = [
    [can(t.role, 'document.read'), () => inTenant(sql, t, 'document.read', async (tx) => (await tx`
      select d.id, d.number, d.doc_type, d.status, d.doc_date::text as doc_date, coalesce(pt.name, 'Walk-in customer') as party
        from document d left join party pt on pt.id = d.party_id
       where d.number ilike ${p} or pt.name ilike ${p} order by d.created_at desc limit 6`).map((r) => ({
      kind: 'document' as const, id: r.id as string, title: `${r.number ?? 'Draft'}`, subtitle: `${String(r.doc_type).replace(/_/g, ' ')} · ${r.party} · ${r.doc_date}`, href: `/app/invoices/${r.id}`,
    })))],
    [can(t.role, 'party.read'), () => inTenant(sql, t, 'party.read', async (tx) => (await tx`
      select id, name, kind, gstin, phone from party where archived_at is null and (name ilike ${p} or gstin ilike ${p} or phone ilike ${p} or email ilike ${p}) order by name limit 6`).map((r) => ({
      kind: 'customer' as const, id: r.id as string, title: r.name as string, subtitle: `${r.kind === 'vendor' ? 'Vendor' : r.kind === 'both' ? 'Customer and vendor' : 'Customer'}${r.gstin ? ` · ${r.gstin}` : r.phone ? ` · ${r.phone}` : ''}`,
      href: r.kind === 'vendor' ? '/app/purchases' : `/app/customers/${r.id}`,
    })))],
    [can(t.role, 'item.read'), () => inTenant(sql, t, 'item.read', async (tx) => (await tx`
      select id, name, hsn_sac from item where archived_at is null and (name ilike ${p} or hsn_sac ilike ${p}) order by name limit 5`).map((r) => ({
      kind: 'item' as const, id: r.id as string, title: r.name as string, subtitle: r.hsn_sac ? `HSN or SAC ${r.hsn_sac}` : 'Item', href: '/app/items',
    })))],
    [can(t.role, 'matter.read'), () => inTenant(sql, t, 'matter.read', async (tx) => (await tx`
      select m.id, m.title, m.reference, p.name as client from matter m join party p on p.id = m.party_id where m.title ilike ${p} or m.reference ilike ${p} or p.name ilike ${p} order by m.created_at desc limit 5`).map((r) => ({
      kind: 'matter' as const, id: r.id as string, title: r.title as string, subtitle: `${r.reference ? `${r.reference} · ` : ''}${r.client}`, href: `/app/matters/${r.id}`,
    })))],
    [can(t.role, 'purchase.read'), () => inTenant(sql, t, 'purchase.read', async (tx) => (await tx`
      select b.id, b.bill_number, b.bill_date::text as bill_date, p.name as vendor from purchase_bill b join party p on p.id = b.party_id where b.bill_number ilike ${p} or p.name ilike ${p} order by b.bill_date desc limit 5`).map((r) => ({
      kind: 'bill' as const, id: r.id as string, title: `Bill ${r.bill_number}`, subtitle: `${r.vendor} · ${r.bill_date}`, href: `/app/purchases/${r.id}`,
    })))],
    [can(t.role, 'expense.read'), () => inTenant(sql, t, 'expense.read', async (tx) => (await tx`
      select id, vendor, category, expense_date::text as expense_date from expense where vendor ilike ${p} or category ilike ${p} or notes ilike ${p} order by expense_date desc limit 4`).map((r) => ({
      kind: 'expense' as const, id: r.id as string, title: `${r.category}${r.vendor ? `: ${r.vendor}` : ''}`, subtitle: `Expense · ${r.expense_date}`, href: '/app/expenses',
    })))],
  ];
  const settled = await Promise.allSettled(groups.filter(([ok]) => ok).map(([, run]) => run()));
  return { q, hits: settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : [])) };
}

// ---------------------------------------------------------------- what needs attention
export interface Notice { id: string; severity: 'critical' | 'warning' | 'info'; title: string; detail: string; href: string }

/**
 * What a person should look at now, worked out from the data each time. Nothing is stored, so nothing goes stale:
 * once the problem is fixed the notice is gone. The screen remembers which ones were dismissed.
 */
export async function notifications(sql: Sql, t: TenantSession): Promise<{ today: string; notices: Notice[] }> {
  const [b] = await inTenant(sql, t, 'document.read', (tx) => tx`select timezone, registration_type from business where id = ${t.businessId}`).catch(() => [undefined]);
  const today = todayIn((b?.timezone as string) ?? 'Asia/Kolkata');
  const out: Notice[] = [];
  const rupee = (p: string) => `Rs ${(BigInt(p) / 100n).toLocaleString('en-IN')}`;
  const tasks: Promise<void>[] = [];
  const add = (cond: boolean, fn: () => Promise<void>) => { if (cond) tasks.push(fn().catch(() => {})); };

  add(can(t.role, 'report.read'), () => inTenant(sql, t, 'report.read', async (tx) => {
    const [r] = await tx`select count(*)::int as n, coalesce(sum(outstanding_paise), 0)::text as total, min(due_date)::text as oldest from receivable where due_date < ${today}::date`;
    if ((r!.n as number) > 0) out.push({ id: `overdue:${today}`, severity: 'critical', title: `${r!.n} overdue ${r!.n === 1 ? 'invoice' : 'invoices'}`, detail: `${rupee(r!.total as string)} is late. The oldest was due on ${r!.oldest}.`, href: '/app/reports' });
  }));
  add(can(t.role, 'document.read'), () => inTenant(sql, t, 'document.read', async (tx) => {
    const [d] = await tx`select count(*)::int as n from document where status = 'draft' and created_at < now() - interval '3 days'`;
    if ((d!.n as number) > 0) out.push({ id: `drafts:${today}`, severity: 'info', title: `${d!.n} ${d!.n === 1 ? 'draft has' : 'drafts have'} been waiting for days`, detail: 'Issue them or delete them so your numbers stay tidy.', href: '/app/invoices' });
    const [e] = await tx`select count(*)::int as n from document where doc_type = 'estimate' and status = 'issued' and due_date between ${today}::date and (${today}::date + 7)
                           and not exists (select 1 from estimate_state s where s.document_id = document.id and (s.decision is not null or s.converted_to_id is not null))`;
    if ((e!.n as number) > 0) out.push({ id: `estimates:${today}`, severity: 'info', title: `${e!.n} ${e!.n === 1 ? 'estimate expires' : 'estimates expire'} this week`, detail: 'Follow up before they lapse.', href: '/app/invoices?type=estimate' });
    const [f] = await tx`select count(*)::int as n from delivery where status = 'failed' and created_at > now() - interval '7 days'`;
    if ((f!.n as number) > 0) out.push({ id: `deliveries:${today}`, severity: 'warning', title: `${f!.n} ${f!.n === 1 ? 'message' : 'messages'} could not be sent`, detail: 'Open the invoice to see why and send it again.', href: '/app/invoices' });
    const [x] = await tx`select count(*)::int as n from document where einvoice_status = 'rejected'`;
    if ((x!.n as number) > 0) out.push({ id: `einvoice:${today}`, severity: 'critical', title: `${x!.n} ${x!.n === 1 ? 'invoice was' : 'invoices were'} rejected by the e-invoice portal`, detail: 'They are not legally complete yet. Open each one to fix and resubmit.', href: '/app/invoices' });
  }));
  add(b?.registration_type === 'regular', async () => {
    for (const d of gstDeadlines(today, 'regular')) if (d.daysLeft >= 0 && d.daysLeft <= 5) out.push({ id: `gst:${d.form}:${d.due}`, severity: d.daysLeft <= 2 ? 'warning' : 'info', title: `${d.form} for ${d.period} is due ${d.daysLeft === 0 ? 'today' : `in ${d.daysLeft} ${d.daysLeft === 1 ? 'day' : 'days'}`}`, detail: 'This is the standard monthly date. Check the portal if you file quarterly or have an extension.', href: '/app/reports' });
  });
  add(can(t.role, 'inbox.review'), () => inTenant(sql, t, 'inbox.read', async (tx) => {
    const [i] = await tx`select count(*)::int as n from inbox_item where status = 'new'`;
    if ((i!.n as number) > 0) out.push({ id: `inbox:${today}`, severity: 'info', title: `${i!.n} ${i!.n === 1 ? 'paper' : 'papers'} to review in the inbox`, detail: 'Your client sent these for you to work through.', href: '/app/inbox' });
  }));
  add(can(t.role, 'matter.read'), () => inTenant(sql, t, 'matter.read', async (tx) => {
    const rows = await tx`select e.id, e.title, e.kind, e.event_date::text as event_date, (e.event_date - ${today}::date)::int as days, m.title as matter, m.id as matter_id
                            from matter_event e join matter m on m.id = e.matter_id where m.status = 'open' and not e.done and e.event_date <= (${today}::date + 1) order by e.event_date limit 10`;
    for (const r of rows) out.push({ id: `event:${r.id}:${today}`, severity: (r.days as number) <= 0 ? 'critical' : 'warning', title: `${r.kind === 'hearing' ? 'Hearing' : 'Deadline'} ${(r.days as number) < 0 ? 'was missed' : r.days === 0 ? 'today' : 'tomorrow'}: ${r.title}`, detail: String(r.matter), href: `/app/matters/${r.matter_id}` });
  }));
  add(can(t.role, 'purchase.read'), () => inTenant(sql, t, 'purchase.read', async (tx) => {
    const [p] = await tx`select count(*)::int as n, coalesce(sum(total_paise - paid_paise), 0)::text as total, count(*) filter (where coalesce(due_date, bill_date) < ${today}::date)::int as late
                           from purchase_bill where status = 'recorded' and paid_paise < total_paise and coalesce(due_date, bill_date) <= (${today}::date + 7)`;
    if ((p!.n as number) > 0) out.push({ id: `payables:${today}`, severity: (p!.late as number) > 0 ? 'warning' : 'info', title: `${p!.n} vendor ${p!.n === 1 ? 'bill is' : 'bills are'} due within a week`, detail: `${rupee(p!.total as string)} to pay${(p!.late as number) > 0 ? `, ${p!.late} already late` : ''}.`, href: '/app/purchases' });
  }));
  add(can(t.role, 'purchase.read'), async () => {
    const s = await itcSummary(sql, t, today.slice(0, 7));
    if (s.has2b && BigInt(s.atRiskTotal) > 0n) out.push({ id: `itc:${today.slice(0, 7)}`, severity: 'warning', title: `${rupee(s.atRiskTotal)} of input credit is at risk`, detail: 'Your suppliers have not filed these bills yet.', href: '/app/itc' });
  });

  await Promise.all(tasks);
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  out.sort((a, c) => rank[a.severity] - rank[c.severity] || a.title.localeCompare(c.title));
  return { today, notices: out };
}

// ---------------------------------------------------------------- one customer, all of it
/** Everything about a customer in one place: what they owe, how they pay, and their recent documents and payments. */
export async function partyOverview(sql: Sql, t: TenantSession, id: string) {
  return inTenant(sql, t, 'party.read', async (tx) => {
    const [p] = await tx`select id, kind, name, gstin, phone, email, state_code, billing_address, created_at::text as created_at, archived_at is not null as archived from party where id = ${id}`;
    if (!p) return null;
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const today = todayIn(b!.timezone as string);
    const [s] = await tx`select
        coalesce(sum(case when doc_type in ('tax_invoice', 'bill_of_supply', 'debit_note') then grand_total_paise when doc_type = 'credit_note' then -grand_total_paise else 0 end) filter (where status = 'issued'), 0)::text as billed,
        count(*) filter (where status = 'issued' and doc_type in ('tax_invoice', 'bill_of_supply'))::int as invoices,
        max(doc_date) filter (where status = 'issued')::text as last_billed
      from document where party_id = ${id}`;
    const [r] = await tx`select coalesce(sum(outstanding_paise), 0)::text as outstanding, coalesce(sum(outstanding_paise) filter (where due_date < ${today}::date), 0)::text as overdue,
                                count(*)::int as open_count, max(${today}::date - due_date) filter (where due_date < ${today}::date)::int as max_days_late from receivable where party_id = ${id}`;
    const [pay] = await tx`select coalesce(sum(a.amount_paise) filter (where p.method <> 'tds'), 0)::text as received, count(*)::int as n,
                                  avg(extract(epoch from (p.received_on::timestamp - d.doc_date::timestamp)) / 86400)::float as avg_days
                             from payment p join payment_allocation a on a.payment_id = p.id join document d on d.id = a.document_id where p.party_id = ${id}`;
    const docs = await tx`select d.id, d.number, d.doc_type, d.status, d.doc_date::text as doc_date, d.grand_total_paise::text as total_paise, d.payment_status, d.currency
                            from document d where d.party_id = ${id} order by d.created_at desc limit 25`;
    const payments = await tx`select p.id, p.received_on::text as received_on, p.amount_paise::text as amount_paise, p.method, p.note from payment p where p.party_id = ${id} order by p.received_on desc, p.created_at desc limit 15`;
    return {
      party: { id: p.id as string, kind: p.kind as string, name: p.name as string, gstin: p.gstin as string | null, phone: p.phone as string | null, email: p.email as string | null, stateCode: p.state_code as string, address: p.billing_address as Record<string, unknown>, since: p.created_at as string, archived: p.archived as boolean },
      summary: {
        billedPaise: s!.billed as string, invoices: s!.invoices as number, lastBilled: s!.last_billed as string | null,
        outstandingPaise: r!.outstanding as string, overduePaise: r!.overdue as string, openInvoices: r!.open_count as number, maxDaysLate: (r!.max_days_late as number | null) ?? 0,
        receivedPaise: pay!.received as string, averageDaysToPay: pay!.avg_days === null ? null : Math.round(pay!.avg_days as number),
      },
      documents: docs, payments,
    };
  });
}

// ---------------------------------------------------------------- bulk actions
export type BulkAction = 'issue' | 'delete' | 'cancel' | 'remind';
export interface BulkResult { id: string; ok: boolean; error?: string }

/**
 * Runs one action over up to 50 documents and says what happened to each. One failure never stops the rest.
 * 'issue' issues drafts, 'delete' deletes drafts, 'cancel' cancels issued documents (with one reason for all),
 * and 'remind' sends payment reminders on the chosen channel to each customer's number or email.
 */
export async function bulkDocuments(sql: Sql, t: TenantSession, i: { action: BulkAction; ids: string[]; reason?: string; channel?: 'whatsapp' | 'sms' | 'email' }): Promise<{ results: BulkResult[]; done: number; failed: number }> {
  if (!['issue', 'delete', 'cancel', 'remind'].includes(i.action)) throw new ValidationError('Choose what to do.', 'action');
  const ids = [...new Set(i.ids ?? [])];
  if (ids.length === 0) throw new ValidationError('Choose at least one document.', 'ids');
  if (ids.length > 50) throw new ValidationError('Choose 50 documents or fewer at a time.', 'ids');
  if (i.action === 'cancel' && !String(i.reason ?? '').trim()) throw new ValidationError('Give a reason for cancelling.', 'reason');
  const channel = i.channel ?? 'whatsapp';
  const results: BulkResult[] = [];
  for (const id of ids) {
    try {
      if (i.action === 'issue') await issueDocument(sql, t, id);
      else if (i.action === 'delete') await deleteDraft(sql, t, id);
      else if (i.action === 'cancel') await cancelDocument(sql, t, id, String(i.reason));
      else {
        const [c] = await inTenant(sql, t, 'document.read', (tx) => tx`select p.phone, p.email from document d left join party p on p.id = d.party_id where d.id = ${id}`);
        const to = channel === 'email' ? (c?.email as string | null) : (c?.phone as string | null);
        if (!to) throw new ValidationError(`This customer has no ${channel === 'email' ? 'email address' : 'mobile number'}.`);
        await sendReminderNow(sql, t, { documentId: id, channel, to });
      }
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const done = results.filter((r) => r.ok).length;
  return { results, done, failed: results.length - done };
}
