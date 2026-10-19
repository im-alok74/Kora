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
export async function renderPdf(html: string, paper: 'A4' | 'A5' = 'A4'): Promise<Buffer> {
  // The serverless Chromium runs as a single process, which exits when its last page closes, so it cannot be kept for the next
  // request. There, each PDF starts its own browser and closes it. Elsewhere one browser is shared by every PDF.
  const own = serverless() ? await launchOptions().then((o) => chromium.launch(o)) : null;
  const ctx = await (own ?? (await getBrowser())).newContext({ javaScriptEnabled: false, offline: true });
  try {
    const page = await ctx.newPage();
    await page.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
    await page.setContent(html, { waitUntil: 'load' });
    return Buffer.from(await page.pdf({ format: paper, printBackground: true, preferCSSPageSize: true }));
  } finally {
    await ctx.close().catch(() => {});
    if (own) await own.close().catch(() => {});
  }
}

export async function closePdfBrowser(): Promise<void> {
  if (browser) { const b = await browser; browser = null; await b.close(); }
}
