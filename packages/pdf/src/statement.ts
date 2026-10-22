import { formatRupees } from '@kora/tax';
import { esc } from './render.js';

/** What a statement of account needs. Shapes match the database rows (snake_case, bigints as strings). */
export interface StatementInput {
  supplier: Record<string, any>;
  customer: { name: string; gstin?: string | null };
  from: string;
  to: string;
  opening: string;
  closing: string;
  rows: { date: string; description: string; debit: string; credit: string; balance: string }[];
  /** What is still owed, by how late it is. Keys: not_due, d1_30, d31_60, d61_90, d90_plus. */
  ageing: Record<string, string>;
  accent?: string;
}

const money = (p: unknown) => formatRupees(BigInt(String(p ?? 0)), { symbol: '' }).trim();
const cell = (p: string) => (BigInt(p) === 0n ? '' : money(p));
const BUCKETS: [string, string][] = [['not_due', 'Not yet due'], ['d1_30', '1 to 30 days late'], ['d31_60', '31 to 60 days'], ['d61_90', '61 to 90 days'], ['d90_plus', 'Over 90 days']];

/** A customer's statement of account as a printable page, with what is owed by age at the foot. */
export function renderStatementHtml(i: StatementInput): string {
  const s = i.supplier;
  const accent = /^#[0-9a-fA-F]{6}$/.test(i.accent ?? '') ? i.accent! : '#0b5d4f';
  const name = s.trade_name || s.legal_name;
  const addr = [s.address?.line1, s.address?.line2, [s.address?.city, s.address?.pincode].filter(Boolean).join(' ')].filter(Boolean).map(esc).join('<br>');
  const rows = i.rows.map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.description)}</td><td class="n">${cell(r.debit)}</td><td class="n">${cell(r.credit)}</td><td class="n">${money(r.balance)}</td></tr>`).join('');
  const owed = BigInt(i.closing);
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Statement of account ${esc(i.customer.name)}</title><style>
@page { size: A4; margin: 12mm; }
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#fff;color:#1b2321;font:12.5px/1.5 Inter,system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Devanagari","Noto Sans Gujarati",sans-serif;font-variant-numeric:tabular-nums}
.page{max-width:780px;margin:0 auto;padding:20px}
.page:before{content:"";display:block;height:6px;border-radius:3px;background:${accent};margin-bottom:16px}
.hd{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.hd .nm{font-size:1.4em;font-weight:700;display:block}
h1{font-size:22px;margin:0;color:${accent};line-height:1.1;text-align:right}
.meta{margin:14px 0;border:1px solid #e1e7e4;border-radius:10px;display:flex;background:color-mix(in srgb,${accent} 5%,#fff)}
.meta>div{flex:1;padding:9px 14px;border-right:1px solid #e1e7e4}.meta>div:last-child{border-right:0}
.k{display:block;font-size:.78em;text-transform:uppercase;letter-spacing:.06em;color:#66726d}
table{width:100%;border-collapse:collapse;margin-top:8px}
th{background:color-mix(in srgb,${accent} 9%,#fff);text-align:left;padding:7px 8px;font-size:.78em;text-transform:uppercase;letter-spacing:.05em}
td{padding:7px 8px;border-bottom:1px solid #edf0ee;vertical-align:top}.n{text-align:right;white-space:nowrap}th.n{text-align:right}
tr.sum td{font-weight:700;border-top:2px solid ${accent}}
.due{margin:14px 0;padding:12px 16px;border-radius:10px;background:${accent};color:#fff;display:flex;justify-content:space-between;align-items:center}.due b{font-size:1.6em}
h2{font-size:1em;margin:18px 0 4px;color:${accent}}
.note{margin-top:12px;color:#66726d;font-size:.92em}
</style></head><body><div class="page">
<div class="hd"><div><span class="nm">${esc(name)}</span>${addr}${s.phone ? `<br>Ph: ${esc(s.phone)}` : ''}${s.gstin ? `<br><b>GSTIN:</b> ${esc(s.gstin)}` : ''}</div><div><h1>Statement of Account</h1></div></div>
<div class="meta"><div><span class="k">Customer</span><b>${esc(i.customer.name)}</b>${i.customer.gstin ? `<br>GSTIN ${esc(i.customer.gstin)}` : ''}</div><div><span class="k">Period</span><b>${esc(i.from)} to ${esc(i.to)}</b></div></div>
<table><thead><tr><th>Date</th><th>Description</th><th class="n">Billed</th><th class="n">Received or credited</th><th class="n">Balance</th></tr></thead><tbody>
<tr><td colspan="4">Opening balance (${esc(i.from)})</td><td class="n">${money(i.opening)}</td></tr>${rows}
<tr class="sum"><td colspan="4">Closing balance (${esc(i.to)})</td><td class="n">${money(i.closing)}</td></tr></tbody></table>
<div class="due"><span>${owed > 0n ? 'Amount due' : owed < 0n ? 'Credit in your favour' : 'Nothing due'}</span><b>Rs ${money(owed < 0n ? (-owed).toString() : i.closing)}</b></div>
<h2>What is owed, by age</h2>
<table><thead><tr>${BUCKETS.map(([, l]) => `<th class="n">${l}</th>`).join('')}</tr></thead><tbody><tr>${BUCKETS.map(([k]) => `<td class="n">${money(i.ageing[k] ?? '0')}</td>`).join('')}</tr></tbody></table>
<p class="note">Age is counted from the due date of each unpaid invoice. If something here looks wrong, please contact ${esc(name)}${s.phone ? ` on ${esc(s.phone)}` : ''}.</p>
</div></body></html>`;
}
