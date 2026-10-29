import type { Sql, Tx } from '@kora/db';
import { assertClientAccess } from './firmclients.js';
import { inFirm, seesAllClients, type FirmSession } from './firmtenancy.js';
import { ValidationError } from './validation.js';

export type Service = 'gstr1' | 'gstr3b';
export type EngagementStatus = 'open' | 'preparing' | 'in_review' | 'done';
export const SERVICES: Service[] = ['gstr1', 'gstr3b'];

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const PERIOD = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
/** Days before the statutory date that the team aims to finish. Only used when the statutory date is known. */
const BUFFER_DAYS = 3;

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const FORM_NAME: Record<Service, string> = { gstr1: 'GSTR-1', gstr3b: 'GSTR-3B' };

/**
 * The standard monthly date for a service and period: GSTR-1 on the 11th, GSTR-3B on the 20th of the month after the period.
 * Returns null for anything else, so the caller records "set by hand" instead of guessing.
 */
export function standardDeadline(service: Service, period: string, registrationType: string, filingFrequency: string): { date: string; source: string } | null {
  if (registrationType !== 'regular' || filingFrequency !== 'monthly') return null;
  const [y, m] = period.split('-').map(Number) as [number, number];
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const date = isoDate(ny, nm, service === 'gstr1' ? 11 : 20);
  return { date, source: 'Standard monthly date; check the portal for extensions' };
}

export interface GenerateResult { period: string; created: number; existing: number; skipped: { reason: string; count: number }[] }

/**
 * Creates the engagements for one month: GSTR-1 and GSTR-3B for every regular GST registration of every active client.
 * Quarterly filers get one pair in each quarter-end month with no date until someone sets it. Composition, SEZ and ISD registrations
 * file other forms and are skipped and counted. Safe to run again: existing engagements are left alone.
 */
export async function generateEngagements(sql: Sql, s: FirmSession, period: string): Promise<GenerateResult> {
  if (!PERIOD.test(period)) throw new ValidationError('Period must look like 2026-09.', 'period');
  const month = Number(period.slice(5));
  return inFirm(sql, s, 'engagement.write', async (tx) => {
    const regs = await tx`select r.id, r.client_id, r.registration_type, r.filing_frequency from client_registration r
                           join client_entity c on c.id = r.client_id where r.firm_id = ${s.firmId} and c.status = 'active'`;
    let created = 0, existing = 0, other = 0, notQuarterEnd = 0;
    for (const r of regs) {
      if (r.registration_type !== 'regular') { other++; continue; }
      if (r.filing_frequency === 'quarterly' && month % 3 !== 0) { notQuarterEnd++; continue; }
      for (const service of SERVICES) {
        const d = standardDeadline(service, period, r.registration_type, r.filing_frequency);
        const [row] = await tx`
          insert into engagement (firm_id, client_id, registration_id, service, period, statutory_deadline, deadline_source, internal_target)
          values (${s.firmId}, ${r.client_id}, ${r.id}, ${service}, ${period}, ${d?.date ?? null},
                  ${d?.source ?? 'Quarterly filer: set the date from the notified schedule'}, ${d ? addDays(d.date, -BUFFER_DAYS) : null})
          on conflict (registration_id, service, period) do nothing returning id`;
        if (row) created++; else existing++;
      }
    }
    return { period, created, existing, skipped: [{ reason: 'Not a regular registration (files other forms)', count: other }, { reason: 'Quarterly filer, not a quarter-end month', count: notQuarterEnd }].filter((x) => x.count > 0) };
  });
}

export interface EngagementRow {
  id: string; clientId: string; clientName: string; gstin: string; service: Service; form: string; period: string;
  statutoryDeadline: string | null; deadlineSource: string; internalTarget: string | null; status: EngagementStatus;
  ownerId: string | null; reviewerId: string | null;
  blocker: { reason: string; party: 'client' | 'firm' | 'third_party'; nextAction: string; expected: string | null; since: string } | null;
}

/** One page of engagements the person may see (preparers and reviewers: only for clients assigned to them). */
export async function listEngagements(sql: Sql, s: FirmSession, opts: { period?: string; status?: EngagementStatus; blocked?: boolean; mine?: boolean; limit?: number; offset?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200), offset = Math.max(opts.offset ?? 0, 0);
  if (opts.period && !PERIOD.test(opts.period)) throw new ValidationError('Period must look like 2026-09.', 'period');
  const all = seesAllClients(s.role);
  return inFirm(sql, s, 'engagement.read', async (tx) => {
    const where = (t: Tx) => t`e.firm_id = ${s.firmId}
      ${opts.period ? t`and e.period = ${opts.period}` : t``} ${opts.status ? t`and e.status = ${opts.status}` : t``}
      ${opts.blocked === undefined ? t`` : opts.blocked ? t`and e.blocker_reason is not null` : t`and e.blocker_reason is null`}
      ${opts.mine ? t`and (e.owner_id = ${s.userId} or e.reviewer_id = ${s.userId})` : t``}
      ${all ? t`` : t`and exists (select 1 from client_assignment a where a.client_id = e.client_id and a.user_id = ${s.userId})`}`;
    const [{ n }] = (await tx`select count(*)::int as n from engagement e where ${where(tx)}`) as unknown as [{ n: number }];
    const rows = await tx`select e.*, c.legal_name, r.gstin from engagement e join client_entity c on c.id = e.client_id join client_registration r on r.id = e.registration_id
                           where ${where(tx)} order by e.statutory_deadline nulls first, c.legal_name, e.service, e.id limit ${limit} offset ${offset}`;
    const engagements: EngagementRow[] = rows.map((e) => ({
      id: e.id, clientId: e.client_id, clientName: e.legal_name, gstin: e.gstin, service: e.service, form: FORM_NAME[e.service as Service], period: e.period,
      statutoryDeadline: e.statutory_deadline ? new Date(e.statutory_deadline).toISOString().slice(0, 10) : null, deadlineSource: e.deadline_source,
      internalTarget: e.internal_target ? new Date(e.internal_target).toISOString().slice(0, 10) : null, status: e.status,
      ownerId: e.owner_id ?? null, reviewerId: e.reviewer_id ?? null,
      blocker: e.blocker_reason ? {
        reason: e.blocker_reason, party: e.blocker_party, nextAction: e.blocker_next_action ?? '',
        expected: e.blocker_expected ? new Date(e.blocker_expected).toISOString().slice(0, 10) : null, since: new Date(e.blocker_since).toISOString(),
      } : null,
    }));
    return { total: n, limit, offset, engagements };
  });
}

/** Set or change the dates by hand, for the cases the rule does not cover (quarterly filers, extensions). */
export async function setEngagementDates(sql: Sql, s: FirmSession, id: string, d: { statutoryDeadline?: string | null; source?: string; internalTarget?: string | null }): Promise<void> {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  for (const v of [d.statutoryDeadline, d.internalTarget]) if (v && !iso.test(v)) throw new ValidationError('Dates must look like 2026-10-20.');
  return inFirm(sql, s, 'engagement.write', async (tx) => {
    const [e] = await tx`select client_id from engagement where id = ${id} and firm_id = ${s.firmId}`;
    if (!e) throw new ValidationError('That engagement was not found.');
    await assertClientAccess(tx, s, e.client_id as string);
    await tx`update engagement set
        statutory_deadline = case when ${d.statutoryDeadline !== undefined} then ${d.statutoryDeadline ?? null}::date else statutory_deadline end,
        deadline_source = case when ${d.statutoryDeadline !== undefined} then ${(d.source ?? 'Set by hand').slice(0, 200)} else deadline_source end,
        internal_target = case when ${d.internalTarget !== undefined} then ${d.internalTarget ?? null}::date else internal_target end,
        updated_at = now() where id = ${id}`;
  });
}
