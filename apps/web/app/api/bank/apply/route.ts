import { bankApply, type BankApplyItem } from '@kora/core';
import { readJson, tenantRoute } from '../../../../lib/server';

/** Body: { items: [{ kind: "invoice" | "bill", id, amount, date, description, fingerprint }] }. Records each as a payment. */
export const POST = tenantRoute(async ({ t, sql, req }) => {
  const b = await readJson<{ items?: BankApplyItem[] }>(req);
  return bankApply(sql, t, b.items ?? []);
});
