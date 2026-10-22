import type { Sql } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { dateRange, type Column } from './registers.js';
import { TDS_SECTIONS } from './purchases.js';

export const TDS_PAYABLE_COLUMNS: Column<any>[] = [
  { key: 'vendor', label: 'Vendor' }, { key: 'pan', label: 'PAN' }, { key: 'section', label: 'Section' }, { key: 'payments', label: 'Payments' },
  { key: 'gross', label: 'Bill value settled', money: true }, { key: 'paid', label: 'Paid to vendor', money: true }, { key: 'tds', label: 'TDS held back', money: true },
];

/** The date by which tax held back in a month is due to be deposited: the 7th of the next month (30 April for March; the CA will confirm exceptions). */
export function tdsDepositDate(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  if (m === 3) return `${y}-04-30`;
  const next = new Date(Date.UTC(y, m, 7));
  return next.toISOString().slice(0, 10);
}

/**
 * Tax held back from vendor payments in the period, by vendor and section, with what to deposit month by month.
 * The PAN is read from the vendor's GSTIN (characters 3 to 12), which is how a GSTIN is built.
 */
export async function tdsPayable(sql: Sql, t: TenantSession, f: { from?: string; to?: string } = {}) {
  return inTenant(sql, t, 'report.read', async (tx) => {
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const { from, to } = dateRange(f, b!.timezone as string);
    const rows = await tx`
      select p.name as vendor, coalesce(substr(p.gstin, 3, 10), '') as pan, pp.tds_section as section, count(*)::int as payments,
             sum(pp.amount_paise + pp.tds_paise)::text as gross, sum(pp.amount_paise)::text as paid, sum(pp.tds_paise)::text as tds
        from purchase_payment pp join purchase_bill pb on pb.id = pp.bill_id join party p on p.id = pb.party_id
       where pp.tds_paise > 0 and pp.paid_on between ${from}::date and ${to}::date
       group by p.id, p.name, p.gstin, pp.tds_section order by p.name, pp.tds_section`;
    const months = await tx`
      select to_char(pp.paid_on, 'YYYY-MM') as month, pp.tds_section as section, sum(pp.tds_paise)::text as tds
        from purchase_payment pp where pp.tds_paise > 0 and pp.paid_on between ${from}::date and ${to}::date
       group by 1, 2 order by 1, 2`;
    const label = new Map(TDS_SECTIONS);
    const total = rows.reduce((n, r) => n + BigInt(r.tds as string), 0n).toString();
    return {
      from, to, rows: rows.map((r) => ({ vendor: r.vendor as string, pan: r.pan as string, section: r.section as string, payments: r.payments as number, gross: r.gross as string, paid: r.paid as string, tds: r.tds as string, sectionName: label.get(r.section as string) ?? '' })), total,
      deposits: months.map((m) => ({ month: m.month as string, section: m.section as string, tds: m.tds as string, depositBy: tdsDepositDate(m.month as string) })),
    };
  });
}
