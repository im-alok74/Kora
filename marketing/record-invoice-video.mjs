// Records a 9:16 screen video of the real app: invoice -> GST -> WhatsApp, with Hinglish captions burned into the page.
// Needs a local copy running with DEMO_FIXED_OTP=123456 and KORA_ALLOW_MOCKS=1 (never a live site). Output: marketing/out/video-invoice/*.webm
//   BASE=http://localhost:3400 node marketing/record-invoice-video.mjs
import { mkdirSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../packages/pdf/node_modules/playwright/index.mjs';

const BASE = process.env.BASE ?? 'http://localhost:3400';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error('Only a local copy may be recorded.');
const here = dirname(fileURLToPath(import.meta.url)).replace(/^\/([A-Za-z]:)/, '$1');
const out = join(here, 'out', 'video-invoice');
mkdirSync(out, { recursive: true });

const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const r = (s, k) => Array.from({ length: k }, () => s[Math.floor(Math.random() * s.length)]).join('');
function gstin(state = '27') {
  const base = `${state}${r(letters, 5)}${r('0123456789', 4)}${r(letters, 1)}1Z`;
  let t = 0;
  for (let i = 0; i < 14; i++) { const v = chars.indexOf(base[i]) * (i % 2 === 0 ? 1 : 2); t += Math.floor(v / 36) + (v % 36); }
  return base + chars[(36 - (t % 36)) % 36];
}

const VIEW = { width: 430, height: 764 };
const browser = await chromium.launch();

// 1. Sign in and make the business off camera.
const setup = await browser.newContext({ viewport: VIEW });
const sp = await setup.newPage();
const phone = `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`;
await sp.goto(`${BASE}/login`);
await sp.getByRole('button', { name: 'Use an emailed or texted code' }).click();
await sp.getByLabel('Mobile number or email').fill(phone);
await sp.getByRole('button', { name: 'Send code' }).click();
await sp.getByLabel(/Six-digit code/).fill('123456');
await sp.locator('form').getByRole('button', { name: 'Sign in' }).click();
await sp.getByLabel('Legal name of the business').fill('Sharma Traders');
await sp.getByLabel('GSTIN').fill(gstin());
await sp.getByRole('button', { name: 'Create business' }).click();
await sp.waitForURL(/\/app/);
const state = await setup.storageState();
await setup.close();

// 2. The take.
// Playwright's own recorder wrote nothing on this machine, so the frames are taken from the browser's screencast and encoded below.
const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, storageState: state });
const page = await ctx.newPage();
await page.addInitScript(() => { const st = document.createElement('style'); st.textContent = 'nextjs-portal{display:none!important}'; document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st)); });
const frames = [];
let startAt = null;   // the take begins at the first caption, not at the loading splash
const cdp = await ctx.newCDPSession(page);
let paused = false, skew = 0, pausedAt = 0, lastDropped = null;
const pause = () => { paused = true; pausedAt = Date.now(); };
// The screencast sends a frame only when the screen changes, so the state reached during the pause must be shown right after it.
const resume = () => { paused = false; skew += (Date.now() - pausedAt) / 1000; if (lastDropped) { frames.push({ t: frames.at(-1).t + 0.04, buf: lastDropped }); lastDropped = null; } };
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => { if (paused) lastDropped = Buffer.from(data, 'base64'); else frames.push({ t: metadata.timestamp - skew, buf: Buffer.from(data, 'base64') }); cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {}); });
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 720, maxHeight: 1280, everyNthFrame: 1 });
const caption = (text, o = {}) => page.evaluate(([t, big]) => {
  let el = document.getElementById('mk-cap');
  if (!el) {
    el = document.createElement('div'); el.id = 'mk-cap';
    el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:18px;z-index:99999;padding:14px 16px;border-radius:14px;background:#1e1f21;color:#fff;font:800 22px/1.25 "Segoe UI",system-ui,sans-serif;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.35)';
    document.body.appendChild(el);
  }
  el.style.fontSize = big ? '30px' : '22px';
  el.innerHTML = t;
}, [text, !!o.big]);
const hold = (ms) => page.waitForTimeout(ms);
const type = (loc, text) => loc.pressSequentially(text, { delay: 70 });

await page.goto(`${BASE}/app/invoices/new`);
await page.getByRole('heading', { name: /New tax invoice/ }).waitFor();
await caption('Invoice banana hai? <span style="color:#ffc247">30 second</span> lagte hain.', { big: true }); startAt = frames.at(-1)?.t ?? null; await hold(2600);

await caption('1. Customer jodiye');
await page.getByLabel('Customer', { exact: true }).selectOption('__new'); await hold(500);
await type(page.getByLabel('Customer name'), 'Verma Stores');
await page.getByLabel('State', { exact: true }).selectOption('27'); await hold(500);
await page.getByRole('button', { name: 'Add customer' }).click(); await hold(700);
await page.getByLabel('Customer', { exact: true }).selectOption({ label: 'Verma Stores' }); await hold(700);

await caption('2. Item aur rate daaliye');
await type(page.getByLabel('Line 1 description'), 'Consulting');
await type(page.getByLabel('Line 1 HSN or SAC'), '998313');
await type(page.getByLabel('Line 1 rate'), '10000'); await hold(500);

await caption('3. <span style="color:#7ee0a5">GST khud lag jaata hai</span>');
await page.getByTestId('grand-total').scrollIntoViewIfNeeded(); await hold(2600);

await caption('4. Issue karein — number apne aap');
await page.getByRole('button', { name: 'Issue tax invoice' }).click(); await hold(300);
pause();   // the page reloads (a long splash in a dev build): that stretch is cut out
await page.getByRole('heading', { name: /Tax invoice INV/ }).waitFor(); await page.waitForLoadState('load');
await caption('4. Issue karein — number apne aap');   // the page was replaced, so the caption has to be put back
await hold(200); resume(); await hold(2400);

await caption('5. WhatsApp pe bhejiye');
await type(page.getByLabel('Mobile number'), '9876543210'); await hold(400);
await page.getByRole('button', { name: 'Send', exact: true }).click(); await hold(600);
pause();   // the page polls for the delivery for a while; the wait is cut out
try { await page.getByText('Sent by whatsapp.').waitFor({ timeout: 60000 }); }
catch (e) { await page.screenshot({ path: join(out, 'debug.png') }); console.log((await page.locator('main').innerText()).slice(0, 600)); throw e; }
resume();
await page.getByText('Sent by whatsapp.').evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' })); await hold(3000);

await caption('Kora — <span style="color:#ffc247">free mein shuru karein</span><br><span style="font-size:20px;font-weight:600">Link in bio</span>', { big: true }); await hold(3200);

await cdp.send('Page.stopScreencast');
await ctx.close();
await browser.close();

// Constant 25 fps: every tick shows the newest frame at or before it, so a still screen is held and timing is true.
const FPS = 25, t0 = startAt ?? frames[0].t, t1 = frames.at(-1).t + 1;
const ffdir = readdirSync(join(process.env.LOCALAPPDATA, 'ms-playwright')).filter((n) => n.startsWith('ffmpeg-')).sort().at(-1);
const ff = spawn(join(process.env.LOCALAPPDATA, 'ms-playwright', ffdir, 'ffmpeg-win64.exe'),
  ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', '-vf', 'scale=720:1280', '-c:v', 'libvpx', '-b:v', '2M', '-pix_fmt', 'yuv420p', join(out, 'invoice-30-seconds.webm')], { stdio: ['pipe', 'ignore', 'inherit'] });
let k = 0;
for (let t = t0; t < t1; t += 1 / FPS) {
  while (k + 1 < frames.length && frames[k + 1].t <= t) k++;
  if (!ff.stdin.write(frames[k].buf)) await new Promise((r) => ff.stdin.once('drain', r));
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
console.log('video:', join(out, 'invoice-30-seconds.webm'), `${(t1 - t0).toFixed(1)}s`);
