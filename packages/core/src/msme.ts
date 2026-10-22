import type { Sql } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { todayIn } from './validation.js';

/** Section 15 of the MSMED Act: micro and small suppliers are paid within 45 days of the bill, whatever the agreement says. */
export const MSME_DAYS = 45;
/** Warn this many days before the last day. */
export const MSME_WARN_DAYS = 7;

export type MsmeState = 'overdue' | 'soon' | 'ok';

const ms = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));

/** The last day to pay: 45 days after the bill, or the due date if the agreement says sooner. */
export function msmeDeadline(billDate: string, dueDate?: string | null): string {
  const cap = new Date(ms(billDate) + MSME_DAYS * 86_400_000).toISOString().slice(0, 10);
  return dueDate && dueDate < cap ? dueDate : cap;
}

export function msmeStatus(deadline: string, today: string): { state: MsmeState; daysLeft: number } {
  const daysLeft = Math.round((ms(deadline) - ms(today)) / 86_400_000);
  return { state: daysLeft < 0 ? 'overdue' : daysLeft <= MSME_WARN_DAYS ? 'soon' : 'ok', daysLeft };
}

/** Does the rule apply to this vendor? Only micro and small enterprises are covered. */
export const msmeCovered = (cls: string | null | undefined) => cls === 'micro' || cls === 'small';

/** Unpaid bills from micro and small vendors, most urgent first. */
export async function msmeDue(sql: Sql, t: TenantSession) {
  return inTenant(sql, t, 'purchase.read', async (tx) => {
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const today = todayIn(b!.timezone as string);
    const rows = await tx`
      select b.id, b.bill_number, b.bill_date::text as bill_date, b.due_date::text as due_date, p.id as party_id, p.name as vendor, p.udyam_number, p.msme_class,
             (b.total_paise - b.paid_paise)::text as due_paise
        from purchase_bill b join party p on p.id = b.party_id
       where b.status = 'recorded' and b.paid_paise < b.total_paise and p.msme_class in ('micro', 'small')`;
    const list = rows.map((r) => {
      const deadline = msmeDeadline(r.bill_date as string, r.due_date as string | null);
      return { id: r.id as string, billNumber: r.bill_number as string, vendor: r.vendor as string, partyId: r.party_id as string, udyamNumber: r.udyam_number as string,
        msmeClass: r.msme_class as string, billDate: r.bill_date as string, deadline, duePaise: r.due_paise as string, ...msmeStatus(deadline, today) };
    }).sort((a, c) => a.daysLeft - c.daysLeft);
    return { today, bills: list, overdue: list.filter((x) => x.state === 'overdue').length, soon: list.filter((x) => x.state === 'soon').length };
  });
}
