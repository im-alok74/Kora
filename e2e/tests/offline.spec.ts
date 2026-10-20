import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { db, fillInvoice, makeBusiness, signedIn } from '../helpers';

async function owner(context: BrowserContext) {
  const u = await signedIn(context);
  const b = await makeBusiness(u.userId);
  return { ...u, ...b };
}

/** Visits the editor online so the service worker and the device cache have what they need, then waits until they do. */
async function warm(page: Page) {
  await page.goto('/app/invoices/new');
  await expect(page.getByRole('heading', { name: /New tax invoice/ })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(async () => page.evaluate(async () => {
    const names = ['/app/invoices', '/app/invoices/new', '/app/invoices/offline'];
    const c = await caches.open('kora-pages-v1');
    return (await Promise.all(names.map((n) => c.match(n)))).every(Boolean);
  }), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => new Promise<boolean>((res) => {
    const r = indexedDB.open('kora-offline', 1);
    r.onsuccess = () => { const t = r.result.transaction('cache'); const g = t.objectStore('cache').get('business'); g.onsuccess = () => res(!!g.result); g.onerror = () => res(false); };
    r.onerror = () => res(false);
  })), { timeout: 15_000 }).toBe(true);
}

test('the app is installable: manifest, icons and service worker are served', async ({ page, request }) => {
  await page.goto('/');
  const m = await (await request.get('/manifest.webmanifest')).json();
  expect(m).toMatchObject({ name: 'Kora', display: 'standalone', start_url: '/app/invoices', theme_color: '#7c2130' });
  for (const i of m.icons) expect((await request.get(i.src)).ok()).toBe(true);
  const sw = await request.get('/sw.js');
  expect(sw.ok()).toBe(true);
  expect(await sw.text()).toContain("startsWith('/api/')");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
});

test('a draft made offline is kept on the device, shown in the list, and syncs when the connection returns', async ({ page, context }) => {
  test.setTimeout(180_000);
  await owner(context);
  await warm(page);

  await context.setOffline(true);
  await expect(page.getByTestId('offline-note')).toBeVisible();
  await page.getByLabel('Line 1 description').fill('Offline consulting');
  await page.getByLabel('Line 1 HSN or SAC').fill('998313');
  await page.getByLabel('Line 1 rate').fill('1000');
  await expect(page.getByTestId('grand-total')).toHaveText('Rs 1,180.00');               // worked out on the device
  await expect(page.getByRole('button', { name: /Issue tax invoice/ })).toBeDisabled();   // issuing needs a connection
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByTestId('saved-locally')).toBeVisible();

  // The list opens offline too, and shows the draft.
  await page.goto('/app/invoices');
  await expect(page.getByTestId('local-drafts')).toContainText('Walk-in customer');
  await expect(page.getByTestId('local-drafts')).toContainText('Rs 1,180.00');
  await expect(page.getByTestId('sync-status')).toContainText('You are offline');

  // Back online: it syncs by itself.
  await context.setOffline(false);
  await expect(page.getByTestId('local-drafts')).toHaveCount(0, { timeout: 60_000 });
  const docs = (await (await page.request.get('/api/documents')).json()).documents;
  expect(docs).toHaveLength(1);
  expect(docs[0]).toMatchObject({ status: 'draft', grand_total_paise: '118000' });
  await expect(page.getByRole('link', { name: 'Draft' })).toBeVisible({ timeout: 30_000 });
});

test('an offline draft can be reopened and changed before it syncs', async ({ page, context }) => {
  test.setTimeout(180_000);
  await owner(context);
  await warm(page);
  await context.setOffline(true);
  await fillInvoice(page, { desc: 'First version', rate: '500' }).catch(async () => {
    await page.getByLabel('Line 1 description').fill('First version');
    await page.getByLabel('Line 1 HSN or SAC').fill('998313');
    await page.getByLabel('Line 1 rate').fill('500');
  });
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByTestId('saved-locally')).toBeVisible();
  await page.goto('/app/invoices');
  await page.getByRole('link', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Edit draft' })).toBeVisible();
  await expect(page.getByLabel('Line 1 description')).toHaveValue('First version');
  await page.getByLabel('Line 1 rate').fill('800');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByTestId('saved-locally')).toBeVisible();
  await context.setOffline(false);
  await expect.poll(async () => (await (await page.request.get('/api/documents')).json()).documents.length, { timeout: 60_000 }).toBe(1);
  const d = (await (await page.request.get('/api/documents')).json()).documents[0];
  expect(d.grand_total_paise).toBe('94400');   // one document, with the second version: 800 plus 18%
});

test('a reload while offline still opens the app', async ({ page, context }) => {
  await owner(context);
  await warm(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: /New tax invoice/ })).toBeVisible();
  await expect(page.getByTestId('offline-note')).toBeVisible();
  await context.setOffline(false);
});

test('two devices editing one draft: the second is told, and chooses', async ({ page, context }) => {
  test.setTimeout(240_000);
  await owner(context);
  const created = await (await page.request.post('/api/documents', { data: { docType: 'tax_invoice', clientRef: 'e2e-conflict-0001',
    lines: [{ name: 'Original', hsnSac: '998313', quantity: '1', rate: '100', taxRateBp: 1800 }] } })).json();
  await warm(page);
  await page.goto(`/app/invoices/${created.id}/edit`);
  await expect(page.getByLabel('Line 1 rate')).toHaveValue('100.00');
  await context.setOffline(true);
  await page.getByLabel('Line 1 rate').fill('300');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByTestId('saved-locally')).toBeVisible();
  // meanwhile, another device changes the same draft
  await db`update document set notes = 'changed on the other device' where id = ${created.id}`;
  await context.setOffline(false);
  await expect(page.getByTestId('sync-status')).toContainText('changed on another device', { timeout: 60_000 });
  await page.getByRole('link', { name: 'Choose which to keep' }).click();
  await expect(page.getByTestId('conflict')).toBeVisible();
  await page.getByRole('button', { name: 'Keep my version' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/invoices/${created.id}$`), { timeout: 60_000 });
  const doc = await (await page.request.get(`/api/documents/${created.id}`)).json();
  expect(doc.lines[0].rate_paise).toBe('30000');
});

test('signing out clears what was kept on the device', async ({ page, context }) => {
  await owner(context);
  await warm(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/localhost:\d+\/$/);
  const left = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((k) => k.startsWith('kora-pages')); // built scripts are public and not personal
    let cached = 0;
    for (const n of names) cached += (await (await caches.open(n)).keys()).length;
    const rows = await new Promise<number>((res) => {
      const r = indexedDB.open('kora-offline', 1);
      r.onsuccess = () => { const g = r.result.transaction('cache').objectStore('cache').count(); g.onsuccess = () => res(g.result); g.onerror = () => res(-1); };
      r.onerror = () => res(-1);
    });
    return { cached, rows };
  });
  expect(left).toEqual({ cached: 0, rows: 0 });
});
