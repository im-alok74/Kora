import { formatRupees, rupeesInWords, STATE_NAMES } from '@kora/tax';
import { labelsFor, titleFor } from './labels.js';

/** Data the renderer needs. Shapes match the database rows (snake_case, bigints as strings). */
export interface RenderInput {
  doc: Record<string, any>;            // document row
  lines: Record<string, any>[];        // document_line rows
  supplier: Record<string, any>;       // business row or supplier_snapshot
  recipient: Record<string, any> | null; // party row or recipient_snapshot
  template: Record<string, any>;       // TemplateConfig (already sanitised by core)
  /** Reserved for later steps: IRN and QR, UPI QR. Printed only when present. */
  irn?: { irn: string; ackNo: string; ackDate: string; qrDataUrl?: string } | null;
  /** A UPI QR for the amount still due. Printed only when present and the template allows it. */
  upi?: { qrDataUrl: string; vpa: string; amountText: string } | null;
}

const TITLES: Record<string, string> = {
  tax_invoice: 'Tax Invoice', bill_of_supply: 'Bill of Supply', estimate: 'Estimate', proforma: 'Proforma Invoice',
  delivery_challan: 'Delivery Challan', credit_note: 'Credit Note', debit_note: 'Debit Note',
};

/** The two extra looks. They only restyle the same blocks, so every statutory field is still printed. */
const LAYOUT_CSS = (accent: string) => `
.lay-modern:before,.lay-minimal:before{display:none}
.lay-modern .hd{background:${accent};color:#fff;border-radius:12px;padding:20px 22px}
.lay-modern .hd .brand,.lay-modern .hd .brand .nm,.lay-modern h1,.lay-modern .subj{color:#fff}
.lay-modern .paidtag{border-color:#fff;color:#fff}
.lay-modern table.items th{background:${accent};color:#fff;border:0}
.lay-modern .meta4{border-color:transparent;background:color-mix(in srgb,${accent} 8%,#fff)}
.lay-minimal h1{color:#1b2321;font-weight:600;letter-spacing:.04em;text-transform:uppercase;font-size:22px}
.lay-minimal .card,.lay-minimal .totbox,.lay-minimal .payrow>div,.lay-minimal .irn{border:0;border-radius:0;background:transparent;padding-left:0;padding-right:0}
.lay-minimal .meta4{border:0;border-top:1px solid #1b2321;border-bottom:1px solid #1b2321;border-radius:0;background:transparent}
.lay-minimal .meta4>div{border-right:0;padding-left:0}
.lay-minimal table.items th{background:transparent;border-top:1px solid #1b2321;border-bottom:1px solid #1b2321;color:#1b2321}
.lay-minimal .tot tr.g td{background:transparent;color:#1b2321;border-top:2px solid #1b2321;border-bottom:2px solid #1b2321}
.lay-minimal .paidtag{border-color:#1b2321;color:#1b2321}
`;

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
const money = (p: unknown) => formatRupees(BigInt(String(p ?? 0)), { symbol: '' }).trim();
const pct = (bp: number) => `${(bp / 100).toString().replace(/\.0+$/, '')}%`;
const addr = (a: Record<string, any> | null | undefined) =>
  [a?.line1, a?.line2, [a?.city, a?.pincode].filter(Boolean).join(' ')].filter(Boolean).map(esc).join('<br>');

function accentColour(t: Record<string, any>): string {
  return /^#[0-9a-fA-F]{6}$/.test(t.accent) ? t.accent : '#0b5d4f';
}

/**
 * One layout engine for the PDF, the public page and the editor preview.
 * Statutory fields are printed from code. The template can change colour, font, size and optional
 * sections, never these.
 */
export function renderDocumentHtml(i: RenderInput): string {
  const { doc: d, lines, supplier: s, recipient: r, template: t } = i;
  if (t.layout === 'thermal') return renderThermalHtml(i);
  const L = labelsFor(t.language);
  const narrative = t.layout === 'narrative';
  const compact = t.layout === 'compact';
  const lay = t.layout === 'modern' || t.layout === 'minimal' ? t.layout : 'classic';
  const serif = t.font === 'serif';
  const accent = accentColour(t);
  const intra = s.state_code === d.place_of_supply;
  const showTax = d.doc_type !== 'bill_of_supply';
  const title = t.language && t.language !== 'en' ? titleFor(t.language, d.doc_type) : (TITLES[d.doc_type] ?? 'Document');
  const draftMark = d.status === 'draft' ? '<div class="mark">DRAFT</div>' : d.status === 'cancelled' ? '<div class="mark">CANCELLED</div>' : '';
  const place = STATE_NAMES[d.place_of_supply] ? `${STATE_NAMES[d.place_of_supply]} (${esc(d.place_of_supply)})` : esc(d.place_of_supply);
  const bank = (s.bank_details ?? {}) as Record<string, any>;
  const rcm = d.reverse_charge === true;

  const taxHead = !showTax ? '' : intra
    ? '<th class="n">CGST</th><th class="n">SGST</th>' : '<th class="n">IGST</th>';
  const rows = lines.map((l, idx) => {
    const taxCells = !showTax ? '' : intra
      ? `<td class="n">${pct(l.tax_rate_bp / 2)}<br>${money(l.cgst_paise)}</td><td class="n">${pct(l.tax_rate_bp / 2)}<br>${money(l.sgst_paise)}</td>`
      : `<td class="n">${pct(l.tax_rate_bp)}<br>${money(l.igst_paise)}</td>`;
    const disc = BigInt(l.discount_paise) > 0n ? money(l.discount_paise) : '-';
    if (narrative) return `<tr><td>${idx + 1}</td><td>${esc(l.item_name)}</td><td>${esc(l.hsn_sac ?? '')}</td><td class="n">${money(l.taxable_paise)}</td>${taxCells}</tr>`;
    return `<tr><td>${idx + 1}</td><td>${esc(l.item_name)}</td><td>${esc(l.hsn_sac ?? '')}</td>
      <td class="n">${esc(String(l.quantity).replace(/\.?0+$/, ''))} ${esc(l.unit)}</td><td class="n">${money(l.rate_paise)}${l.price_includes_tax ? `<br><small>${esc(L.inclusive)}</small>` : ''}</td>
      <td class="n">${disc}</td><td class="n">${money(l.taxable_paise)}</td>${taxCells}</tr>`;
  }).join('');

  // A quote in another currency: amounts are in that currency and no rupee rounding or words are shown.
  const foreign = !!d.currency && d.currency !== 'INR';
  const rateMicro = BigInt(String(d.exchange_rate_micro ?? 1_000_000));
  const rateText = `${rateMicro / 1_000_000n}.${(rateMicro % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0')}`;
  const totals: [string, string][] = [[L.taxableValue, money(d.taxable_paise)]];
  if (showTax) {
    if (BigInt(d.cgst_paise) > 0n || intra) { totals.push(['CGST', money(d.cgst_paise)], ['SGST', money(d.sgst_paise)]); }
    if (BigInt(d.igst_paise) > 0n || !intra) totals.push(['IGST', money(d.igst_paise)]);
    if (BigInt(d.cess_paise) > 0n) totals.push(['Cess', money(d.cess_paise)]);
  }
  if (BigInt(d.tcs_paise) > 0n) totals.push(['TCS', money(d.tcs_paise)]);
  if (BigInt(d.round_off_paise) !== 0n) totals.push([L.roundOff, (BigInt(d.round_off_paise) < 0n ? '-' : '') + money(BigInt(d.round_off_paise) < 0n ? -BigInt(d.round_off_paise) : d.round_off_paise)]);
  const totalRows = totals.map(([k, v]) => `<tr><td>${k}</td><td class="n">${v}</td></tr>`).join('');

  const optional = (show: boolean, title: string, text: unknown) =>
    show && text ? `<div class="note"><b>${title}</b><br>${esc(text).replace(/\n/g, '<br>')}</div>` : '';
  const bankBlock = t.showBank && (bank.accountNumber || s.upi_vpa)
    ? `<div class="note"><b>${esc(L.payTo)}</b><br>${[bank.accountName && `A/c name: ${esc(bank.accountName)}`, bank.accountNumber && `A/c no: ${esc(bank.accountNumber)}`,
        bank.ifsc && `IFSC: ${esc(bank.ifsc)}`, bank.bankName && esc(bank.bankName), s.upi_vpa && `UPI: ${esc(s.upi_vpa)}`].filter(Boolean).join('<br>')}</div>` : '';
  const irnBlock = i.irn
    ? `<div class="irn"><div><b>IRN</b> ${esc(i.irn.irn)}<br><b>Ack no</b> ${esc(i.irn.ackNo)} &nbsp; <b>Ack date</b> ${esc(i.irn.ackDate)}</div>${i.irn.qrDataUrl && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(i.irn.qrDataUrl) ? `<img src="${i.irn.qrDataUrl}" alt="e-invoice QR">` : ''}</div>` : '';
  const upiBlock = i.upi && t.showUpiQr !== false && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(i.upi.qrDataUrl)
    ? `<div class="upi"><img src="${i.upi.qrDataUrl}" alt="UPI QR code"><div><b>${esc(L.scanToPay)} ${esc(i.upi.amountText)}</b><br>UPI: ${esc(i.upi.vpa)}</div></div>` : '';
  const logo = t.logoDataUrl && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(t.logoDataUrl) ? `<img class="logo" src="${t.logoDataUrl}" alt="">` : '';

  const supplierName = s.trade_name || s.legal_name;
  const cell = (k: string, v: string) => `<div><span class="k">${esc(k)}</span><b>${v}</b></div>`;
  const metaCells = [cell(L.no, esc(d.number ?? 'Draft')), cell(L.date, esc(d.doc_date)), d.due_date ? cell(L.due, esc(d.due_date)) : '',
    d.original_number ? cell(L.against, esc(d.original_number)) : '', d.reference ? cell(L.reference, esc(d.reference)) : '', d.salesperson ? cell(L.salesperson, esc(d.salesperson)) : '', cell(L.placeOfSupply, place)].join('');
  const extraCells = Array.isArray(d.extra) ? d.extra.map((x: { label: string; value: string }) => cell(String(x.label ?? ''), esc(x.value))).join('') : '';
  const ship = r?.shipping_address && Object.keys(r.shipping_address).length ? addr(r.shipping_address) : '';

  // The tax by HSN or SAC and rate: the summary a buyer and an auditor look for first.
  const byHsn = new Map<string, { hsn: string; bp: number; taxable: bigint; tax: bigint }>();
  for (const l of lines) {
    const k = `${l.hsn_sac ?? ''}|${l.tax_rate_bp}`;
    const g = byHsn.get(k) ?? { hsn: String(l.hsn_sac ?? ''), bp: Number(l.tax_rate_bp), taxable: 0n, tax: 0n };
    g.taxable += BigInt(l.taxable_paise); g.tax += BigInt(l.cgst_paise) + BigInt(l.sgst_paise) + BigInt(l.igst_paise);
    byHsn.set(k, g);
  }
  const taxSummary = showTax && !narrative && byHsn.size > 0
    ? `<table class="hsn"><thead><tr><th>HSN/SAC</th><th class="n">${esc(L.taxable)}</th><th class="n">GST %</th><th class="n">GST</th></tr></thead><tbody>${[...byHsn.values()]
        .map((g) => `<tr><td>${esc(g.hsn) || '-'}</td><td class="n">${money(g.taxable)}</td><td class="n">${pct(g.bp)}</td><td class="n">${money(g.tax)}</td></tr>`).join('')}</tbody></table>` : '';
  const payRow = bankBlock || upiBlock ? `<div class="payrow">${bankBlock}${upiBlock}</div>` : '';
  const tdsRows = BigInt(d.tds_paise ?? 0) > 0n
    ? `<tr class="sub"><td>${esc(L.tdsLess)}</td><td class="n">${money(d.tds_paise)}</td></tr><tr class="sub"><td>${esc(L.netPayable)}</td><td class="n">${money(BigInt(d.grand_total_paise) - BigInt(d.tds_paise))}</td></tr>` : '';

  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} ${esc(d.number ?? '')}</title><style>
@page { size: ${t.paper === 'A5' ? 'A5' : 'A4'}; margin: 12mm; }
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#fff;color:#1b2321;font:${compact ? 11 : 12.5}px/1.5 ${serif ? 'Georgia,"Source Serif 4","Noto Serif Devanagari","Noto Serif Gujarati",serif' : 'Inter,system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Devanagari","Noto Sans Gujarati",sans-serif'};font-variant-numeric:tabular-nums}
.page{position:relative;max-width:820px;margin:0 auto;padding:${compact ? 12 : 28}px}
.page:before{content:"";display:block;height:6px;border-radius:3px;background:${accent};margin-bottom:${compact ? 10 : 20}px}
.hd{display:flex;justify-content:space-between;align-items:flex-start;gap:24px}
.brand{color:#4a5651;line-height:1.55}.brand .nm{display:block;font-size:1.5em;font-weight:700;color:#1b2321;line-height:1.25}
.logo{max-height:58px;max-width:170px;display:block;margin-bottom:8px}
.doc{text-align:right}.paidtag{display:inline-block;margin-top:8px;padding:2px 14px;border:2px solid #1b6b40;color:#1b6b40;border-radius:6px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;transform:rotate(-3deg)}.subj{margin-top:6px;color:#4a5651;max-width:320px;margin-left:auto;font-size:1.02em}
h1{font-size:${compact ? 20 : 28}px;margin:0;color:${accent};font-weight:700;letter-spacing:-.01em;line-height:1.1}
.meta4{display:flex;flex-wrap:wrap;margin:${compact ? 12 : 20}px 0 14px;border:1px solid #e1e7e4;border-radius:10px;overflow:hidden;background:color-mix(in srgb,${accent} 5%,#fff)}
.meta4>div{flex:1 1 130px;padding:9px 14px;border-right:1px solid #e1e7e4}.meta4>div:last-child{border-right:0}.meta4.extra{margin-top:-6px;background:#fff}
.k,.lbl{display:block;font-size:.78em;text-transform:uppercase;letter-spacing:.06em;color:#66726d;margin-bottom:3px}
.parties{display:flex;gap:14px;margin:0 0 16px}.card{flex:1;border:1px solid #e1e7e4;border-radius:10px;padding:11px 14px}
.card b.who{font-size:1.1em}
table.items{width:100%;border-collapse:collapse;font-size:.97em}
table.items th{background:color-mix(in srgb,${accent} 9%,#fff);color:#33403b;text-align:left;padding:8px;font-weight:600;font-size:.78em;text-transform:uppercase;letter-spacing:.05em;border-top:1px solid #dae2de;border-bottom:1px solid #dae2de}
table.items td{padding:9px 8px;border-bottom:1px solid #edf0ee;vertical-align:top}
table.items tbody tr:last-child td{border-bottom:1px solid #dae2de}
.n{text-align:right;white-space:nowrap} table.items th.n{text-align:right}
small{color:#66726d}
.bottom{display:flex;gap:22px;margin-top:16px;align-items:flex-start}.bottom>div{flex:1}
.totbox{border:1px solid #e1e7e4;border-radius:10px;overflow:hidden}
table.tot{width:100%;border-collapse:collapse}.tot td{padding:6px 14px;color:#4a5651}.tot td.n{color:#1b2321}
.tot tr.g td{background:${accent};color:#fff;font-weight:700;font-size:1.2em;padding:11px 14px}
.tot tr.sub td{font-size:.92em;color:#66726d}
.words{font-weight:600;color:#33403b;margin-bottom:8px}
.rcm{margin:8px 0;font-weight:600;color:#8a4b00}
.payrow{display:flex;flex-direction:column;gap:10px;margin-top:10px}.payrow>div{flex:1;margin:0;border:1px solid #e1e7e4;border-radius:10px;padding:10px 14px}
.upi{display:flex;gap:12px;align-items:center}.upi img{width:92px;height:92px}
.note{margin-top:10px;color:#33403b}
table.hsn{width:100%;border-collapse:collapse;margin-top:18px;font-size:.88em}
table.hsn th{text-align:left;padding:6px 8px;color:#66726d;font-weight:600;font-size:.85em;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #dae2de}
table.hsn th.n{text-align:right}
table.hsn td{padding:5px 8px;border-bottom:1px solid #edf0ee}
.irn{display:flex;justify-content:space-between;gap:12px;border:1px solid #e1e7e4;border-radius:10px;padding:10px 14px;margin-top:14px;word-break:break-all}.irn img{width:92px;height:92px}
.sign{margin-top:30px;text-align:right}.sign div{display:inline-block;border-top:1px solid #8a948f;padding-top:5px;min-width:200px;text-align:center;color:#33403b}
.foot{margin-top:18px;padding-top:10px;border-top:1px solid #e1e7e4;color:#66726d;text-align:center;font-size:.9em}
.mark{position:absolute;top:38%;left:14%;font-size:92px;font-weight:800;color:rgba(168,39,39,.11);transform:rotate(-20deg);pointer-events:none}
tr,.card,.totbox,.payrow{break-inside:avoid}
@media screen and (max-width:640px){.hd,.parties,.bottom,.payrow{flex-direction:column}.doc{text-align:left}table.items{display:block;overflow-x:auto}}
${LAYOUT_CSS(accent)}
/* Document typography and print layout: shared by previews and exported PDFs. */
body{color:#202a35;line-height:1.6}
.page:before{height:3px;border-radius:0;margin-bottom:24px}
.hd{padding-bottom:8px;gap:30px}.brand{font-size:.94em;color:#596471;max-width:56%;overflow-wrap:anywhere}
.brand .nm{font-size:1.65em;font-weight:650;letter-spacing:-.025em;margin-bottom:7px;color:#202a35}
h1{font-size:${compact ? 22 : 30}px;font-weight:500;letter-spacing:-.035em;line-height:1.2}
.doc{flex-shrink:0;max-width:44%}.subj{font-size:.9em;line-height:1.6;overflow-wrap:anywhere}
.paidtag{transform:none;font-size:.75em;letter-spacing:.07em;border-width:1px;border-radius:3px;padding:3px 10px;font-weight:600}
.meta4{border:0;border-top:1px solid #dbe1e7;border-bottom:1px solid #dbe1e7;border-radius:0;background:#fff;margin:24px 0 22px}
.meta4>div{padding:11px 12px;border-right:0}.meta4>div:first-child{padding-left:0}.meta4 b{font-weight:550}
.k,.lbl{font-size:.75em;letter-spacing:.07em;color:#687482;margin-bottom:5px}
.parties{gap:28px;margin-bottom:25px}.card{border:0;border-radius:0;padding:0;line-height:1.7;min-width:0;overflow-wrap:anywhere}.card b.who{font-size:1.05em;font-weight:650}
table.items th{font-size:.78em;text-transform:none;letter-spacing:0;padding:10px 7px;font-weight:600;background:#f1f4f7;color:#344150;border-top:0;border-bottom:1px solid #d5dde5}
table.items td{padding:${compact ? 7 : 12}px 7px;border-bottom:1px solid #e6ebef;line-height:1.55}
table.items td:nth-child(2){min-width:${compact ? 95 : 115}px;overflow-wrap:anywhere}
table.items th:first-child,table.items td:first-child{width:26px;color:#75808c}
.bottom{gap:28px;margin-top:22px}.bottom>div:first-child{flex:1.15;min-width:0}.bottom>div:last-child{flex:1;min-width:0}
.totbox{border:0;border-top:1px solid #d5dde5;border-radius:0;padding-top:6px}.tot td{padding:6px 10px;font-size:.95em}
.tot tr.g td{border-top:2px solid ${accent};background:color-mix(in srgb,${accent} 7%,white);color:#202a35;font-size:1.15em;padding:12px 10px;font-weight:650}
.words{font-size:.88em;font-weight:500;line-height:1.7}.note{font-size:.9em;line-height:1.75;overflow-wrap:anywhere;margin-top:16px}.note b{font-weight:600}
.payrow>div{border:0;border-left:2px solid #dbe1e7;border-radius:0;padding:2px 0 2px 12px}.upi img{width:80px;height:80px}
table.hsn{margin-top:26px}.sign{margin-top:44px;font-size:.88em}.sign div{padding-top:8px}.foot{font-size:.8em;margin-top:28px}
.lay-modern .hd{border-radius:0;padding:22px}.lay-modern .hd .brand{max-width:56%}.lay-modern .hd h1{color:white}.lay-modern table.items th{background:${accent};color:white}.lay-modern .meta4{background:#fff}
.lay-minimal .tot tr.g td{border-top:2px solid #202a35;border-bottom:0;background:white}.lay-minimal .hd{border-bottom:2px solid #202a35;padding-bottom:20px}
${narrative ? '.page:before{display:none}.hd{border-bottom:2px solid '+accent+';padding-bottom:24px}.brand .nm{font-family:Georgia,serif;font-weight:400}.parties{margin-top:26px}table.items td:nth-child(2){width:65%;line-height:1.85}table.items th{background:white;border-bottom:2px solid #202a35}' : ''}
${compact ? '.meta4{margin:14px 0}.parties{margin-bottom:14px}.page:before{margin-bottom:14px}.bottom{margin-top:14px}' : ''}
thead{display:table-header-group}tfoot{display:table-footer-group}
@media print{.page{max-width:none;padding:0}.hd,.meta4,.parties,.totbox,.sign,.irn{break-inside:avoid}.bottom{display:flex}.bottom>div:first-child{break-inside:auto}.note,.upi{break-inside:avoid}table.items{display:table;width:100%;font-size:${t.paper === 'A5' ? '.8em' : '.97em'}}table.items td:nth-child(2){min-width:0}.n{white-space:normal}.mark{position:fixed}}
@media screen and (max-width:640px){.brand,.doc{max-width:100%}.doc{text-align:left}.bottom>div{width:100%}.meta4{margin-block:18px}.lay-modern .hd .brand{max-width:100%}}
</style></head><body><div class="page lay-${lay}">${draftMark}
<div class="hd"><div class="brand">${logo}<span class="nm">${esc(supplierName)}</span>${supplierName !== s.legal_name ? `${esc(s.legal_name)}<br>` : ''}${addr(s.address)}${s.phone ? `<br>Ph: ${esc(s.phone)}` : ''}${s.email ? `<br>${esc(s.email)}` : ''}
${s.gstin ? `<br><b>GSTIN:</b> ${esc(s.gstin)}` : ''}</div>
<div class="doc"><h1>${esc(title)}</h1>${d.status === 'issued' && d.payment_status === 'paid' && d.doc_type !== 'estimate' ? `<div class="paidtag">${esc(L.paid)}</div>` : ''}${d.subject ? `<div class="subj">${esc(d.subject)}</div>` : ''}</div></div>
<div class="meta4">${metaCells}</div>${extraCells ? `<div class="meta4 extra">${extraCells}</div>` : ''}
<div class="parties"><div class="card"><span class="lbl">${esc(L.billTo)}</span>${r ? `<b class="who">${esc(r.name)}</b><br>${addr(r.billing_address)}${r.gstin ? `<br><b>GSTIN:</b> ${esc(r.gstin)}` : ''}${r.phone ? `<br>Ph: ${esc(r.phone)}` : ''}` : esc(L.walkIn)}</div>
${ship ? `<div class="card"><span class="lbl">${esc(L.shipTo)}</span>${ship}</div>` : ''}</div>
<table class="items"><thead>${narrative ? `<tr><th>#</th><th>Particulars of professional services</th><th>SAC</th><th class="n">Fee</th>${taxHead}</tr>` : `<tr><th>#</th><th>${esc(L.description)}</th><th>HSN/SAC</th><th class="n">${esc(L.qty)}</th><th class="n">${esc(L.rate)}</th><th class="n">${esc(L.discount)}</th><th class="n">${esc(L.taxable)}</th>${taxHead}</tr>`}</thead><tbody>${rows}</tbody></table>
<div class="bottom"><div>${t.showAmountInWords && !foreign ? `<div class="words">${esc(rupeesInWords(BigInt(d.grand_total_paise)))}</div>` : ''}
${rcm ? `<div class="rcm">${esc(L.reverseCharge)}</div>` : ''}
${payRow}${optional(t.showNotes, L.notes, d.notes)}${optional(t.showTerms, L.terms, d.terms)}</div>
<div><div class="totbox"><table class="tot">${totalRows}<tr class="g"><td>${rcm ? L.amountDue : L.total}${foreign ? ` (${esc(d.currency)})` : ''}</td><td class="n">${money(d.grand_total_paise)}</td></tr>
${rcm && showTax ? `<tr class="sub"><td colspan="2">Tax shown above is payable by the recipient.</td></tr>` : ''}
${foreign ? `<tr class="sub"><td colspan="2">All amounts are in ${esc(d.currency)}. Exchange rate used: 1 ${esc(d.currency)} = Rs ${rateText}. This is not a tax invoice.</td></tr>` : ''}
${tdsRows}</table></div></div></div>
${taxSummary}${irnBlock}${t.showSignature ? `<div class="sign"><div>${esc(L.signatory)}<br>${esc(supplierName)}</div></div>` : ''}
${t.footerText ? `<div class="foot">${esc(t.footerText)}</div>` : ''}
</div></body></html>`;
}


/**
 * An 80 mm till receipt. Everything the law needs is still here (supplier and GSTIN, number, date, the tax split by rate, the total),
 * set out in one narrow column the way a thermal printer expects. Item lines show name, then quantity times rate and the line total.
 */
export function renderThermalHtml(i: RenderInput): string {
  const { doc: d, lines, supplier: s, recipient: r, template: t } = i;
  const L = labelsFor(t.language);
  const accent = accentColour(t);
  const intra = s.state_code === d.place_of_supply;
  const showTax = d.doc_type !== 'bill_of_supply';
  const title = t.language && t.language !== 'en' ? titleFor(t.language, d.doc_type) : (TITLES[d.doc_type] ?? 'Document');
  const qty = (q: unknown) => esc(String(q).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''));
  const rows = lines.map((l) => `<div class="it"><div class="nm">${esc(l.item_name)}${l.hsn_sac ? ` <span class="h">${esc(l.hsn_sac)}</span>` : ''}</div>
    <div class="ln"><span>${qty(l.quantity)} ${esc(l.unit)} x ${money(l.rate_paise)}${l.price_includes_tax ? ` ${esc(L.inclusive)}` : ''}</span><span>${money(l.line_total_paise)}</span></div></div>`).join('');
  const byRate = new Map<number, { taxable: bigint; cgst: bigint; sgst: bigint; igst: bigint }>();
  for (const l of lines) {
    const k = Number(l.tax_rate_bp);
    const g = byRate.get(k) ?? { taxable: 0n, cgst: 0n, sgst: 0n, igst: 0n };
    g.taxable += BigInt(l.taxable_paise); g.cgst += BigInt(l.cgst_paise); g.sgst += BigInt(l.sgst_paise); g.igst += BigInt(l.igst_paise);
    byRate.set(k, g);
  }
  const taxRows = showTax ? [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([bp, g]) =>
    `<tr><td>${pct(bp)}</td><td class="n">${money(g.taxable)}</td><td class="n">${intra ? `${money(g.cgst)} + ${money(g.sgst)}` : money(g.igst)}</td></tr>`).join('') : '';
  const upiBlock = i.upi && t.showUpiQr !== false && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(i.upi.qrDataUrl)
    ? `<div class="c"><img src="${i.upi.qrDataUrl}" alt="UPI QR code" width="110" height="110"><br>${esc(L.scanToPay)} ${esc(i.upi.amountText)}</div>` : '';
  const irn = i.irn ? `<div class="sm">IRN ${esc(i.irn.irn)}<br>Ack ${esc(i.irn.ackNo)}</div>` : '';
  const name = s.trade_name || s.legal_name;
  const draft = d.status === 'draft' ? '<div class="c b">DRAFT</div>' : d.status === 'cancelled' ? '<div class="c b">CANCELLED</div>' : '';
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><title>${esc(title)} ${esc(d.number ?? '')}</title><style>
@page { size: 80mm auto; margin: 3mm; }
*{box-sizing:border-box} body{margin:0;width:74mm;background:#fff;color:#000;font:11.5px/1.35 'Courier New',ui-monospace,monospace,'Noto Sans Devanagari','Noto Sans Gujarati'}
.c{text-align:center}.b{font-weight:700}.sm{font-size:9.5px;word-break:break-all}.h{color:#444;font-size:9.5px}
hr{border:0;border-top:1px dashed #000;margin:6px 0}
.ln{display:flex;justify-content:space-between;gap:6px}.nm{font-weight:700}.it{margin:3px 0}
table{width:100%;border-collapse:collapse;font-size:10.5px}td,th{padding:1px 0;text-align:left}.n{text-align:right}
.tot{display:flex;justify-content:space-between;font-weight:700;font-size:14px;margin-top:3px;border-top:1px solid ${accent};padding-top:3px}
</style></head><body>
${draft}<div class="c b" style="font-size:14px">${esc(name)}</div>
<div class="c">${[s.address?.line1, s.address?.city].filter(Boolean).map(esc).join(', ')}${s.phone ? `<br>Ph: ${esc(s.phone)}` : ''}${s.gstin ? `<br>GSTIN: ${esc(s.gstin)}` : ''}</div>
<hr><div class="c b">${esc(title)}</div>
<div class="ln"><span>${esc(L.no)} ${esc(d.number ?? 'Draft')}</span><span>${esc(d.doc_date)}</span></div>
${r ? `<div>${esc(r.name)}${r.gstin ? `<br>GSTIN: ${esc(r.gstin)}` : ''}</div>` : `<div>${esc(L.walkIn)}</div>`}
<div class="sm">${esc(L.placeOfSupply)}: ${esc(STATE_NAMES[d.place_of_supply] ?? d.place_of_supply)} (${esc(d.place_of_supply)})</div>
<hr>${rows}<hr>
${showTax ? `<table><thead><tr><th>GST</th><th class="n">${esc(L.taxable)}</th><th class="n">${intra ? 'CGST + SGST' : 'IGST'}</th></tr></thead><tbody>${taxRows}</tbody></table>` : ''}
${BigInt(d.round_off_paise ?? 0) !== 0n ? `<div class="ln"><span>${esc(L.roundOff)}</span><span>${BigInt(d.round_off_paise) < 0n ? '-' : ''}${money(BigInt(d.round_off_paise) < 0n ? -BigInt(d.round_off_paise) : d.round_off_paise)}</span></div>` : ''}
<div class="tot"><span>${esc(L.total)}</span><span>${money(d.grand_total_paise)}</span></div>
${d.reverse_charge === true ? `<div class="sm">${esc(L.reverseCharge)}</div>` : ''}
${upiBlock}${irn}${t.footerText ? `<hr><div class="c">${esc(t.footerText)}</div>` : `<hr><div class="c">${esc(L.thanks)}</div>`}
</body></html>`;
}
