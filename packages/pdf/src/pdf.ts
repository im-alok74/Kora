import { chromium, type Browser } from 'playwright';

let browser: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] }).catch((e) => { browser = null; throw e; });
  }
  return browser;
}

/**
 * Renders HTML to a PDF with headless Chromium. The page runs with JavaScript off and every network
 * request refused, so a document can only draw what is in the HTML itself.
 */
export async function renderPdf(html: string, paper: 'A4' | 'A5' = 'A4'): Promise<Buffer> {
  const ctx = await (await getBrowser()).newContext({ javaScriptEnabled: false, offline: true });
  try {
    const page = await ctx.newPage();
    await page.route('**/*', (route) => (route.request().url().startsWith('data:') ? route.continue() : route.abort()));
    await page.setContent(html, { waitUntil: 'load' });
    return Buffer.from(await page.pdf({ format: paper, printBackground: true, preferCSSPageSize: true }));
  } finally {
    await ctx.close();
  }
}

export async function closePdfBrowser(): Promise<void> {
  if (browser) { const b = await browser; browser = null; await b.close(); }
}
