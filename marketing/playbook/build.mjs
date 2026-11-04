// Renders playbook.html to Kora-Influencer-Playbook.pdf (A4) with the Chromium the PDF package already uses.
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '../../packages/pdf/node_modules/playwright/index.mjs';
const here = dirname(fileURLToPath(import.meta.url)).replace(/^\/([A-Za-z]:)/, '$1');
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(pathToFileURL(join(here, 'playbook.html')).href);
await p.pdf({ path: join(here, 'Kora-Influencer-Playbook.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: '<div style="font-size:8px;color:#888;width:100%;text-align:center;font-family:Segoe UI">Kora growth playbook · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>' });
await b.close();
console.log('ok');
