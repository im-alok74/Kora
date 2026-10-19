import type { Sql } from '@kora/db';
import { xmlText } from './files.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { isDate, ValidationError } from './validation.js';

/**
 * Sales and receipts as a Tally import file (XML), so an accountant who keeps books in Tally does not retype invoices.
 *
 * The structure follows Tally's voucher import format as I know it, and has not been tried against a live Tally. Import it
 * into a test company first. The ledger names are settings, because every Tally company names them differently; ledgers that
 * do not exist yet are created as masters in the same file.
 */
export interface TallyConfig {
  company: string;
  salesLedger: string; cgstLedger: string; sgstLedger: string; igstLedger: string; cessLedger: string; tcsLedger: string; roundOffLedger: string;
  cashLedger: string; bankLedger: string; tdsLedger: string;
}
export const DEFAULT_TALLY: TallyConfig = {
  company: '', salesLedger: 'Sales', cgstLedger: 'Output CGST', sgstLedger: 'Output SGST', igstLedger: 'Output IGST', cessLedger: 'Output Cess',
  tcsLedger: 'TCS Payable', roundOffLedger: 'Round Off', cashLedger: 'Cash', bankLedger: 'Bank Account', tdsLedger: 'TDS Receivable',
};

const LEDGER_KEYS = ['salesLedger', 'cgstLedger', 'sgstLedger', 'igstLedger', 'cessLedger', 'tcsLedger', 'roundOffLedger', 'cashLedger', 'bankLedger', 'tdsLedger'] as const;

export function sanitiseTallyConfig(raw: unknown): TallyConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_TALLY } as Record<string, string>;
  for (const k of ['company', ...LEDGER_KEYS]) {
    if (r[k] === undefined || r[k] === null || r[k] === '') continue;
    const v = String(r[k]).trim();
    if (v.length > 100) throw new ValidationError('A ledger name is too long.', k);
    if (/[\u0000-\u001F]/.test(v)) throw new ValidationError('A ledger name has a character Tally cannot take.', k);
    out[k] = v;
  }
  return out as unknown as TallyConfig;
}

const amt = (p: bigint) => { const neg = p < 0n; const a = neg ? -p : p; return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`; };
const ymd = (d: string) => d.replace(/-/g, '');
const esc = xmlText;

interface Entry { ledger: string; amount: bigint }   // positive = credit, negative = debit

function entries(list: Entry[]): string {
  return list.filter((e) => e.amount !== 0n).map((e) =>
    `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(e.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${e.amount < 0n ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${amt(e.amount)}</AMOUNT></ALLLEDGERENTRIES.LIST>`).join('');
}

function voucher(type: string, date: string, number: string, party: string, narration: string, list: Entry[]): string {
  const sum = list.reduce((n, e) => n + e.amount, 0n);
  if (sum !== 0n) throw new Error(`Voucher ${number} does not balance (${amt(sum)}).`);   // never write a file Tally would reject
  return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${esc(type)}" ACTION="Create" OBJVIEW="Accounting Voucher View">`
    + `<DATE>${ymd(date)}</DATE><VOUCHERTYPENAME>${esc(type)}</VOUCHERTYPENAME><VOUCHERNUMBER>${esc(number)}</VOUCHERNUMBER>`
    + `<PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME><NARRATION>${esc(narration)}</NARRATION><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>`
    + `${entries(list)}</VOUCHER></TALLYMESSAGE>`;
}

const master = (name: string, parent: string, extra = '') =>
  `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(name)}" ACTION="Create"><NAME>${esc(name)}</NAME><PARENT>${esc(parent)}</PARENT>${extra}</LEDGER></TALLYMESSAGE>`;

export async function exportTally(sql: Sql, t: TenantSession, o: { from?: string; to?: string; config?: unknown } = {}) {
  if (!o.from || !o.to || !isDate(o.from) || !isDate(o.to)) throw new ValidationError('Choose the dates to export, as YYYY-MM-DD.', 'from');
  if (o.from > o.to) throw new ValidationError('The start date is after the end date.', 'from');
  const cfg = sanitiseTallyConfig(o.config);
  const { from, to } = { from: o.from, to: o.to };
  return inTenant(sql, t, 'report.export', async (tx) => {
    const [b] = await tx`select legal_name, trade_name from business where id = ${t.businessId}`;
    const company = cfg.company || (b!.trade_name ?? b!.legal_name) as string;
    const docs = await tx`
      select d.id, d.doc_type, d.number, d.doc_date::text as doc_date, d.reverse_charge, coalesce(p.name, 'Cash Sales') as party,
             d.taxable_paise, d.cgst_paise, d.sgst_paise, d.igst_paise, d.cess_paise, d.tcs_paise, d.round_off_paise, d.grand_total_paise
        from document d left join party p on p.id = d.party_id
       where d.status = 'issued' and d.doc_type in ('tax_invoice', 'bill_of_supply', 'debit_note', 'credit_note')
         and d.doc_date between ${from}::date and ${to}::date order by d.doc_date, d.number`;
    const cancelled = await tx`select count(*)::int as n from document where status = 'cancelled' and doc_type in ('tax_invoice', 'bill_of_supply', 'debit_note', 'credit_note')
                                  and doc_date between ${from}::date and ${to}::date`;
    const pays = await tx`
      select p.id, p.received_on::text as received_on, p.method, p.amount_paise, c.name as party, p.note
        from payment p left join party c on c.id = p.party_id where p.received_on between ${from}::date and ${to}::date order by p.received_on, p.created_at`;

    const parties = new Set<string>();
    const messages: string[] = [];
    let sales = 0, creditNotes = 0, receipts = 0, skipped = 0;
    for (const d of docs) {
      const sign = d.doc_type === 'credit_note' ? -1n : 1n;
      const tax = (v: unknown) => (d.reverse_charge ? 0n : BigInt(v as string));   // tax payable by the recipient is not billed to the customer
      const total = BigInt(d.grand_total_paise as string);
      const list: Entry[] = [
        { ledger: d.party as string, amount: -sign * total },
        { ledger: cfg.salesLedger, amount: sign * BigInt(d.taxable_paise as string) },
        { ledger: cfg.cgstLedger, amount: sign * tax(d.cgst_paise) }, { ledger: cfg.sgstLedger, amount: sign * tax(d.sgst_paise) },
        { ledger: cfg.igstLedger, amount: sign * tax(d.igst_paise) }, { ledger: cfg.cessLedger, amount: sign * tax(d.cess_paise) },
        { ledger: cfg.tcsLedger, amount: sign * BigInt(d.tcs_paise as string) }, { ledger: cfg.roundOffLedger, amount: sign * BigInt(d.round_off_paise as string) },
      ];
      parties.add(d.party as string);
      messages.push(voucher(d.doc_type === 'credit_note' ? 'Credit Note' : 'Sales', d.doc_date as string, d.number as string, d.party as string, `Kora ${d.number}`, list));
      if (d.doc_type === 'credit_note') creditNotes++; else sales++;
    }
    for (const p of pays) {
      if (!p.party) { skipped++; continue; }                                        // no customer, so no ledger to credit
      const amount = BigInt(p.amount_paise as string);
      const into = p.method === 'cash' ? cfg.cashLedger : p.method === 'tds' ? cfg.tdsLedger : cfg.bankLedger;
      parties.add(p.party as string);
      messages.push(voucher('Receipt', p.received_on as string, `KR-${(p.id as string).slice(0, 8)}`, p.party as string, `Kora payment by ${p.method}${p.note ? `: ${p.note}` : ''}`,
        [{ ledger: into, amount: -amount }, { ledger: p.party as string, amount }]));
      receipts++;
    }

    const masters = [
      ...[...parties].sort().map((n) => master(n, 'Sundry Debtors')),
      master(cfg.salesLedger, 'Sales Accounts'),
      ...[cfg.cgstLedger, cfg.sgstLedger, cfg.igstLedger, cfg.cessLedger, cfg.tcsLedger].map((n) => master(n, 'Duties & Taxes')),
      master(cfg.roundOffLedger, 'Indirect Expenses'), master(cfg.cashLedger, 'Cash-in-Hand'), master(cfg.bankLedger, 'Bank Accounts'), master(cfg.tdsLedger, 'Current Assets'),
    ];
    const wrap = (report: string, body: string[]) => `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC>`
      + `<REPORTNAME>${report}</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>`
      + `<REQUESTDATA>${body.join('')}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
    // Ledgers first, then vouchers, as two envelopes in one file so the vouchers find their ledgers.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${wrap('All Masters', masters)}\n${wrap('Vouchers', messages)}\n`;
    const counts = { sales, creditNotes, receipts, skipped, cancelledNotExported: cancelled[0]!.n as number };
    await tx`insert into data_export (business_id, user_id, kind, detail) values (${t.businessId}, ${t.userId}, 'tally', ${tx.json({ ...counts, from, to } as never)})`;
    return { xml, counts, filename: `kora_tally_${from}_to_${to}.xml` };
  });
}
