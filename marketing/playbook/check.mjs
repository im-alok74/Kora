// Layout check: in print media at the A4 content width, which sections are taller than one printed page (they spill over).
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '../../packages/pdf/node_modules/playwright/index.mjs';
const here = dirname(fileURLToPath(import.meta.url)).replace(/^\/([A-Za-z]:)/, '$1');
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: Math.round(180 / 25.4 * 96), height: 1000 } });
await p.emulateMedia({ media: 'print' });
await p.goto(pathToFileURL(join(here, 'playbook.html')).href);
const limit = (297 - 16 - 18) / 25.4 * 96;
const rows = await p.$$eval('section', (ss) => ss.map((s, i) => ({ i, title: (s.querySelector('h2,h1')?.textContent ?? '').slice(0, 40), h: Math.round(s.getBoundingClientRect().height) })));
for (const r of rows) console.log(String(r.i).padStart(2), r.h > limit ? 'SPILLS' : 'ok    ', r.h, '/', Math.round(limit), r.title);
for (const i of (process.argv[2] ?? '').split(',').filter(Boolean)) {
  await (await p.$$('section'))[Number(i)].screenshot({ path: join(here, `sec-${i}.png`) });
}
await b.close();
