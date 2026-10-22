import { expect, test } from '@playwright/test';

test('the tools page lists every tool and the sitemap has them', async ({ page, request }) => {
  await page.goto('/tools');
  for (const t of ['GST Calculator', 'Invoice Generator', 'Quotation Maker', 'Proforma Invoice Generator', 'Purchase Order Generator', 'Receipt Maker', 'QR Code Generator', 'Online Barcode Generator', 'QR Code Scanner from Image', 'Online Barcode Scanner', 'Logo Maker']) {
    await expect(page.getByRole('link', { name: new RegExp(`^${t}`) }).first()).toBeVisible();
  }
  const map = await (await request.get('/sitemap.xml')).text();
  expect(map).toContain('/tools/gst-calculator');
});

test('the GST calculator adds GST, takes it out, and switches to IGST', async ({ page }) => {
  await page.goto('/tools/gst-calculator');
  await page.getByLabel('Amount (Rs)').fill('1000');
  await expect(page.getByRole('status').filter({ hasText: 'Amount with GST' })).toContainText('1,180.00');
  await expect(page.getByText('CGST (9%)')).toBeVisible();
  await page.getByLabel('To another state (IGST)').check();
  await expect(page.getByText('IGST (18%)')).toBeVisible();
  await page.getByLabel('With GST included (take GST out)').check();
  await expect(page.getByRole('status').filter({ hasText: 'Amount before GST' })).toContainText('847.46');
});

test('the invoice generator works out the total, and the receipt maker writes the amount in words', async ({ page }) => {
  await page.goto('/tools/invoice-generator');
  await page.getByLabel('Item 1 description').fill('Consulting');
  await page.getByLabel('Rate (Rs)').fill('10000');
  await expect(page.getByTestId('doc-total')).toHaveText('Rs 11,800.00');
  await page.getByLabel('I am registered for GST').uncheck();
  await expect(page.getByTestId('doc-total')).toHaveText('Rs 10,000.00');
  await page.goto('/tools/receipt-maker');
  await page.getByLabel('Amount received (Rs)').fill('2500');
  await expect(page.locator('.doc-receipt')).toContainText('Two Thousand Five Hundred');
});

test('QR, barcode and logo tools make images', async ({ page }) => {
  await page.goto('/tools/qr-code-generator');
  await page.getByLabel('Web address').fill('https://example.com');
  await expect(page.getByRole('img', { name: 'Your QR code' })).toBeVisible();
  await page.goto('/tools/barcode-generator');
  await page.getByLabel('Code to encode').fill('SKU-10042');
  await expect(page.getByRole('img', { name: /Code 128 barcode for SKU-10042/ })).toBeVisible();
  await page.getByLabel('Code to encode').fill('नमस्ते');
  await expect(page.getByText('Use letters, numbers and common symbols only.')).toBeVisible();
  await page.goto('/tools/logo-maker');
  await expect(page.getByRole('img', { name: /Logo preview for Sharma Traders/ })).toBeVisible();
});

test('the scanner reads a QR code from a picture', async ({ page }) => {
  await page.goto('/tools/qr-code-generator');
  await page.getByLabel('Web address').fill('https://kora.example/hello');
  const src = await page.getByRole('img', { name: 'Your QR code' }).getAttribute('src');
  const png = Buffer.from(src!.split(',')[1]!, 'base64');
  await page.goto('/tools/qr-code-scanner');
  const supported = await page.evaluate(() => 'BarcodeDetector' in window);
  test.skip(!supported, 'this browser has no BarcodeDetector');
  await page.getByLabel(/Choose a picture/).setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.tl-found code')).toHaveText('https://kora.example/hello');
});

test('the tools fit a phone screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const p of ['/tools', '/tools/invoice-generator', '/tools/gst-calculator', '/tools/logo-maker', '/tools/barcode-scanner']) {
    await page.goto(p);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over, `${p} overflows by ${over}px`).toBeLessThanOrEqual(1);
  }
});
