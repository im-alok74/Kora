import { formatRupees, rupeesInWords, STATE_NAMES } from '@kora/tax';

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
  const compact = t.layout === 'compact';
  const serif = t.font === 'serif';
  const accent = accentColour(t);
  const intra = s.state_code === d.place_of_supply;
  const showTax = d.doc_type !== 'bill_of_supply';
  const title = TITLES[d.doc_type] ?? 'Document';
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
    return `<tr><td>${idx + 1}</td><td>${esc(l.item_name)}</td><td>${esc(l.hsn_sac ?? '')}</td>
      <td class="n">${esc(String(l.quantity).replace(/\.?0+$/, ''))} ${esc(l.unit)}</td><td class="n">${money(l.rate_paise)}</td>
      <td class="n">${disc}</td><td class="n">${money(l.taxable_paise)}</td>${taxCells}</tr>`;
  }).join('');

  // A quote in another currency: amounts are in that currency and no rupee rounding or words are shown.
  const foreign = !!d.currency && d.currency !== 'INR';
  const rateMicro = BigInt(String(d.exchange_rate_micro ?? 1_000_000));
  const rateText = `${rateMicro / 1_000_000n}.${(rateMicro % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '').padEnd(2, '0')}`;
  const totals: [string, string][] = [['Taxable value', money(d.taxable_paise)]];
  if (showTax) {
    if (BigInt(d.cgst_paise) > 0n || intra) { totals.push(['CGST', money(d.cgst_paise)], ['SGST', money(d.sgst_paise)]); }
    if (BigInt(d.igst_paise) > 0n || !intra) totals.push(['IGST', money(d.igst_paise)]);
    if (BigInt(d.cess_paise) > 0n) totals.push(['Cess', money(d.cess_paise)]);
  }
  if (BigInt(d.tcs_paise) > 0n) totals.push(['TCS', money(d.tcs_paise)]);
  if (BigInt(d.round_off_paise) !== 0n) totals.push(['Round off', (BigInt(d.round_off_paise) < 0n ? '-' : '') + money(BigInt(d.round_off_paise) < 0n ? -BigInt(d.round_off_paise) : d.round_off_paise)]);
  const totalRows = totals.map(([k, v]) => `<tr><td>${k}</td><td class="n">${v}</td></tr>`).join('');

  const optional = (show: boolean, title: string, text: unknown) =>
    show && text ? `<div class="note"><b>${title}</b><br>${esc(text).replace(/\n/g, '<br>')}</div>` : '';
  const bankBlock = t.showBank && (bank.accountNumber || s.upi_vpa)
    ? `<div class="note"><b>Pay to</b><br>${[bank.accountName && `A/c name: ${esc(bank.accountName)}`, bank.accountNumber && `A/c no: ${esc(bank.accountNumber)}`,
        bank.ifsc && `IFSC: ${esc(bank.ifsc)}`, bank.bankName && esc(bank.bankName), s.upi_vpa && `UPI: ${esc(s.upi_vpa)}`].filter(Boolean).join('<br>')}</div>` : '';
  const irnBlock = i.irn
    ? `<div class="irn"><div><b>IRN</b> ${esc(i.irn.irn)}<br><b>Ack no</b> ${esc(i.irn.ackNo)} &nbsp; <b>Ack date</b> ${esc(i.irn.ackDate)}</div>${i.irn.qrDataUrl && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(i.irn.qrDataUrl) ? `<img src="${i.irn.qrDataUrl}" alt="e-invoice QR">` : ''}</div>` : '';
  const upiBlock = i.upi && t.showUpiQr !== false && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(i.upi.qrDataUrl)
    ? `<div class="upi"><img src="${i.upi.qrDataUrl}" alt="UPI QR code"><div><b>Scan to pay ${esc(i.upi.amountText)}</b><br>UPI: ${esc(i.upi.vpa)}</div></div>` : '';
  const logo = t.logoDataUrl && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(t.logoDataUrl) ? `<img class="logo" src="${t.logoDataUrl}" alt="">` : '';

  const supplierName = s.trade_name || s.legal_name;
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} ${esc(d.number ?? '')}</title><style>
@page { size: ${t.paper === 'A5' ? 'A5' : 'A4'}; margin: 12mm; }
*{box-sizing:border-box} body{margin:0;background:#fff;color:#17201d;font:${compact ? 11 : 12.5}px/1.45 ${serif ? 'Georgia,"Source Serif 4",serif' : 'Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'};font-variant-numeric:tabular-nums}
.page{position:relative;max-width:820px;margin:0 auto;padding:${compact ? 12 : 24}px}
h1{font-size:${compact ? 18 : 22}px;margin:0;color:${accent};letter-spacing:.02em;text-transform:uppercase}
.top{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid ${accent};padding-bottom:10px}
.logo{max-height:56px;max-width:160px;display:block;margin-bottom:6px}
.meta td{padding:1px 0 1px 12px}.meta td:first-child{color:#55605b;padding-left:0}
.parties{display:flex;gap:24px;margin:12px 0}.parties>div{flex:1}.lbl{color:#55605b;font-size:.85em;text-transform:uppercase;letter-spacing:.04em}
table.items{width:100%;border-collapse:collapse;margin-top:6px}
table.items th{background:${accent};color:#fff;text-align:left;padding:5px 6px;font-weight:600;font-size:.9em}
table.items td{padding:5px 6px;border-bottom:1px solid #dfdbd2;vertical-align:top}
.n{text-align:right;white-space:nowrap} table.items th.n{text-align:right}
.bottom{display:flex;gap:24px;margin-top:12px;align-items:flex-start}.bottom>div{flex:1}
table.tot{width:100%;border-collapse:collapse}.tot td{padding:3px 0}.tot tr.g td{border-top:2px solid ${accent};font-weight:700;font-size:1.15em;padding-top:6px}
.note{margin-top:8px;color:#17201d}.words{margin-top:10px;font-style:italic}
.sign{margin-top:28px;text-align:right}.sign div{display:inline-block;border-top:1px solid #7a766c;padding-top:4px;min-width:180px;text-align:center}
.upi{display:flex;gap:10px;align-items:center;margin-top:10px}.upi img{width:96px;height:96px}
.rcm{margin-top:8px;font-weight:600}.irn{display:flex;justify-content:space-between;gap:12px;border:1px solid #dfdbd2;padding:8px;margin-top:10px;word-break:break-all}.irn img{width:96px;height:96px}
.foot{margin-top:16px;color:#55605b;text-align:center;font-size:.9em}
.mark{position:absolute;top:40%;left:15%;font-size:84px;font-weight:800;color:rgba(168,39,39,.12);transform:rotate(-20deg);pointer-events:none}
@media(max-width:640px){.top,.parties,.bottom{flex-direction:column}table.items{display:block;overflow-x:auto}}
</style></head><body><div class="page">${draftMark}
<div class="top"><div>${logo}<b style="font-size:1.25em">${esc(supplierName)}</b>${supplierName !== s.legal_name ? `<br>${esc(s.legal_name)}` : ''}<br>${addr(s.address)}${s.phone ? `<br>Ph: ${esc(s.phone)}` : ''}${s.email ? `<br>${esc(s.email)}` : ''}
${s.gstin ? `<br><b>GSTIN:</b> ${esc(s.gstin)}` : ''}</div>
<div style="text-align:right"><h1>${esc(title)}</h1><table class="meta" style="margin-left:auto"><tr><td>No.</td><td><b>${esc(d.number ?? 'Draft')}</b></td></tr>
<tr><td>Date</td><td>${esc(d.doc_date)}</td></tr>${d.due_date ? `<tr><td>Due</td><td>${esc(d.due_date)}</td></tr>` : ''}
${d.original_number ? `<tr><td>Against</td><td>${esc(d.original_number)}</td></tr>` : ''}</table></div></div>
<div class="parties"><div><div class="lbl">Bill to</div>${r ? `<b>${esc(r.name)}</b><br>${addr(r.billing_address)}${r.gstin ? `<br><b>GSTIN:</b> ${esc(r.gstin)}` : ''}${r.phone ? `<br>Ph: ${esc(r.phone)}` : ''}` : 'Walk-in customer'}</div>
<div><div class="lbl">Place of supply</div><b>${place}</b>${r?.shipping_address && Object.keys(r.shipping_address).length ? `<div class="lbl" style="margin-top:8px">Ship to</div>${addr(r.shipping_address)}` : ''}</div></div>
<table class="items"><thead><tr><th>#</th><th>Description</th><th>HSN/SAC</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Disc.</th><th class="n">Taxable</th>${taxHead}</tr></thead><tbody>${rows}</tbody></table>
<div class="bottom"><div>${t.showAmountInWords && !foreign ? `<div class="words">${esc(rupeesInWords(BigInt(d.grand_total_paise)))}</div>` : ''}
${rcm ? '<div class="rcm">Tax is payable on reverse charge.</div>' : ''}
${bankBlock}${upiBlock}${optional(t.showNotes, 'Notes', d.notes)}${optional(t.showTerms, 'Terms', d.terms)}</div>
<div><table class="tot">${totalRows}<tr class="g"><td>${rcm ? 'Amount due' : 'Total'}${foreign ? ` (${esc(d.currency)})` : ''}</td><td class="n">${money(d.grand_total_paise)}</td></tr>
${rcm && showTax ? `<tr><td colspan="2" style="color:#55605b;font-size:.9em">Tax shown above is payable by the recipient.</td></tr>` : ''}
${foreign ? `<tr><td colspan="2" style="color:#55605b;font-size:.9em">All amounts are in ${esc(d.currency)}. Exchange rate used: 1 ${esc(d.currency)} = Rs ${rateText}. This is not a tax invoice.</td></tr>` : ''}
${BigInt(d.tds_paise ?? 0) > 0n ? `<tr><td style="color:#55605b">Less: TDS to be deducted</td><td class="n" style="color:#55605b">${money(d.tds_paise)}</td></tr><tr><td style="color:#55605b">Net payable by customer</td><td class="n" style="color:#55605b">${money(BigInt(d.grand_total_paise) - BigInt(d.tds_paise))}</td></tr>` : ''}</table></div></div>
${irnBlock}${t.showSignature ? `<div class="sign"><div>Authorised signatory<br>${esc(supplierName)}</div></div>` : ''}
${t.footerText ? `<div class="foot">${esc(t.footerText)}</div>` : ''}
</div></body></html>`;
}
