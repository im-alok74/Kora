import { SYSTEM_USER, type Sql } from '@kora/db';
import { getDocumentTx, linesToInput, persist, type DocIn } from './documents.js';
import { emitEvent } from './webhooks.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { ValidationError } from './validation.js';

/** Accept or decline an issued estimate. The estimate itself stays frozen; the decision is recorded beside it. */
export async function decideEstimate(sql: Sql, t: TenantSession, documentId: string, decision: 'accepted' | 'declined', via: 'staff' | 'portal' = 'staff') {
  if (decision !== 'accepted' && decision !== 'declined') throw new ValidationError('Choose accepted or declined.', 'decision');
  return inTenant(sql, t, 'document.issue', async (tx) => {
    const [d] = await tx`select d.doc_type, d.status, estimate_status(d.status, d.due_date, b.timezone, es.decision, es.converted_to_id) as est
                           from document d join business b on b.id = d.business_id left join estimate_state es on es.document_id = d.id
                          where d.id = ${documentId} for update of d`;
    if (!d || d.doc_type !== 'estimate') throw new ValidationError('Estimate not found.');
    if (d.status !== 'issued') throw new ValidationError('Issue the estimate before recording an answer.');
    if (d.est === 'invoiced') throw new ValidationError('This estimate has already been turned into an invoice.');
    if (d.est === 'expired') throw new ValidationError('This estimate has expired. Make a new one.');
    // The automatic system actor is not a person, so no user is recorded when the customer answers from their portal.
    const by = t.userId === SYSTEM_USER ? null : t.userId;
    await tx`insert into estimate_state (business_id, document_id, decision, decided_at, decided_by, decided_via)
             values (${t.businessId}, ${documentId}, ${decision}, now(), ${by}, ${via})
             on conflict (document_id) do update set decision = excluded.decision, decided_at = excluded.decided_at,
                                                     decided_by = excluded.decided_by, decided_via = excluded.decided_via`;
    const [num] = await tx`select number from document where id = ${documentId}`;
    await emitEvent(tx, t.businessId, decision === 'accepted' ? 'estimate.accepted' : 'estimate.declined', { id: documentId, number: num!.number, answered_by: via });
    return (await getDocumentTx(tx, documentId))!;
  });
}

/**
 * Turns an issued estimate into a draft invoice with the same customer and lines. Doing it twice returns the same
 * draft rather than a second invoice. If that draft is deleted, the estimate can be converted again.
 */
export async function convertEstimate(sql: Sql, t: TenantSession, documentId: string) {
  return inTenant(sql, t, 'document.write', async (tx) => {
    const [d] = await tx`select d.doc_type, d.status, d.party_id, d.place_of_supply, d.reverse_charge, d.notes, d.terms, d.reference, d.subject, d.payment_terms, d.extra, d.salesperson, d.tcs_bp, d.tds_bp, d.currency, d.exchange_rate_micro,
                                estimate_status(d.status, d.due_date, b.timezone, es.decision, es.converted_to_id) as est,
                                b.registration_type
                           from document d join business b on b.id = d.business_id left join estimate_state es on es.document_id = d.id
                          where d.id = ${documentId} for update of d`;
    if (!d || d.doc_type !== 'estimate') throw new ValidationError('Estimate not found.');
    if (d.status !== 'issued') throw new ValidationError('Issue the estimate before turning it into an invoice.');
    if (d.est === 'expired') throw new ValidationError('This estimate has expired. Make a new one.');
    if (d.est === 'declined') throw new ValidationError('This estimate was declined. Mark it accepted first if the customer changed their mind.');

    await tx`insert into estimate_state (business_id, document_id) values (${t.businessId}, ${documentId}) on conflict (document_id) do nothing`;
    const [st] = await tx`select converted_to_id from estimate_state where document_id = ${documentId} for update`;
    if (st!.converted_to_id) return { id: st!.converted_to_id as string, alreadyConverted: true, warnings: [] as string[] };

    const lines = await tx`select * from document_line where document_id = ${documentId} order by position`;
    const input: DocIn = {
      docType: d.registration_type === 'regular' ? 'tax_invoice' : 'bill_of_supply',
      partyId: d.party_id as string | null, reverseCharge: d.reverse_charge as boolean,
      // A quote in another currency becomes a rupee invoice at the quoted rate. Its place of supply is worked out afresh, so a
      // customer outside India is refused with the same message as any other export, rather than carried over.
      placeOfSupply: d.currency === 'INR' ? (d.place_of_supply as string) : undefined,
      notes: d.notes as string | null, terms: d.terms as string | null,
      reference: d.reference as string | null, subject: d.subject as string | null,
      salesperson: d.salesperson as string | null, extra: d.extra as { label: string; value: string }[] | null,
      // The quote's expiry is not an invoice due date; recalculate from the new invoice date.
      paymentTerms: d.payment_terms as string | null,
      lines: linesToInput(lines, d.currency === 'INR' ? 1_000_000n : BigInt(d.exchange_rate_micro as string)),
      tcsBp: d.tcs_bp as number, tdsBp: d.tds_bp as number,
    };
    const made = await persist(tx, t, null, input);
    await tx`update estimate_state set converted_to_id = ${made.id}, decision = coalesce(decision, 'accepted'),
                                      decided_at = coalesce(decided_at, now()), decided_by = coalesce(decided_by, ${t.userId})
              where document_id = ${documentId}`;
    return { id: made.id, alreadyConverted: false, warnings: made.warnings };
  });
}
