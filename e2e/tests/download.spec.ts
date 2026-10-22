import { expect, test } from '@playwright/test';

test('the header has a Download link, and the page offers an install for every device', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Download' }).click();
  await expect(page).toHaveURL(/\/download$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('every device');
  await expect(page.getByRole('region', { name: 'Windows' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mac' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Android' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'iPhone and iPad' })).toContainText('Add to Home Screen');
  // either a real file link or the plain "not published yet" note, never a dead button
  const win = page.getByRole('region', { name: 'Windows' });
  await expect(win.getByRole('link', { name: /Download/ }).or(win.getByRole('note'))).toBeVisible();
});

test('the Download page works at phone width without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/download');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
