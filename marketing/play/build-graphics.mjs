// Google Play graphics from real screenshots of the app (marketing/video/public/shots, made by marketing/capture-screens.mjs):
// a 1024 x 500 feature graphic and five 1080 x 1920 phone screenshots. Output: marketing/play/out/.
//   node marketing/play/build-graphics.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../packages/pdf/node_modules/playwright/index.mjs';

const here = dirname(fileURLToPath(import.meta.url)).replace(/^\/([A-Za-z]:)/, '$1');
const shots = join(here, '..', 'video', 'public', 'shots');
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const img = (name) => `data:image/png;base64,${readFileSync(join(shots, `${name}.png`)).toString('base64')}`;
const icon = `data:image/png;base64,${readFileSync(join(here, '..', '..', 'apps', 'web', 'public', 'icons', 'icon-512.png')).toString('base64')}`;

const FONT = "'Segoe UI',Inter,system-ui,sans-serif";
const SCREENS = [
  { file: 'editor-items', bg: '#087f78', title: 'Make a GST invoice in seconds', sub: 'Customer, item, rate. Done.' },
  { file: 'editor-summary', bg: '#106cd9', title: 'GST done for you', sub: 'CGST, SGST or IGST, added correctly.' },
  { file: 'issued', bg: '#1e1f21', title: 'Numbered and ready to share', sub: 'Every invoice gets the next number, with no gaps.' },
  { file: 'sent', bg: '#087f78', title: 'Send it on WhatsApp', sub: 'See when it was sent, opened and paid.' },
  { file: 'customer-invoice', bg: '#106cd9', title: 'Customers pay with a UPI QR', sub: 'The QR is on every invoice.' },
];

const phone = (src, h) => `<div style="width:${h * 0.49}px;height:${h}px;border-radius:${h * 0.07}px;background:#111;padding:${h * 0.012}px;box-shadow:0 30px 70px rgba(0,0,0,.4)"><div style="width:100%;height:100%;border-radius:${h * 0.058}px;overflow:hidden;background:#fff"><img src="${src}" style="width:100%;display:block"></div></div>`;

const screenshot = (s) => `<!doctype html><meta charset="utf-8"><body style="margin:0;width:1080px;height:1920px;background:${s.bg};font-family:${FONT};color:#fff;overflow:hidden;position:relative">
<div style="padding:90px 80px 0"><div style="font-size:84px;font-weight:900;line-height:1.05;letter-spacing:-.02em">${s.title}</div><div style="font-size:42px;opacity:.88;margin-top:22px">${s.sub}</div></div>
<div style="position:absolute;left:0;right:0;top:430px;display:flex;justify-content:center">${phone(img(s.file), 1700)}</div>`;

const feature = `<!doctype html><meta charset="utf-8"><body style="margin:0;width:1024px;height:500px;background:linear-gradient(120deg,#087f78,#106cd9);font-family:${FONT};color:#fff;overflow:hidden;position:relative">
<div style="position:absolute;left:56px;top:92px;width:560px"><div style="width:92px;height:92px;border-radius:22px;background:#fff;display:flex;align-items:center;justify-content:center"><img src="${icon}" style="width:70px;height:70px"></div><div style="font-size:60px;font-weight:900;line-height:1.05;margin-top:18px;letter-spacing:-.02em">GST invoicing for your business</div><div style="font-size:26px;opacity:.9;margin-top:14px">Invoice. WhatsApp. UPI. Your CA stays in the loop.</div></div>
<div style="position:absolute;right:70px;top:46px">${phone(img('issued'), 560)}</div>`;

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
for (const [i, s] of SCREENS.entries()) {
  await p.setContent(screenshot(s));
  await p.screenshot({ path: join(out, `phone-${i + 1}.png`) });
}
await p.setViewportSize({ width: 1024, height: 500 });
await p.setContent(feature);
await p.screenshot({ path: join(out, 'feature-graphic.png') });
await b.close();
console.log('written to', out);
