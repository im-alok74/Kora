// Renders short captioned videos (1080x1920, 30 fps, silent) into marketing/videos.
//   node marketing/tools/videos.mjs            all videos
//   node marketing/tools/videos.mjs slabs      one of them
// Each scene is a page of HTML whose animations are stepped by hand, one frame at a time, then ffmpeg encodes the frames.
// Silent on purpose: most short video is watched muted, and no music is licensed here. Add a track in the app you post from.
// Every product claim is in marketing/CLAIMS.md. Figures shown on screen are labelled as examples.
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const { chromium } = createRequire(join(ROOT, 'e2e', 'package.json'))('playwright');
const QR = createRequire(join(ROOT, 'apps', 'web', 'package.json'))('qrcode');
const OUT = join(here, '..', 'videos');
const TMP = process.env.VIDEO_TMP ?? join(ROOT, 'marketing', '.frames');
const FPS = 30;

const INK = '#0f1b2d', BLUE = '#106cd9', SOFT = '#e8f1fc', TEAL = '#087f78', RED = '#c0392b', GREEN = '#117a4d';
const LOGO = (c) => `<svg viewBox="0 0 198 64" height="52" style="color:${c}"><path d="M14 6H35L49 20V35A18 18 0 0 0 31 53H14A7 7 0 0 1 7 46V13A7 7 0 0 1 14 6Z" fill="${TEAL}"/><path d="M35 6V15A5 5 0 0 0 40 20H49Z" fill="#71d9c4"/><path d="M17 27H36M17 35H29M17 43H24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round"/><circle cx="47" cy="51" r="10" fill="#24b79d"/><g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M78 13V49M97 26L79 38M84 35L99 49"/><circle cx="118" cy="37" r="12"/><path d="M141 49V26M141 36Q143 24 154 26"/><path d="M186 26V49M186 37A12 12 0 1 0 162 37A12 12 0 1 0 186 37"/></g></svg>`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const hl = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<span class="hl">$1</span>');

const CSS = `
*{box-sizing:border-box;margin:0}
body{width:1080px;height:1920px;overflow:hidden;font-family:Inter,'Noto Sans Devanagari',system-ui,sans-serif;color:${INK};-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
.sc{position:absolute;inset:0;padding:230px 90px 300px;display:flex;flex-direction:column;justify-content:center;background:#fff}
.sc.dark{background:${INK};color:#fff}.sc.blue{background:${BLUE};color:#fff}.sc.soft{background:${SOFT}}
.logo{position:absolute;left:90px;top:130px}
.bar{position:absolute;left:0;bottom:0;height:10px;background:${BLUE};width:calc(var(--p,0) * 100%)}.dark .bar,.blue .bar{background:#8fc3ff}
h1{font-size:112px;line-height:1.05;font-weight:800;letter-spacing:-.025em}
h2{font-size:84px;line-height:1.08;font-weight:800;letter-spacing:-.02em;margin-bottom:30px}
p{font-size:52px;line-height:1.36;font-weight:500;margin-top:26px}
.hl{color:${BLUE}}.dark .hl{color:#8fc3ff}.blue .hl{color:#fff;text-decoration:underline;text-decoration-thickness:9px;text-underline-offset:12px;text-decoration-color:#8fc3ff}
.chips{display:flex;flex-wrap:wrap;gap:24px;margin:26px 0}.chip{font-size:84px;font-weight:800;padding:22px 46px;border-radius:30px;background:${SOFT};color:${BLUE}}
.chip.no{background:#fde8e5;color:${RED};text-decoration:line-through}
.box{margin-top:36px;padding:38px 44px;border-radius:30px;background:${SOFT};font-size:46px;line-height:1.38;font-weight:600}.dark .box{background:rgba(255,255,255,.1)}
.card{margin-top:30px;border-radius:30px;background:#fff;color:${INK};padding:44px 48px;box-shadow:0 18px 50px rgba(15,27,45,.18);font-size:42px}.soft .card,.blue .card,.dark .card{box-shadow:0 18px 50px rgba(0,0,0,.25)}
.row{display:flex;justify-content:space-between;padding:14px 0}.hd{font-weight:800;border-bottom:3px solid ${INK};padding-bottom:18px;font-size:34px;letter-spacing:.04em}
.tot{border-top:3px solid ${INK};margin-top:12px;padding-top:20px;font-weight:800;font-size:54px}.mut{color:#4a5565}
.pill{display:inline-block;padding:10px 26px;border-radius:30px;font-size:38px;font-weight:700}.pill.r{background:#fde8e5;color:${RED}}.pill.g{background:#e1f5ec;color:${GREEN}}
.sel{border:3px solid ${BLUE};border-radius:22px;overflow:hidden;font-size:46px;font-weight:600;background:#fff;color:${INK}}.sel div{padding:22px 30px;border-bottom:2px solid #e4e8ee}.sel div:last-child{border-bottom:0}.sel .off{color:#838891}
.qr{width:330px;height:330px;margin:18px auto 0;display:block}
.fine{font-size:34px;opacity:.75;margin-top:30px;line-height:1.4}
.btn{display:inline-block;margin-top:46px;padding:34px 60px;border-radius:26px;background:#fff;color:${BLUE};font-size:56px;font-weight:800}
.in{opacity:0;transform:translateY(46px);animation:in .55s cubic-bezier(.2,.8,.2,1) forwards;animation-delay:var(--d,0s)}
.pop{opacity:0;transform:scale(.86);animation:pop .5s cubic-bezier(.2,1.3,.3,1) forwards;animation-delay:var(--d,0s)}
@keyframes in{to{opacity:1;transform:none}}@keyframes pop{to{opacity:1;transform:none}}
`;

// d(i): a staggered delay. el() wraps content so it animates in at that moment.
const el = (delay, html, kind = 'in') => `<div class="${kind}" style="--d:${delay}s">${html}</div>`;

async function scene(spec, ctx) {
  const tone = spec.tone ?? '';
  const light = tone === 'dark' || tone === 'blue';
  const inner = await spec.html(ctx);   // a scene may be async (the QR code is made first)
  return `<div class="sc ${tone}"><div class="logo">${LOGO(light ? '#fff' : INK)}</div>${inner}<div class="bar"></div></div>`;
}

const qrSvg = async (text) => QR.toString(text, { type: 'svg', margin: 1, color: { dark: INK, light: '#ffffff' } });

const VIDEOS = {
  slabs: {
    caption: '12% and 28% GST are gone for supplies on or after 22 September 2025. Check your saved items and repeating invoices. General information, not tax advice.',
    scenes: [
      { dur: 3.2, tone: 'dark', html: () => el(0, '<h1>12% and 28% GST are <span class="hl">gone.</span></h1>') + el(.8, '<p>For supplies on or after 22 September 2025.</p>') },
      { dur: 4.2, html: () => el(0, '<h2>The slabs now</h2>') + `<div class="chips">${['0%', '0.25%', '3%', '5%', '18%', '40%'].map((c, i) => el(.25 + i * .22, `<div class="chip">${c}</div>`, 'pop')).join('')}</div>` + el(1.9, '<p>Dated on or after <span class="hl">22 Sep 2025</span>.</p>') },
      { dur: 3.6, html: () => el(0, '<h2>Retired for new supplies</h2>') + `<div class="chips">${el(.3, '<div class="chip no">12%</div>', 'pop')}${el(.55, '<div class="chip no">28%</div>', 'pop')}</div>` + el(1.2, '<p>Earlier supplies can still carry them. Check the <span class="hl">date</span>.</p>') },
      { dur: 4.2, html: () => el(0, '<h2>Check your saved items</h2>') + el(.5, '<p>An item saved at 12% or 28% keeps that rate until you change it.</p>') + el(1.4, '<div class="box">Open each one. Pick the new rate.</div>') },
      { dur: 4.4, html: () => el(0, '<h2>And repeating invoices</h2>') + el(.5, '<p>A monthly invoice copies the rate you saved when you set it up.</p>') + el(1.4, '<div class="box">Review every schedule made before the change.</div>') },
      { dur: 5.0, tone: 'soft', html: () => el(0, '<h2>What Kora does</h2>') + el(.5, `<div class="sel"><div>0%</div><div>5%</div><div class="off">12% <span class="pill r">not valid on this date</span></div><div>18%</div></div>`, 'in') + el(1.5, '<p>New invoices refuse retired rates. Old items are marked.</p>') },
      { dur: 4.4, tone: 'blue', html: () => el(0, '<h2>Try the free <span class="hl">GST Calculator</span></h2>') + el(.6, '<p>No sign-up. Runs in your browser.</p>') + el(1.2, '<div class="btn">Link in bio</div>') + el(1.6, '<div class="fine">General information, not tax advice. Confirm edge cases with your CA.</div>') },
    ],
  },
  invoice30: {
    caption: 'A GST invoice with the tax worked out and a UPI QR on it. Example figures. Kora is in early access.',
    scenes: [
      { dur: 3.0, tone: 'dark', html: () => el(0, '<h1>A GST invoice with a <span class="hl">UPI QR.</span></h1>') + el(.8, '<p>Tax worked out for you.</p>') },
      { dur: 4.4, html: () => el(0, '<h2>1. Add your lines</h2>') + el(.4, `<div class="card"><div class="row hd"><span>TAX INVOICE</span><span>AMOUNT</span></div>${el(.9, '<div class="row"><span>Design work</span><span>10,000.00</span></div>')}${el(1.7, '<div class="row"><span>Hosting</span><span>2,000.00</span></div>')}</div>`) + el(2.4, '<div class="fine">Example figures.</div>') },
      { dur: 4.6, html: () => el(0, '<h2>2. Tax works itself out</h2>') + `<div class="card"><div class="row hd"><span>TAX INVOICE</span><span>AMOUNT</span></div><div class="row"><span>Design work</span><span>10,000.00</span></div><div class="row"><span>Hosting</span><span>2,000.00</span></div>${el(.5, '<div class="row mut"><span>CGST 9%</span><span>1,080.00</span></div>')}${el(1.1, '<div class="row mut"><span>SGST 9%</span><span>1,080.00</span></div>')}${el(1.8, '<div class="row tot"><span>Total</span><span>₹14,160.00</span></div>')}</div>` + el(2.6, '<p>Same state: CGST and SGST. Another state: IGST.</p>') },
      { dur: 4.6, html: async () => el(0, '<h2>3. Pay with one scan</h2>') + el(.4, `<div class="card"><div class="row"><span><b>Amount due</b></span><span><b>₹14,160.00</b></span></div><div class="qr">${await qrSvg('upi://pay?pa=example@upi&pn=Example&am=14160.00&cu=INR')}</div><div class="fine" style="text-align:center;color:#4a5565">Example QR. Your invoice carries your UPI ID.</div></div>`, 'pop') },
      { dur: 4.2, tone: 'blue', html: () => el(0, '<h2>Your first invoice is <span class="hl">free.</span></h2>') + el(.6, '<p>10 invoices and quotes a month, no card.</p>') + el(1.2, '<div class="btn">Start free</div>') + el(1.6, '<div class="fine">Kora is in early access.</div>') },
    ],
  },
  sealed: {
    caption: 'Why a sent invoice should not be editable, and what to do instead: a credit note, a debit note or a new invoice.',
    scenes: [
      { dur: 3.2, tone: 'dark', html: () => el(0, '<h1>Why you can’t edit a <span class="hl">sent invoice.</span></h1>') + el(.8, '<p>And what to do instead.</p>') },
      { dur: 4.4, html: () => el(0, '<h2>The problem</h2>') + el(.5, '<p>You send it. Then you change it.</p>') + el(1.3, '<p>Now you, your customer and your CA hold <span class="hl">three versions.</span></p>') },
      { dur: 5.0, html: () => el(0, '<h2>The fix</h2>') + el(.5, '<div class="box"><b>Charged too much?</b><br>Issue a <span class="hl">credit note</span>.</div>') + el(1.4, '<div class="box"><b>Charged too little?</b><br>Issue a <span class="hl">debit note</span>.</div>') + el(2.3, '<div class="box"><b>Wrong customer?</b><br>Credit note, then a <span class="hl">new invoice</span>.</div>') },
      { dur: 4.6, tone: 'soft', html: () => el(0, '<h2>The record stays honest</h2>') + el(.5, '<p>The note points at the invoice. Anyone can see what happened and when.</p>') + el(1.5, `<div class="card"><div class="row" style="white-space:nowrap"><span>Invoice 001</span><span class="pill g">issued</span></div><div class="row" style="white-space:nowrap"><span>Credit note for 001</span><span class="pill r">\u2212 500.00</span></div></div>`) + el(2.2, '<div class="fine">Example.</div>') },
      { dur: 4.4, tone: 'blue', html: () => el(0, '<h2>Invoices your CA can <span class="hl">trust.</span></h2>') + el(.6, '<p>Issued invoices and the activity log cannot be edited or deleted.</p>') + el(1.4, '<div class="btn">Start free</div>') + el(1.8, '<div class="fine">Kora is in early access.</div>') },
    ],
  },
};

const only = process.argv[2];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });

for (const [id, v] of Object.entries(VIDEOS)) {
  if (only && !id.startsWith(only)) continue;
  rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
  const total = v.scenes.reduce((n, s) => n + s.dur, 0);
  let frame = 0, elapsed = 0;
  for (const spec of v.scenes) {
    const html = await scene(spec, {});
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>${CSS}</style>${html}`);
    const n = Math.round(spec.dur * FPS);
    for (let i = 0; i < n; i++) {
      const t = i / FPS;
      await page.evaluate(([t, p]) => { document.body.style.setProperty('--p', p); document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t * 1000; }); }, [t, (elapsed + t) / total]);
      await page.screenshot({ path: join(TMP, `f${String(frame++).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
    }
    elapsed += spec.dur;
  }
  const file = join(OUT, `${id}.mp4`);
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(TMP, 'f%05d.jpg'), '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '96k', file], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg failed');
  writeFileSync(join(OUT, `${id}.txt`), v.caption + '\n');
  console.log(id, `${total.toFixed(1)}s`, file);
}
rmSync(TMP, { recursive: true, force: true });
await browser.close();
