import type { Sql } from '@kora/db';
import { inTenant, type TenantSession } from './tenancy.js';
import { todayIn } from './validation.js';

/**
 * What the owner wants to see first: what is owed and what is late, how sales are going, and what needs attention.
 * Everything is worked out in the business's own time zone, from issued documents only. Amounts are paise as strings.
 */
export async function dashboardSummary(sql: Sql, t: TenantSession) {
  return inTenant(sql, t, 'report.read', async (tx) => {
    const [b] = await tx`select timezone, legal_name, trade_name, upi_vpa, phone, (address <> '{}'::jsonb) as has_address from business where id = ${t.businessId}`;
    const today = todayIn(b!.timezone as string);
    const [y, m] = today.split('-').map(Number) as [number, number];
    const pad = (n: number) => String(n).padStart(2, '0');
    const months: { key: string; label: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      months.push({ key: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`, label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]! });
    }
    const monthStart = `${months[5]!.key}-01`;
    const chartStart = `${months[0]!.key}-01`;

    const [recv] = await tx`select coalesce(sum(outstanding_paise), 0)::text as outstanding,
                                   coalesce(sum(case when due_date < ${today}::date then outstanding_paise else 0 end), 0)::text as overdue,
                                   count(*)::int as unpaid, (count(*) filter (where due_date < ${today}::date))::int as overdue_count from receivable`;
    const sales = await tx`select to_char(doc_date, 'YYYY-MM') as month,
                                  sum(case when doc_type = 'credit_note' then -grand_total_paise else grand_total_paise end)::text as total
                             from document where status = 'issued' and doc_type in ('tax_invoice', 'bill_of_supply', 'debit_note', 'credit_note') and doc_date >= ${chartStart}::date
                            group by 1`;
    const byMonth = new Map(sales.map((r) => [r.month as string, r.total as string]));
    const [col] = await tx`select coalesce(sum(amount_paise) filter (where method <> 'tds'), 0)::text as total from payment where received_on >= ${monthStart}::date`;
    const [exp] = await tx`select coalesce(sum(amount_paise), 0)::text as total from expense where expense_date >= ${monthStart}::date`;

    const [week] = await tx`select coalesce(sum(outstanding_paise), 0)::text as amount, count(*)::int as n from receivable
                             where due_date >= ${today}::date and due_date <= (${today}::date + 7)`;
    const top = await tx`select coalesce(p.name, 'Walk-in customers') as name, p.id as party_id,
                                sum(case when d.doc_type = 'credit_note' then -d.grand_total_paise else d.grand_total_paise end)::text as total
                           from document d left join party p on p.id = d.party_id
                          where d.status = 'issued' and d.doc_type in ('tax_invoice', 'bill_of_supply', 'debit_note', 'credit_note') and d.doc_date > (${today}::date - 365)
                          group by p.id, p.name having sum(case when d.doc_type = 'credit_note' then -d.grand_total_paise else d.grand_total_paise end) > 0
                          order by sum(case when d.doc_type = 'credit_note' then -d.grand_total_paise else d.grand_total_paise end) desc limit 5`;
    const [pay] = await tx`select coalesce(sum(total_paise - paid_paise), 0)::text as owed,
                                  coalesce(sum(total_paise - paid_paise) filter (where coalesce(due_date, bill_date) < ${today}::date), 0)::text as late,
                                  coalesce(sum(total_paise - paid_paise) filter (where coalesce(due_date, bill_date) >= ${today}::date and coalesce(due_date, bill_date) <= (${today}::date + 7)), 0)::text as week,
                                  count(*)::int as n
                             from purchase_bill where status = 'recorded' and paid_paise < total_paise`;
    const [msme] = await tx`select count(*)::int as n from purchase_bill b join party p on p.id = b.party_id
                             where b.status = 'recorded' and b.paid_paise < b.total_paise and p.msme_class in ('micro', 'small')
                               and least(coalesce(b.due_date, b.bill_date + 45), b.bill_date + 45) <= (${today}::date + 7)`;
    const overdue = await tx`select d.id, d.number, coalesce(p.name, 'Walk-in customer') as party_name, r.outstanding_paise::text as outstanding_paise, (${today}::date - r.due_date)::int as days
                               from receivable r join document d on d.id = r.id left join party p on p.id = d.party_id
                              where r.due_date < ${today}::date order by r.due_date, d.number limit 5`;
    const [drafts] = await tx`select count(*)::int as n from document where status = 'draft'`;
    const [est] = await tx`select count(*) filter (where s = 'open')::int as open, count(*) filter (where s = 'accepted')::int as accepted
                             from (select estimate_status(d.status, d.due_date, ${b!.timezone as string}, es.decision, es.converted_to_id) as s
                                     from document d left join estimate_state es on es.document_id = d.id where d.doc_type = 'estimate') x`;
    const recent = await tx`select d.id, d.number, d.doc_type, d.status, d.doc_date::text as doc_date, d.currency, d.grand_total_paise::text as total_paise, d.payment_status,
                                   coalesce(p.name, 'Walk-in customer') as party_name,
                                   case when d.doc_type = 'estimate' then estimate_status(d.status, d.due_date, ${b!.timezone as string}, es.decision, es.converted_to_id) end as estimate_status
                              from document d left join party p on p.id = d.party_id left join estimate_state es on es.document_id = d.id
                             order by d.created_at desc limit 6`;
    const [n] = await tx`select (select count(*) from party where archived_at is null)::int as customers, (select count(*) from item where archived_at is null)::int as items,
                                (select count(*) from document)::int as documents`;
    return {
      business: { name: (b!.trade_name ?? b!.legal_name) as string },
      today,
      owed: { outstanding: recv!.outstanding as string, overdue: recv!.overdue as string, unpaid: recv!.unpaid as number, overdueCount: recv!.overdue_count as number },
      dueThisWeek: { amount: week!.amount as string, count: week!.n as number },
      topCustomers: top.map((r) => ({ name: r.name as string, partyId: r.party_id as string | null, total: r.total as string })),
      toPay: { owed: pay!.owed as string, late: pay!.late as string, dueThisWeek: pay!.week as string, bills: pay!.n as number, msmeAttention: msme!.n as number },
      thisMonth: { sales: byMonth.get(months[5]!.key) ?? '0', collected: col!.total as string, expenses: exp!.total as string },
      chart: months.map((mo) => ({ ...mo, total: byMonth.get(mo.key) ?? '0' })),
      attention: { overdue, drafts: drafts!.n as number, openEstimates: est!.open as number, acceptedEstimates: est!.accepted as number },
      recent,
      setup: { customers: n!.customers as number, items: n!.items as number, documents: n!.documents as number, hasAddress: !!b!.has_address, hasUpi: !!b!.upi_vpa, hasPhone: !!b!.phone },
    };
  });
}
