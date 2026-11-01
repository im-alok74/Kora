// Renders the carousels in marketing/carousels as 1080x1350 PNG slides (4:5, the LinkedIn and Instagram feed size).
//   node marketing/tools/carousels.mjs            all carousels
//   node marketing/tools/carousels.mjs gst-slabs   one of them
// Copy lives in this file so it can be reviewed and edited as text. Every product claim is something the repository shows; the
// source of each is in marketing/CLAIMS.md. No statistics, no customer names, no testimonials.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright is a dependency of the e2e workspace, so it is loaded from there.
const { chromium } = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'e2e', 'package.json'))('playwright');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'carousels');
const CTA_LINE = 'Link in bio';   // replace with the real address or handle once the accounts exist

const INK = '#0f1b2d', BLUE = '#106cd9', SOFT = '#e8f1fc', TEAL = '#087f78', MUTED = '#4a5565', RED = '#c0392b', GREEN = '#117a4d';

const LOGO = (color) => `<svg viewBox="0 0 198 64" height="46" style="color:${color}"><path d="M14 6H35L49 20V35A18 18 0 0 0 31 53H14A7 7 0 0 1 7 46V13A7 7 0 0 1 14 6Z" fill="${TEAL}"/><path d="M35 6V15A5 5 0 0 0 40 20H49Z" fill="#71d9c4"/><path d="M17 27H36M17 35H29M17 43H24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round"/><circle cx="47" cy="51" r="10" fill="#24b79d"/><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M78 13V49M97 26L79 38M84 35L99 49"/><circle cx="118" cy="37" r="12"/><path d="M141 49V26M141 36Q143 24 154 26"/><path d="M186 26V49M186 37A12 12 0 1 0 162 37A12 12 0 1 0 186 37"/></g></svg>`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const hl = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, `<span class="hl">$1</span>`);

const CSS = `
*{box-sizing:border-box;margin:0}
body{width:1080px;height:1350px;font-family:Inter,'Noto Sans Devanagari',system-ui,sans-serif;color:${INK};-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
.s{width:1080px;height:1350px;padding:84px 88px;display:flex;flex-direction:column;position:relative;background:#fff}
.s.dark{background:${INK};color:#fff}.s.blue{background:${BLUE};color:#fff}.s.soft{background:${SOFT}}
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:56px}
.count{font-size:28px;font-weight:600;opacity:.6}
.main{flex:1;display:flex;flex-direction:column;justify-content:flex-start;padding-top:70px}
.s.dark .main,.s.blue .main{justify-content:center;padding-top:0}
h1{font-size:104px;line-height:1.04;font-weight:800;letter-spacing:-.025em}
h2{font-size:76px;line-height:1.08;font-weight:800;letter-spacing:-.02em;margin-bottom:34px}
p{font-size:42px;line-height:1.38;font-weight:500}
.sub{font-size:46px;line-height:1.35;margin-top:38px;opacity:.88}
.hl{color:${BLUE}}.dark .hl,.blue .hl{color:#8fc3ff}.blue .hl{color:#fff;text-decoration:underline;text-decoration-thickness:8px;text-underline-offset:10px;text-decoration-color:#8fc3ff}
.num{width:112px;height:112px;border-radius:56px;background:${BLUE};color:#fff;font-size:60px;font-weight:800;display:flex;align-items:center;justify-content:center;margin-bottom:36px}
.foot{display:flex;justify-content:space-between;align-items:center;margin-top:44px;font-size:28px;font-weight:600;opacity:.7}
.chips{display:flex;flex-wrap:wrap;gap:22px;margin:30px 0}
.chip{font-size:68px;font-weight:800;padding:20px 40px;border-radius:26px;background:${SOFT};color:${BLUE}}
.chip.no{background:#fde8e5;color:${RED};text-decoration:line-through}
.box{margin-top:40px;padding:36px 42px;border-radius:28px;background:${SOFT};font-size:38px;line-height:1.4;font-weight:600}
.dark .box{background:rgba(255,255,255,.1)}
.cols{display:flex;gap:28px;margin-top:34px}
.col{flex:1;border-radius:28px;padding:34px;font-size:36px;line-height:1.35;font-weight:600}
.col b{display:block;font-size:30px;letter-spacing:.06em;margin-bottom:14px}
.bad{background:#fde8e5}.bad b{color:${RED}}.good{background:#e1f5ec}.good b{color:${GREEN}}
.list{margin-top:20px}.list div{display:flex;gap:28px;align-items:flex-start;font-size:42px;line-height:1.3;font-weight:600;padding:22px 0;border-top:2px solid rgba(15,27,45,.12)}
.list i{font-style:normal;flex:none;width:64px;height:64px;border-radius:32px;background:${BLUE};color:#fff;font-size:34px;font-weight:800;display:flex;align-items:center;justify-content:center}
.btn{display:inline-block;margin-top:44px;padding:30px 54px;border-radius:24px;background:#fff;color:${BLUE};font-size:46px;font-weight:800}
.dark .btn{background:${BLUE};color:#fff}
.inv{margin-top:32px;border-radius:28px;background:#fff;color:${INK};padding:40px 44px;box-shadow:0 14px 40px rgba(15,27,45,.16);font-size:34px}
.inv .r{display:flex;justify-content:space-between;padding:12px 0}.inv .h{font-weight:800;border-bottom:3px solid ${INK};padding-bottom:16px;font-size:30px;letter-spacing:.04em}
.inv .t{border-top:3px solid ${INK};margin-top:10px;padding-top:18px;font-weight:800;font-size:42px}.inv .m{color:${MUTED}}
.tool{display:flex;gap:30px;align-items:center;padding:26px 0;border-top:2px solid rgba(15,27,45,.12)}
.tool u{text-decoration:none;flex:none;width:72px;height:72px;border-radius:20px;background:${BLUE};color:#fff;font-size:34px;font-weight:800;display:flex;align-items:center;justify-content:center}
.tool b{display:block;font-size:44px;font-weight:800}.tool span{font-size:32px;color:${MUTED};font-weight:500}
.fine{font-size:28px;opacity:.7;margin-top:30px;line-height:1.4;font-weight:500}
`;

function slide(i, n, s) {
  const tone = s.tone ?? (s.t === 'hook' ? 'dark' : s.t === 'cta' ? 'blue' : '');
  const light = tone === 'dark' || tone === 'blue';
  let body = '';
  switch (s.t) {
    case 'hook': body = `<h1>${hl(s.title)}</h1><p class="sub">${hl(s.sub ?? '')}</p>`; break;
    case 'point': body = `${s.n ? `<div class="num">${s.n}</div>` : ''}<h2>${hl(s.title)}</h2><p>${hl(s.body ?? '')}</p>${s.box ? `<div class="box">${hl(s.box)}</div>` : ''}`; break;
    case 'chips': body = `<h2>${hl(s.title)}</h2><div class="chips">${s.chips.map((c) => `<div class="chip${c.no ? ' no' : ''}">${esc(c.l)}</div>`).join('')}</div><p>${hl(s.body ?? '')}</p>`; break;
    case 'compare': body = `<h2>${hl(s.title)}</h2><div class="cols"><div class="col bad"><b>${esc(s.badLabel ?? 'NOT THIS')}</b>${hl(s.bad)}</div><div class="col good"><b>${esc(s.goodLabel ?? 'THIS')}</b>${hl(s.good)}</div></div>${s.box ? `<div class="box">${hl(s.box)}</div>` : ''}`; break;
    case 'list': body = `<h2>${hl(s.title)}</h2><div class="list">${s.items.map((x, k) => `<div><i>${k + 1}</i><span>${hl(x)}</span></div>`).join('')}</div>`; break;
    case 'invoice': body = `<h2>${hl(s.title)}</h2><p>${hl(s.body ?? '')}</p><div class="inv"><div class="r h"><span>${esc(s.head)}</span><span>AMOUNT</span></div>${s.rows.map(([a, b, m]) => `<div class="r${m ? ' m' : ''}"><span>${esc(a)}</span><span>${esc(b)}</span></div>`).join('')}<div class="r t"><span>Total</span><span>${esc(s.total)}</span></div></div>${s.fine ? `<div class="fine">${esc(s.fine)}</div>` : ''}`; break;
    case 'tools': body = `<h2>${hl(s.title)}</h2>${s.tools.map(([k, t, d]) => `<div class="tool"><u>${esc(k)}</u><div><b>${esc(t)}</b><span>${esc(d)}</span></div></div>`).join('')}`; break;
    case 'cta': body = `<h2>${hl(s.title)}</h2><p>${hl(s.body ?? '')}</p><div><span class="btn">${esc(s.button)}</span></div>${s.fine ? `<div class="fine">${esc(s.fine)}</div>` : ''}`; break;
  }
  return `<section class="s ${tone}"><div class="top">${LOGO(light ? '#fff' : INK)}<div class="count">${i + 1} / ${n}</div></div><div class="main">${body}</div><div class="foot"><span>${i === n - 1 ? esc(CTA_LINE) : 'Swipe'}</span><span>${i === n - 1 ? '' : '→'}</span></div></section>`;
}

const SET = {
  'gst-slabs': {
    caption: 'GST slabs changed on 22 September 2025: 12% and 28% are gone for supplies on or after that date. What to check on your invoices, items and repeating invoices.',
    slides: [
      { t: 'hook', title: '12% and 28% GST are **gone.**', sub: 'For supplies on or after 22 September 2025. Check your invoices.' },
      { t: 'chips', title: 'The slabs now', chips: [{ l: '0%' }, { l: '0.25%' }, { l: '3%' }, { l: '5%' }, { l: '18%' }, { l: '40%' }], body: 'These are the rates for supplies dated on or after **22 Sep 2025**.' },
      { t: 'chips', title: 'Retired for new supplies', chips: [{ l: '12%', no: 1 }, { l: '28%', no: 1 }], body: 'A supply made **before** that date can still carry them. One made on or after it cannot.' },
      { t: 'point', n: 1, title: 'Check your saved items', body: 'An item saved at 12% or 28% keeps that rate until you change it.', box: 'Open each one. Pick the new rate for new invoices.' },
      { t: 'point', n: 2, title: 'Check repeating invoices', body: 'A monthly invoice copies the rate you saved when you set it up.', box: 'Review every schedule that was created before the change.' },
      { t: 'point', n: 3, title: 'Old invoices, new credit note', body: 'A credit note for an invoice issued before the change may need to carry the old rate.', box: 'Not sure? Ask your CA before you issue it.' },
      { t: 'point', title: 'What Kora does', body: 'It refuses retired rates on new invoices, marks old items as **not valid on this date**, and lets a credit note for an old invoice carry the old rate.' },
      { t: 'cta', title: 'Try the free **GST Calculator**', body: 'Add or remove GST and see the CGST, SGST and IGST split. No sign-up.', button: 'Free, in your browser', fine: 'General information, not tax advice. Confirm edge cases with your CA.' },
    ],
  },
  'invoice-mistakes': {
    caption: 'Five invoice mistakes a CA finds again and again, and how to avoid each one.',
    slides: [
      { t: 'hook', title: '5 invoice mistakes your **CA will find.**', sub: 'Fix them before the month-end scramble.' },
      { t: 'compare', title: '1. The wrong tax split', bad: 'CGST and SGST on a sale to another state.', good: 'IGST when the place of supply is in another state.', box: 'It follows the **place of supply**, not just where you are.' },
      { t: 'point', n: 2, title: 'Gaps and repeats in numbers', body: 'Invoice numbers run in order through the financial year, are never reused, and stay within 16 characters.', box: 'A deleted draft that took a number leaves a hole.' },
      { t: 'point', n: 3, title: 'Editing after you send it', body: 'Your copy and your customer’s copy now disagree.', box: 'Fix it with a **credit note** (less) or a **debit note** (more), not an edit.' },
      { t: 'point', n: 4, title: 'Totals that drift', body: 'Round the tax on each line, add the lines. Do not work back from a rounded total.', box: 'Money in whole paise adds up every time.' },
      { t: 'point', n: 5, title: 'Missing HSN or SAC', body: 'Whether you must show it, and how many digits, depends on your turnover.', box: 'Ask your CA which applies to you.' },
      { t: 'point', title: 'Kora covers the first four by default', body: 'Tax from the place of supply. Numbers in sequence. Issued invoices sealed. Paise-exact totals. And it checks the HSN rule for your turnover band.' },
      { t: 'cta', title: 'Make your next invoice **right the first time.**', body: 'Start free: 10 invoices and quotes a month.', button: 'Start free', fine: 'Kora is in early access. General information, not tax advice.' },
    ],
  },
  'first-payment': {
    caption: 'From first login to first payment in three steps: add your business, create an invoice, send it and collect with a UPI QR.',
    slides: [
      { t: 'hook', title: 'From first login to **first payment.**', sub: 'Three steps. Here is the whole thing.' },
      { t: 'point', n: 1, title: 'Add your business', body: 'Your GSTIN, your address, and the state you supply from.', box: 'It takes about a minute. Not registered for GST? Say so and carry on.' },
      { t: 'point', n: 2, title: 'Create an invoice', body: 'Pick a customer, add your lines, and watch the tax work itself out.', box: 'Save a draft, or issue it when it is right.' },
      { t: 'invoice', title: 'The tax does itself', head: 'TAX INVOICE', rows: [['Design work', '10,000.00'], ['CGST 9%', '900.00', 1], ['SGST 9%', '900.00', 1]], total: '₹11,800.00', body: 'Same state: CGST and SGST. Another state: IGST.', fine: 'Example figures.' },
      { t: 'point', n: 3, title: 'Send it and collect', body: 'Every invoice carries a **UPI QR** for the amount still due, and a link you can share.', box: 'Part payments are handled. Payments match themselves to invoices.' },
      { t: 'point', title: 'And your CA?', body: 'GSTR-1 data and a GST summary that match your sales register to the paisa.', box: 'Kora prepares the data. You and your CA file.' },
      { t: 'cta', title: 'Your first invoice is **free.**', body: 'Start free: 10 invoices and quotes a month, no card.', button: 'Start free', fine: 'Kora is in early access.' },
    ],
  },
  'free-tools': {
    caption: 'Five free tools for small businesses: GST calculator, invoice generator, GSTIN validator, amount in words, UPI QR code. No sign-up and nothing is uploaded.',
    slides: [
      { t: 'hook', title: '5 free tools for **every small business.**', sub: 'No sign-up. Nothing leaves your browser.' },
      { t: 'tools', title: 'Bookmark these', tools: [['1', 'GST Calculator', 'Add or remove GST. CGST, SGST, IGST split.'], ['2', 'Invoice Generator', 'A GST tax invoice as a PDF.'], ['3', 'GSTIN Validator', 'Check a GSTIN. Paste a list.'], ['4', 'Amount in Words', 'English and Hindi, with lakh and crore.'], ['5', 'UPI QR Code', 'A QR for your UPI ID or a payment link.']] },
      { t: 'point', title: 'Why we made them free', body: 'They run in your browser. What you type is not uploaded.', box: 'Use them as long as you like. Come to Kora if you want invoices saved, numbered and tracked.' },
      { t: 'cta', title: 'Try them now', body: 'Search for **Kora free tools**, or follow the link.', button: 'Free. No sign-up.', fine: 'GSTIN checks read the number’s format and check digit; they do not confirm registration with the GST portal.' },
    ],
  },
  'sealed-invoice': {
    caption: 'Why an issued invoice should not be editable, and what to do when it has a mistake: credit note, debit note, new invoice.',
    slides: [
      { t: 'hook', title: 'Why you can’t edit a **sent invoice.**', sub: 'And what to do when it has a mistake.' },
      { t: 'point', title: 'The problem', body: 'You send an invoice. Then you change it. Now you, your customer and your CA hold three different versions.', box: 'That is where disputes and notices start.' },
      { t: 'compare', title: 'The fix', badLabel: 'EDIT IT', bad: 'Quietly change the amount. Nobody can tell what was sent.', goodLabel: 'CORRECT IT', good: 'Issue a **credit note** or **debit note** that points at the invoice.', box: 'The record shows what happened and when.' },
      { t: 'list', title: 'What to do', items: ['Charged too much? Issue a **credit note**.', 'Charged too little? Issue a **debit note**.', 'Wrong customer? Credit note, then a **new invoice**.'] },
      { t: 'point', title: 'How Kora does it', body: 'An issued invoice and the activity log cannot be edited or deleted. Mistakes are fixed with credit and debit notes.', box: 'It is strict on purpose. Your CA sees the version you sent.' },
      { t: 'cta', title: 'Invoices your CA can **trust.**', body: 'Start free: 10 invoices and quotes a month.', button: 'Start free', fine: 'Kora is in early access.' },
    ],
  },
  'for-cas': {
    caption: 'For CAs: see every client on one screen, collect documents through an inbox, match purchases to GSTR-2B. What the Firm view in Kora does.',
    slides: [
      { t: 'hook', title: 'Stop chasing clients for **invoices.**', sub: 'For CAs and small CA firms.' },
      { t: 'point', n: 1, title: 'Every client on one screen', body: 'See what is overdue and what is due for each client, then jump into any one in a click.' },
      { t: 'point', n: 2, title: 'Documents come to you', body: 'Clients send bills and invoices to an inbox. You review and file them in place.' },
      { t: 'point', n: 3, title: 'Purchases against GSTR-2B', body: 'Match what clients bought to what the portal shows, and keep input credit clean.' },
      { t: 'point', n: 4, title: 'Books that tie out', body: 'GSTR-1 data and the GST summary add up to the sales register to the paisa.', box: 'Kora prepares the data. You still file.' },
      { t: 'point', title: 'Clean invoices from the start', body: 'Tax from the place of supply. Numbers in order. Issued invoices sealed. Fewer corrections for you.' },
      { t: 'cta', title: 'Try the **Firm view** with a few clients.', body: 'Talk to us and we will set you up.', button: 'Talk to us', fine: 'Kora is in early access. The Firm plan price is not final.' },
    ],
  },
};

const only = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
for (const [id, c] of Object.entries(SET)) {
  if (only && !id.startsWith(only)) continue;
  const dir = join(OUT, id);
  mkdirSync(dir, { recursive: true });
  const n = c.slides.length;
  for (let i = 0; i < n; i++) {
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${CSS}</style>${slide(i, n, c.slides[i])}`);
    await page.screenshot({ path: join(dir, `${String(i + 1).padStart(2, '0')}.png`), clip: { x: 0, y: 0, width: 1080, height: 1350 } });
  }
  writeFileSync(join(dir, 'caption.txt'), c.caption + '\n');
  console.log(id, n, 'slides');
}
await browser.close();
