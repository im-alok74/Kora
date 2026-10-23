import { test, expect } from '@playwright/test';

test('public navigation targets exist and branding respects motion preferences', async ({ page, request }) => {
  await page.goto('/');
  const links = await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')!));
  for (const href of new Set(links)) {
    if (href.startsWith('/#')) await expect(page.locator(href.slice(1))).toHaveCount(1);
    else expect((await request.get(href)).ok(), href).toBe(true);
  }
  const letter = page.locator('.kora-wordmark-letter').first();
  await expect(letter).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(letter).toHaveCSS('animation-name', 'kora-letter-reveal');
  await expect(page.locator('.kora-logo').first()).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.locator('#download').screenshot({ path: 'test-results/home-device-section.png' });
});

for (const width of [390, 1440]) {
  test(`download navigation and layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your business goes with you.' })).toBeVisible();
    await page.getByRole('link', { name: 'Get Kora for your device' }).click();
    await expect(page.getByRole('heading', { name: 'Kora on every device' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Open Kora in your browser/ })).toHaveAttribute('href', '/app');
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    if (width < 1081) {
      await page.getByLabel('Navigation menu').click();
      await expect(page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Download', exact: true })).toBeVisible();
    }
    await page.screenshot({ path: `test-results/download-${width}.png`, fullPage: true });
  });
}

for (const outcome of ['accepted', 'dismissed', 'error']) {
  test(`browser install handles ${outcome}`, async ({ page }) => {
    await page.goto('/download');
    // Wait for the effect to register its browser listeners.
    await page.waitForFunction(() => document.querySelector('.dl-card.mine') !== null);
    await page.evaluate((outcome) => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.assign(event, {
        prompt: async () => { if (outcome === 'error') throw new Error('installer unavailable'); },
        userChoice: Promise.resolve({ outcome }),
      });
      window.dispatchEvent(event);
    }, outcome);
    await page.getByRole('button', { name: 'Install Kora on this device' }).click();
    const message = outcome === 'accepted' ? 'Installation requested.' : outcome === 'dismissed' ? 'Installation cancelled.' : 'Installation could not start.';
    await expect(page.getByRole('status')).toContainText(message);
    await expect(page.getByRole('button', { name: 'Install Kora on this device' })).toHaveCount(0);
  });
}
