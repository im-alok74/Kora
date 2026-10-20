import { formatRupees, rupeesInWords } from '@kora/tax';
import { esc } from './render.js';

/** What a receipt for one payment needs. Shapes match the database rows (snake_case, bigints as strings). */
export interface ReceiptInput {
  payment: { id: string; amount_paise: string; method: string; received_on: string; note?: string | null };
  /** The invoices this payment was applied to. Empty for an advance that is still held. */
  allocations: { number: string; doc_type: string; grand_total_paise: string; settled_paise: string; allocated_paise: string }[];
  supplier: Record<string, any>;
  recipient: Record<string, any> | null;
  accent?: string;
}

const METHOD: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', netbanking: 'Net banking', bank_transfer: 'Bank transfer', cheque: 'Cheque', tds: 'Tax deducted by the customer', client_money: 'Money held for the client', other: 'Other' };
const money = (p: unknown) => formatRupees(BigInt(String(p ?? 0)), { symbol: '' }).trim();

/** A receipt for money received. It is a receipt, not a tax invoice, and says so. */
export function receiptNumber(p: { id: string; received_on: string }): string {
  return `RCPT-${String(p.received_on).slice(0, 10).replace(/-/g, '')}-${p.id.replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

export function renderReceiptHtml(i: ReceiptInput): string {
  const { payment: p, allocations, supplier: s, recipient: r } = i;
  const accent = /^#[0-9a-fA-F]{6}$/.test(i.accent ?? '') ? i.accent! : '#0b5d4f';
  const name = s.trade_name || s.legal_name;
  const addr = [s.address?.line1, s.address?.line2, [s.address?.city, s.address?.pincode].filter(Boolean).join(' ')].filter(Boolean).map(esc).join('<br>');
  const rows = allocations.map((a) => {
    const left = BigInt(a.grand_total_paise) - BigInt(a.settled_paise);
    return `<tr><td>${esc(a.number)}</td><td class="n">${money(a.grand_total_paise)}</td><td class="n">${money(a.allocated_paise)}</td><td class="n">${left > 0n ? money(left) : 'Paid in full'}</td></tr>`;
  }).join('');
  const held = BigInt(p.amount_paise) - allocations.reduce((a, x) => a + BigInt(x.allocated_paise), 0n);
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Receipt ${esc(receiptNumber(p))}</title><style>
@page { size: A5; margin: 12mm; }
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#fff;color:#1b2321;font:13px/1.5 Inter,system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Devanagari","Noto Sans Gujarati",sans-serif;font-variant-numeric:tabular-nums}
.page{max-width:620px;margin:0 auto;padding:24px}
.page:before{content:"";display:block;height:6px;border-radius:3px;background:${accent};margin-bottom:18px}
.hd{display:flex;justify-content:space-between;gap:20px;align-items:flex-start}.hd .nm{font-size:1.4em;font-weight:700;display:block}
h1{font-size:24px;margin:0;color:${accent};line-height:1.1;text-align:right}
.meta{margin:16px 0;border:1px solid #e1e7e4;border-radius:10px;display:flex;background:color-mix(in srgb,${accent} 5%,#fff)}
.meta>div{flex:1;padding:9px 14px;border-right:1px solid #e1e7e4}.meta>div:last-child{border-right:0}
.k{display:block;font-size:.78em;text-transform:uppercase;letter-spacing:.06em;color:#66726d}
.big{margin:14px 0;padding:14px 16px;border-radius:10px;background:${accent};color:#fff}.big b{font-size:1.9em;display:block}.big span{opacity:.92}
table{width:100%;border-collapse:collapse;margin-top:8px}th{background:color-mix(in srgb,${accent} 9%,#fff);text-align:left;padding:7px 8px;font-size:.78em;text-transform:uppercase;letter-spacing:.05em;color:#33403b;border-top:1px solid #dae2de;border-bottom:1px solid #dae2de}
td{padding:8px;border-bottom:1px solid #edf0ee}.n{text-align:right;white-space:nowrap}th.n{text-align:right}
.note{margin-top:12px;color:#66726d;font-size:.92em}.sign{margin-top:28px;text-align:right}.sign div{display:inline-block;border-top:1px solid #8a948f;padding-top:5px;min-width:180px;text-align:center}
</style></head><body><div class="page">
<div class="hd"><div><span class="nm">${esc(name)}</span>${addr}${s.phone ? `<br>Ph: ${esc(s.phone)}` : ''}${s.gstin ? `<br><b>GSTIN:</b> ${esc(s.gstin)}` : ''}</div><div><h1>Payment Receipt</h1></div></div>
<div class="meta"><div><span class="k">Receipt no.</span><b>${esc(receiptNumber(p))}</b></div><div><span class="k">Date received</span><b>${esc(String(p.received_on).slice(0, 10))}</b></div><div><span class="k">Paid by</span><b>${esc(METHOD[p.method] ?? p.method)}</b></div></div>
<p>Received with thanks from <b>${esc(r?.name ?? 'the customer')}</b>${r?.gstin ? ` (GSTIN ${esc(r.gstin)})` : ''}.</p>
<div class="big"><span>Amount received</span><b>Rs ${money(p.amount_paise)}</b><span>${esc(rupeesInWords(BigInt(p.amount_paise)))}</span></div>
${allocations.length ? `<table><thead><tr><th>Against invoice</th><th class="n">Invoice total</th><th class="n">This payment</th><th class="n">Balance after</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
${held > 0n ? `<p class="note">Rs ${money(held)} of this payment is held as an advance and will be applied to a later invoice.</p>` : ''}
${p.note ? `<p class="note">Note: ${esc(p.note)}</p>` : ''}
<p class="note">This is a receipt for money received. It is not a tax invoice.</p>
<div class="sign"><div>Authorised signatory<br>${esc(name)}</div></div>
</div></body></html>`;
}
