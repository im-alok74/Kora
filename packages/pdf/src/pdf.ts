import { chromium, type Browser } from 'playwright';

let browser: Promise<Browser> | null = null;

/**
 * On Vercel (or with PDF_CHROMIUM=sparticuz) there is no installed browser, so a Chromium built for serverless
 * functions is unpacked from the deployment and used instead. Everywhere else the browser Playwright installed is used.
 */
async function launchOptions() {
  if (process.env.VERCEL || process.env.PDF_CHROMIUM === 'sparticuz') {
    const { default: lambda } = await import('@sparticuz/chromium');
    return { executablePath: await lambda.executablePath(), args: [...lambda.args, '--no-sandbox'], headless: true };
  }
  return { args: ['--no-sandbox', '--disable-gpu'] };
}

const serverless = () => !!process.env.VERCEL || process.env.PDF_CHROMIUM === 'sparticuz';

function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = launchOptions().then((o) => chromium.launch(o)).catch((e) => { browser = null; throw e; });
  }
  return browser;
}

/**
 * Renders HTML to a PDF with headless Chromium. The page runs with JavaScript off and every network
 * request refused, so a document can only draw what is in the HTML itself.
 */
export type Paper = 'A4' | 'A5' | 'THERMAL';

/** The paper a template prints on: a receipt layout always uses a narrow roll. */
export const paperFor = (t: { layout?: string; paper?: string } | null | undefined): Paper => (t?.layout === 'thermal' ? 'THERMAL' : t?.paper === 'A5' ? 'A5' : 'A4');

/**
 * At most PDF_CONCURRENCY (default 4) PDFs are drawn at once in a process; the rest wait their turn. Without a cap a burst opens a page per
 * request in one shared browser and can exhaust the server's memory. A burst of 90 on a laptop took 27 seconds and all 90 were good.
 */
const MAX_AT_ONCE = Math.max(1, Number(process.env.PDF_CONCURRENCY ?? 4));
let running = 0;
const waiting: (() => void)[] = [];
async function turn<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_AT_ONCE) await new Promise<void>((go) => waiting.push(go));
  else running++;
  try { return await job(); }
  finally { const next = waiting.shift(); if (next) next(); else running--; }   // hand the place straight to the next in line
}

export const renderPdf = (html: string, paper: Paper = 'A4'): Promise<Buffer> => turn(() => draw(html, paper));

async function draw(html: string, paper: Paper): Promise<Buffer> {
  // The serverless Chromium runs as a single process, which exits when its last page closes, so it cannot be kept for the next
  // request. There, each PDF starts its own browser and closes it. Elsewhere one browser is shared by every PDF.
  const own = serverless() ? await launchOptions().then((o) => chromium.launch(o)) : null;
  const ctx = await (own ?? (await getBrowser())).newContext({ javaScriptEnabled: false, offline: true });
  try {
    const page = await ctx.newPage();
    await page.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
    await page.setContent(html, { waitUntil: 'load' });
    if (paper === 'THERMAL') {
      // A roll has no fixed length: measure the content and cut the page to fit (plus a little to tear off).
      const px = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight)).catch(() => 1200);
      return Buffer.from(await page.pdf({ width: '80mm', height: `${Math.max(60, Math.ceil(px * 0.2646) + 10)}mm`, printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } }));
    }
    return Buffer.from(await page.pdf({ format: paper, printBackground: true, preferCSSPageSize: true }));
  } finally {
    await ctx.close().catch(() => {});
    if (own) await own.close().catch(() => {});
  }
}

export async function closePdfBrowser(): Promise<void> {
  if (browser) { const b = await browser; browser = null; await b.close(); }
}
