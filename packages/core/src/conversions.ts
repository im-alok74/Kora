import type { Sql } from '@kora/db';
import type { DocType } from '@kora/tax';
import { convertEstimate } from './estimates.js';
import { copyCustom } from './customfields.js';
import { FOREIGN_OK, linesToInput, persist, type DocIn } from './documents.js';
import { inTenant, type TenantSession } from './tenancy.js';
import { ValidationError } from './validation.js';

const rateText = (m: bigint) => `${m / 1_000_000n}.${(m % 1_000_000n).toString().padStart(6, '0')}`;

/**
 * Starts a new version of a quote. The old version stays as it was until the new one is issued, and then it is withdrawn,
 * so the customer only ever has one open quote. A quote the customer has accepted, or that became an invoice, is final.
 */
export async function reviseEstimate(sql: Sql, t: TenantSession, documentId: string) {
  return inTenant(sql, t, 'document.write', async (tx) => {
    const [d] = await tx`select d.*, estimate_status(d.status, d.due_date, b.timezone, es.decision, es.converted_to_id) as est
                           from document d join business b on b.id = d.business_id left join estimate_state es on es.document_id = d.id
                          where d.id = ${documentId} for update of d`;
    if (!d || d.doc_type !== 'estimate') throw new ValidationError('Estimate not found.');
    if (d.status !== 'issued') throw new ValidationError('Only an issued quote can be revised. Edit the draft instead.');
    if (d.est === 'accepted') throw new ValidationError('The customer has accepted this quote. Raise an order or an invoice from it instead.');
    if (d.est === 'invoiced') throw new ValidationError('This quote has already been turned into an invoice.');
    const [open] = await tx`select id from document where previous_version_id = ${documentId} and status = 'draft'`;
    if (open) return { id: open.id as string, version: Number(d.version) + 1, alreadyStarted: true };
    const [later] = await tx`select id from document where previous_version_id = ${documentId} and status <> 'cancelled'`;
    if (later) throw new ValidationError('A newer version of this quote already exists.');
    const lines = await tx`select * from document_line where document_id = ${documentId} order by position`;
    const foreign = !!d.currency && d.currency !== 'INR';
    const made = await persist(tx, t, null, {
      docType: 'estimate', partyId: d.party_id as string | null, placeOfSupply: d.place_of_supply as string, reverseCharge: d.reverse_charge as boolean,
      notes: d.notes as string | null, terms: d.terms as string | null, reference: d.reference as string | null, subject: d.subject as string | null,
      paymentTerms: d.payment_terms as string | null, extra: d.extra as { label: string; value: string }[] | null, salesperson: d.salesperson as string | null,
      dueDate: d.due_date as string | null, tcsBp: Number(d.tcs_bp ?? 0), tdsBp: Number(d.tds_bp ?? 0),
      ...(foreign ? { currency: d.currency as string, exchangeRate: rateText(BigInt(String(d.exchange_rate_micro))) } : {}),
      lines: linesToInput(lines), previousVersionId: documentId, version: Number(d.version) + 1, custom: await copyCustom(tx, d.custom_values),
    });
    return { id: made.id, version: Number(d.version) + 1, alreadyStarted: false };
  });
}

/** What each kind of document can become. "invoice" means a tax invoice or a bill of supply, whichever the registration allows. */
export const CONVERSIONS: Record<string, readonly string[]> = {
  estimate: ['sales_order', 'proforma', 'delivery_challan', 'invoice'],
  sales_order: ['proforma', 'delivery_challan', 'invoice'],
  proforma: ['delivery_challan', 'invoice'],
  delivery_challan: ['invoice'],
};

/**
 * Makes a draft of another kind from an issued document: same customer, lines and notes. Doing it twice returns the draft
 * (or issued document) made the first time, never a second one. A quote counts as accepted once an order or invoice is made from it.
 */
export async function convertDocument(sql: Sql, t: TenantSession, documentId: string, target: string) {
  const [src] = await inTenant(sql, t, 'document.read', (tx) => tx`select doc_type from document where id = ${documentId}`);
  if (!src) throw new ValidationError('Document not found.');
  const allowed = CONVERSIONS[src.doc_type as string];
  if (!allowed || !allowed.includes(target)) throw new ValidationError('This document cannot be turned into that.', 'target');
  if (src.doc_type === 'estimate' && target === 'invoice') {
    const r = await convertEstimate(sql, t, documentId);
    await inTenant(sql, t, 'document.write', (tx) => tx`update document set source_document_id = ${documentId} where id = ${r.id} and source_document_id is null`);
    return r;
  }
  return inTenant(sql, t, 'document.write', async (tx) => {
    const [d] = await tx`select d.*, b.registration_type from document d join business b on b.id = d.business_id where d.id = ${documentId} for update of d`;
    if (!d) throw new ValidationError('Document not found.');
    if (d.status !== 'issued') throw new ValidationError('Issue this document before turning it into another one.');
    const toInvoice = target === 'invoice';
    const docType = (toInvoice ? (d.registration_type === 'regular' ? 'tax_invoice' : 'bill_of_supply') : target) as DocType;
    const [existing] = await tx`select id from document where source_document_id = ${documentId} and doc_type = ${docType} and status <> 'cancelled' order by created_at limit 1`;
    if (existing) return { id: existing.id as string, alreadyConverted: true, warnings: [] as string[] };
    if (src.doc_type === 'estimate') {
      const [st] = await tx`select decision from estimate_state where document_id = ${documentId}`;
      if (st?.decision === 'declined') throw new ValidationError('This quote was declined. Mark it accepted first if the customer changed their mind.');
      await tx`insert into estimate_state (business_id, document_id, decision, decided_at, decided_by)
               values (${t.businessId}, ${documentId}, 'accepted', now(), ${t.userId})
               on conflict (document_id) do update set decision = coalesce(estimate_state.decision, 'accepted'),
                                                       decided_at = coalesce(estimate_state.decided_at, now())`;
    }
    const lines = await tx`select * from document_line where document_id = ${documentId} order by position`;
    const foreign = !!d.currency && d.currency !== 'INR';
    const rate = BigInt(String(d.exchange_rate_micro));
    // Another currency carries over to documents that can hold it. A rupee document (an invoice or a challan) takes the amounts at the quoted rate.
    const keepsCurrency = foreign && FOREIGN_OK.has(docType);
    const input: DocIn = {
      docType, partyId: d.party_id as string | null, reverseCharge: d.reverse_charge as boolean,
      placeOfSupply: foreign && !keepsCurrency ? undefined : (d.place_of_supply as string),
      notes: d.notes as string | null, terms: d.terms as string | null, reference: d.reference as string | null, subject: d.subject as string | null,
      extra: d.extra as { label: string; value: string }[] | null, salesperson: d.salesperson as string | null,
      tcsBp: toInvoice ? Number(d.tcs_bp ?? 0) : 0, tdsBp: toInvoice ? Number(d.tds_bp ?? 0) : 0,
      ...(keepsCurrency ? { currency: d.currency as string, exchangeRate: rateText(rate) } : {}),
      lines: linesToInput(lines, foreign && !keepsCurrency ? rate : 1_000_000n, d.currency as string),
      sourceDocumentId: documentId, custom: await copyCustom(tx, d.custom_values),
    };
    const made = await persist(tx, t, null, input);
    return { id: made.id, alreadyConverted: false, warnings: made.warnings };
  });
}
