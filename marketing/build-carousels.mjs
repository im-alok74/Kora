// Renders the Instagram/LinkedIn carousels (1080 x 1350) to marketing/out/<carousel>/NN.png.
//   node marketing/build-carousels.mjs            all carousels
//   node marketing/build-carousels.mjs ca-clients one carousel
// Copy is in marketing/carousels.mjs. Nothing here claims a feature the product lacks (see docs/marketing-plan.md section 1).
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../packages/pdf/node_modules/playwright/index.mjs';
import { CAROUSELS } from './carousels.mjs';

const here = dirname(fileURLToPath(import.meta.url)).replace(/^\/([A-Za-z]:)/, '$1');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

const mark = (doc, dot, lines) => `<svg viewBox="0 0 198 64" height="52"><path d="M14 6H35L49 20V35A18 18 0 0 0 31 53H14A7 7 0 0 1 7 46V13A7 7 0 0 1 14 6Z" fill="${doc}"/><path d="M35 6V15A5 5 0 0 0 40 20H49Z" fill="#71d9c4"/><path d="M17 27H36M17 35H29M17 43H24" fill="none" stroke="${lines}" stroke-width="3.5" stroke-linecap="round"/><circle cx="47" cy="51" r="10" fill="${dot}"/><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M78 13V49M97 26L79 38M84 35L99 49"/><circle cx="118" cy="37" r="12"/><path d="M141 49V26M141 36Q143 24 154 26"/><path d="M186 26V49M186 37A12 12 0 1 0 162 37A12 12 0 1 0 186 37"/></g></svg>`;

const CSS = `
*{box-sizing:border-box;margin:0}
body{width:1080px;height:1350px;font-family:'Segoe UI',Inter,system-ui,-apple-system,Roboto,'Noto Sans Devanagari',sans-serif;color:#16181b;position:relative;overflow:hidden}
.top{position:absolute;left:72px;right:72px;top:64px;display:flex;justify-content:space-between;align-items:center;font-size:26px;font-weight:600}
.page{opacity:.6}
.pad{position:absolute;left:72px;right:72px;top:190px;bottom:150px;display:flex;flex-direction:column;justify-content:center}
.foot{position:absolute;left:72px;right:72px;bottom:60px;font-size:26px;opacity:.65;display:flex;justify-content:space-between}
h1{font-size:96px;line-height:1.08;font-weight:800;letter-spacing:-.02em}
h2{font-size:68px;line-height:1.12;font-weight:800;letter-spacing:-.015em;margin-bottom:44px}
p{font-size:46px;line-height:1.38}
b{color:var(--hl)}
ul{list-style:none;padding:0;display:flex;flex-direction:column;gap:30px}
li{font-size:46px;line-height:1.34;padding-left:64px;position:relative}
li::before{content:'';position:absolute;left:0;top:12px;width:34px;height:34px;border-radius:50%;background:var(--hl)}
.chip{display:inline-block;align-self:flex-start;font-size:30px;font-weight:700;padding:10px 24px;border-radius:999px;background:var(--hl);color:#fff;margin-bottom:36px}
.hook{background:#1e1f21;color:#fff;--hl:#ffc247}
.body{background:#f5f7f8;--hl:#087f78}
.cta{background:#087f78;color:#fff;--hl:#ffe08a}
.cta .btn{align-self:flex-start;margin-top:56px;background:#fff;color:#087f78;font-size:44px;font-weight:800;padding:26px 48px;border-radius:20px}
.note{margin-top:44px;font-size:30px;opacity:.7}
.swipe{font-size:34px;margin-top:56px;opacity:.75}
`;

const slide = (c, s, i, n) => {
  const kind = s.kind ?? 'body';
  const hl = kind === 'body' ? '' : '';
  let inner = '';
  if (kind === 'hook') inner = `<h1>${rich(s.title)}</h1>${s.sub ? `<p style="margin-top:44px;opacity:.85">${rich(s.sub)}</p>` : ''}<div class="swipe">Swipe karein →</div>`;
  else if (kind === 'cta') inner = `<h2>${rich(s.title)}</h2><p>${rich(s.text)}</p><div class="btn">${esc(s.button)}</div>${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}`;
  else inner = `${s.chip ? `<div class="chip">${esc(s.chip)}</div>` : ''}<h2>${rich(s.title)}</h2>${s.text ? `<p>${rich(s.text)}</p>` : ''}${s.points ? `<ul>${s.points.map((p) => `<li>${rich(p)}</li>`).join('')}</ul>` : ''}`;
  return `<!doctype html><meta charset="utf-8"><style>${CSS}</style><body class="${kind}"${hl}>
  <div class="top"><span style="color:${kind === 'body' ? '#16181b' : '#fff'}">${kind === 'cta' ? mark('#ffffff', '#ffe08a', '#087f78') : mark('#087f78', '#24b79d', '#fff')}</span><span class="page">${i + 1} / ${n}</span></div>
  <div class="pad">${inner}</div>
  <div class="foot"><span>${esc(c.handle)}</span><span>${esc(s.foot ?? c.foot ?? '')}</span></div>`;
};

const only = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
for (const c of CAROUSELS.filter((x) => !only || x.id === only)) {
  const dir = join(here, 'out', c.id);
  mkdirSync(dir, { recursive: true });
  for (const [i, s] of c.slides.entries()) {
    await page.setContent(slide(c, s, i, c.slides.length));
    await page.screenshot({ path: join(dir, `${String(i + 1).padStart(2, '0')}.png`) });
  }
  console.log(`${c.id}: ${c.slides.length} slides -> ${dir}`);
}
await browser.close();
