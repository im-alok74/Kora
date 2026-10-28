import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLANS } from '@kora/core';

// The pricing page is typed by hand (it is a static page that cannot import the server code). This keeps it equal to the limits
// the product enforces, so the page never promises what the checks do not give.
const page = readFileSync(join(__dirname, '..', 'app', 'pricing', 'page.tsx'), 'utf8');

describe('pricing page and plans agree', () => {
  it('says the free plan allows the number of invoices the code allows', () => {
    expect(page).toContain(`${PLANS.starter.limits.invoicesPerMonth} invoices and quotes a month`);
    expect(page).toContain(`'${PLANS.starter.limits.invoicesPerMonth} a month'`);
  });
  it('lists the team sizes of the three plans', () => {
    expect(page).toContain(`['Team members', '${PLANS.starter.limits.members}', 'Up to ${PLANS.business.limits.members}', 'Up to ${PLANS.firm.limits.members}']`);
  });
  it('shows the prices of the plans', () => {
    expect(page).toContain(`Rs ${PLANS.business.pricePaise / 100}`);
    expect(page).toContain(`Rs ${(PLANS.firm.pricePaise / 100).toLocaleString('en-IN')}`);
  });
});
