import type { Sql } from '@kora/db';
import { dashboardSummary } from './dashboard.js';
import { inTenant, listBusinesses, resolveTenant } from './tenancy.js';
import { todayIn } from './validation.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export interface Deadline { form: 'GSTR-1' | 'GSTR-3B'; period: string; due: string; daysLeft: number }

/**
 * The standard monthly dates for the month just ended: GSTR-1 on the 11th, GSTR-3B on the 20th.
 * Quarterly (QRMP) filers, extensions and notified relief are not tracked, so these are a prompt, not a legal calendar.
 * Only regular registrations are listed. Composition dealers file different forms and are left out.
 */
export function gstDeadlines(today: string, registrationType: string): Deadline[] {
  if (registrationType !== 'regular') return [];
  const [y, m] = today.split('-').map(Number) as [number, number];
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const period = `${MONTHS[prev.getUTCMonth()]} ${prev.getUTCFullYear()}`;
  const due = (day: number) => `${y}-${pad(m)}-${pad(day)}`;
  return [
    { form: 'GSTR-1' as const, period, due: due(11), daysLeft: daysBetween(today, due(11)) },
    { form: 'GSTR-3B' as const, period, due: due(20), daysLeft: daysBetween(today, due(20)) },
  ];
}

export interface FirmClient {
  businessId: string; name: string; gstin: string | null; registrationType: string; role: string;
  /** False when this role cannot read reports, so no figures are shown. */
  visible: boolean;
  outstanding: string; overdue: string; overdueCount: number; drafts: number; salesThisMonth: string; collectedThisMonth: string;
  deadlines: Deadline[];
  needsAttention: boolean;
}

const MAX_CLIENTS = 200;

/**
 * One row per business the person belongs to: what is owed, what is late, drafts waiting, and the next GST dates.
 * Each business is read through its own tenant session, so a role that cannot see reports sees a row without figures.
 */
export async function firmSummary(sql: Sql, userId: string) {
  const all = await listBusinesses(sql, userId);
  const memberships = all.slice(0, MAX_CLIENTS);
  const clients: FirmClient[] = [];
  for (const m of memberships) {
    const t = await resolveTenant(sql, userId, m.businessId);
    let b: Record<string, unknown> | undefined;
    try { [b] = await inTenant(sql, t, 'document.read', (tx) => tx`select gstin, registration_type, timezone from business where id = ${m.businessId}`); } catch { /* a role without document access still gets a row */ }
    const base = { businessId: m.businessId, name: m.legalName, gstin: (b?.gstin as string | null) ?? null, registrationType: (b?.registration_type as string) ?? 'regular', role: m.role };
    try {
      const d = await dashboardSummary(sql, t);
      const deadlines = gstDeadlines(d.today, base.registrationType);
      const overdueN = d.owed.overdueCount;
      clients.push({
        ...base, visible: true, outstanding: d.owed.outstanding, overdue: d.owed.overdue, overdueCount: overdueN, drafts: d.attention.drafts,
        salesThisMonth: d.thisMonth.sales, collectedThisMonth: d.thisMonth.collected, deadlines,
        needsAttention: overdueN > 0 || deadlines.some((x) => x.daysLeft >= 0 && x.daysLeft <= 5),
      });
    } catch {
      const today = todayIn((b?.timezone as string) ?? 'Asia/Kolkata');
      clients.push({ ...base, visible: false, outstanding: '0', overdue: '0', overdueCount: 0, drafts: 0, salesThisMonth: '0', collectedThisMonth: '0', deadlines: gstDeadlines(today, base.registrationType), needsAttention: false });
    }
  }
  clients.sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention) || a.name.localeCompare(b.name));
  const sum = (f: (c: FirmClient) => string) => clients.reduce((s, c) => s + BigInt(f(c)), 0n).toString();
  return {
    /** True when more businesses exist than are listed, so every total below covers only the first `shown`. */
    truncated: all.length > memberships.length, shown: memberships.length, total: all.length,
    totals: { clients: clients.length, outstanding: sum((c) => c.outstanding), overdue: sum((c) => c.overdue), needingAttention: clients.filter((c) => c.needsAttention).length },
    clients,
  };
}
