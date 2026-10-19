import type { Sql } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { isDate, todayIn, ValidationError } from './validation.js';

export const AGEING_BUCKETS = ['not_due', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

export interface AgeingRow {
  partyId: string | null; partyName: string; totalPaise: string;
  buckets: Record<AgeingBucket, string>;
  invoices: { id: string; number: string; dueDate: string; daysOverdue: number; outstandingPaise: string }[];
}

/** What customers owe, grouped by how late it is. Counts issued invoices, bills of supply and debit notes. */
export async function ageingReport(sql: Sql, t: TenantSession, o: { asOf?: string } = {}) {
  return inTenant(sql, t, 'report.read', async (tx) => {
    const [b] = await tx`select timezone from business where id = ${t.businessId}`;
    const asOf = o.asOf ?? todayIn(b!.timezone as string);
    if (!isDate(asOf)) throw new ValidationError('Enter the date as YYYY-MM-DD.', 'asOf');
    const rows = await tx`
      select r.id, r.number, r.party_id, coalesce(p.name, 'Walk-in customers') as party_name, r.due_date::text as due_date,
             (${asOf}::date - r.due_date) as days_overdue, r.outstanding_paise::text as outstanding
        from receivable r left join party p on p.id = r.party_id
       order by party_name, r.due_date`;
    const byParty = new Map<string, AgeingRow>();
    const totals: Record<AgeingBucket, bigint> = { not_due: 0n, d1_30: 0n, d31_60: 0n, d61_90: 0n, d90_plus: 0n };
    for (const r of rows) {
      const key = (r.party_id as string | null) ?? 'walk-in';
      const days = r.days_overdue as number;
      const bucket: AgeingBucket = days <= 0 ? 'not_due' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90_plus';
      const amt = BigInt(r.outstanding as string);
      let row = byParty.get(key);
      if (!row) {
        row = { partyId: r.party_id as string | null, partyName: r.party_name as string, totalPaise: '0',
          buckets: { not_due: '0', d1_30: '0', d31_60: '0', d61_90: '0', d90_plus: '0' }, invoices: [] };
        byParty.set(key, row);
      }
      row.buckets[bucket] = (BigInt(row.buckets[bucket]) + amt).toString();
      row.totalPaise = (BigInt(row.totalPaise) + amt).toString();
      row.invoices.push({ id: r.id as string, number: r.number as string, dueDate: r.due_date as string, daysOverdue: days, outstandingPaise: r.outstanding as string });
      totals[bucket] += amt;
    }
    const grand = Object.values(totals).reduce((a, x) => a + x, 0n);
    return {
      asOf, rows: [...byParty.values()],
      totals: { ...(Object.fromEntries(AGEING_BUCKETS.map((k) => [k, totals[k].toString()])) as Record<AgeingBucket, string>), total: grand.toString() },
    };
  });
}
