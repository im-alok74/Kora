import { expect, test } from '@playwright/test';
import { db, gstin, signedIn } from '../helpers';

const pdf = (s: string) => ({ name: `${s}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4 ${s}`) });

test('work goes from checklist to review by a second person to a recorded filing and closed', async ({ page, context, browser }) => {
  const partner = await signedIn(context);
  await page.goto('/ca');
  await page.getByLabel('Firm name').fill('Mehta and Co');
  await page.getByRole('button', { name: 'Create firm' }).click();
  await expect(page.getByRole('heading', { name: 'Work', exact: true })).toBeVisible();
  await page.goto('/ca/clients');
  await page.getByLabel('Client name').fill('Alpha Foods');
  await page.getByLabel('GSTIN').fill(gstin('27'));
  await page.getByRole('button', { name: 'Add client' }).click();
  await expect(page.getByRole('table', { name: 'Clients' })).toContainText('Alpha Foods');

  // A second person joins the firm as reviewer (there is no screen for adding people yet, so the setup is direct).
  const rcontext = await browser.newContext();
  const reviewer = await signedIn(rcontext, `rev${Date.now()}@example.test`);
  const firmId = (await db`select firm_id as id from firm_member where user_id = ${partner.userId}`)[0]!.id as string;
  const clientId = (await db`select id from client_entity where firm_id = ${firmId}`)[0]!.id as string;
  await db`insert into firm_member (firm_id, user_id, role) values (${firmId}, ${reviewer.userId}, 'reviewer')`;
  await db`insert into client_assignment (firm_id, client_id, user_id, assigned_by) values (${firmId}, ${clientId}, ${reviewer.userId}, ${partner.userId})`;

  await page.goto('/ca');
  await page.getByLabel('Month worked on').fill('2026-08');
  await page.getByRole('button', { name: 'Create 2026-08 work' }).click();
  await expect(page.getByRole('status')).toContainText('2 added');
  await page.getByLabel('Preparer for GSTR-1 for Alpha Foods').selectOption({ label: partner.email });
  await page.getByLabel('Reviewer for GSTR-1 for Alpha Foods').selectOption({ label: reviewer.email });

  // Checklist: add the three standard items, put a file on each and accept it.
  await page.getByRole('button', { name: 'Documents' }).first().click();
  await page.getByRole('button', { name: 'Add the standard list' }).click();
  await expect(page.getByText('Bank statement for the month')).toBeVisible();
  for (const n of [0, 1, 2]) {
    await page.getByLabel('Add a file you received').nth(0).setInputFiles(pdf(`file${n}`));
    await page.getByRole('button', { name: 'Accept' }).first().click();
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0);   // gone for the one just accepted…
    if (n < 2) await expect(page.getByText('Accepted')).toHaveCount(n + 1);
  }
  await expect(page.getByText('Accepted')).toHaveCount(3);

  // Filing cannot be recorded before the review is approved.
  await expect(page.getByText('A filing can be recorded once the review is approved.')).toBeVisible();
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByText('Waiting for the reviewer')).toBeVisible();

  // The person who submitted cannot approve; the reviewer can.
  await page.getByRole('button', { name: 'Approve this version' }).click();
  await expect(page.locator('p.error')).toContainText('someone else');
  const r = await rcontext.newPage();
  await r.goto('/ca');
  await r.getByLabel('Month worked on').fill('2026-08');
  await r.getByRole('button', { name: 'Documents' }).first().click();
  await r.getByRole('button', { name: 'Approve this version' }).click();
  await expect(r.getByText('Approved', { exact: true }).first()).toBeVisible();

  // The partner records the filing and closes the work.
  await page.reload();
  await page.getByLabel('Month worked on').fill('2026-08');
  await page.getByRole('button', { name: 'Documents' }).first().click();
  await expect(page.getByRole('button', { name: 'Close this work' })).toBeDisabled();
  await page.getByLabel('Reference (ARN)').fill('AA270826001');
  await page.getByLabel('Filed on').fill('2026-09-10');
  await page.getByLabel('Acknowledgement file').setInputFiles(pdf('ack'));
  await page.getByRole('button', { name: 'Record the filing' }).click();
  await expect(page.getByText('Kora has not checked it with the GST portal.')).toBeVisible();
  await page.getByRole('button', { name: 'Close this work' }).click();
  await expect(page.getByLabel('Status of GSTR-1 for Alpha Foods')).toHaveValue('done');
  await rcontext.close();
});
