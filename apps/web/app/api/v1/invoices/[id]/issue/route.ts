import { issueDocument } from '@kora/core';
import { v1Route } from '../../../../../../lib/apiV1';

/** Gives a draft its number and locks it. An issued document can only be corrected with a credit or debit note. */
export const POST = v1Route({ write: true }, async ({ t, sql, params }) => {
  const d = (await issueDocument(sql, t, params.id!)).document;
  return { id: d.id, status: d.status, number: d.number, total_paise: d.grand_total_paise };
});
