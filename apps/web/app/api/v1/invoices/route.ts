import { getDocument, issueDocument, listDocuments, saveDraft, ValidationError, type DocIn } from '@kora/core';
import { created, ok, page, v1Route } from '../../../../lib/apiV1';

/** Documents of every type. Filter with type, status and q (a number or a customer name). */
export const GET = v1Route({}, async ({ t, sql, req }) => {
  const { q, limit, offset } = page(req);
  return { data: await listDocuments(sql, t, { type: q.get('type') ?? undefined, status: q.get('status') ?? undefined, q: q.get('q') ?? undefined, limit, offset }), limit, offset };
});

/**
 * Makes a draft, or issues it straight away with "issue": true. Totals are always worked out by Kora, never taken from the request.
 * Send an Idempotency-Key header (8 to 64 letters, digits, - or _) and a retry of the same request returns the same document
 * instead of making a second.
 */
export const POST = v1Route({ write: true }, async ({ t, sql, req }) => {
  const { issue, ...doc } = (await req.json()) as DocIn & { issue?: boolean };
  const key = req.headers.get('idempotency-key') ?? undefined;
  if (key !== undefined && !/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw new ValidationError('The Idempotency-Key must be 8 to 64 letters, digits, - or _.', 'idempotency-key');
  const saved = await saveDraft(sql, t, doc, null, { clientRef: key });
  let status: 'draft' | 'issued' = saved.alreadyIssued ? 'issued' : 'draft';
  let number: string | null = null;
  if (issue === true && !saved.alreadyIssued) {
    number = (await issueDocument(sql, t, saved.id)).document.number as string;
    status = 'issued';
  } else if (saved.alreadyIssued) {
    number = ((await getDocument(sql, t, saved.id))?.document.number as string | null) ?? null;
  }
  // A retry that finds the document already made is a success, but not a new creation.
  return (key && saved.alreadyIssued ? ok : created)({ id: saved.id, status, number, warnings: saved.warnings });
});
