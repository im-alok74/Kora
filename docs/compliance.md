# Compliance: what Kora does and does not do for GST

Kora is software that helps a business issue correct GST documents and prepare data for its returns. **The owner remains responsible for the accuracy of every invoice and for all filings.** This page says what the software does, what it does not, and what a practising CA must confirm before the first real invoice.

Nothing in this document is legal or tax advice. Rates, thresholds and portal rules change, and several values below are starting points marked for CA review.

## What Kora does

### Invoice content and numbering
- Will not issue a tax invoice without the supplier's GSTIN, a place of supply, the HSN or SAC where required, and a tax breakup that matches its lines. The database refuses the issue otherwise.
- Numbers are assigned by the database at the moment of issue, in sequence, per document type and financial year (1 April to 31 March). A failed or rolled-back issue never uses up a number. Prefix and number together are at most 16 characters, using letters, digits, `/` and `-`.
- A cancelled document keeps its number. Gaps are therefore always explained by a visible cancelled document.
- An issued document cannot be edited or deleted. The database blocks it. Corrections are credit notes and debit notes that point at the original; a credit note cannot take back more than the original holds.
- Statutory fields on the printed document (supplier and recipient, number, date, place of supply, HSN or SAC, quantity, rate, discount, taxable value, tax breakup, total, reverse-charge statement, IRN and QR) are printed by code. The template editor cannot hide, move or rename them.
- The recipient and supplier details at the time of issue are copied onto the document, so later edits to a customer never change history.

### Tax calculation
One library computes everything, in integer paise, with these rules:
- Intra-state supply charges CGST and SGST (equal halves of the rate); inter-state supply charges IGST.
- Place of supply for goods is the ship-to state, otherwise the bill-to state. For services it is the recipient's registered state.
- Tax is rounded per line (half up) and then added up. The invoice total is rounded to the nearest rupee, and never rounded to zero.
- Cess is supported as a percentage of taxable value. Per-unit cess is refused, not ignored.
- Reverse charge shows the tax but leaves it out of the amount due.
- TDS reduces what the customer pays, not the invoice. TCS is added using the rate the user supplies.
- A composition dealer can issue a bill of supply but not a tax invoice. An unregistered business cannot issue a tax invoice. An invoice with every line at 0% is flagged as a possible bill of supply.

### E-invoicing
- Kora sends the IRP e-invoice JSON to a GST Suvidha Provider partner, stores the IRN, acknowledgement number and date, and signed QR, and prints the IRN and QR on the invoice and PDF.
- Before sending, Kora checks the details the portal requires (addresses, pincodes, GSTINs, HSN, number format) and says in plain words what to fix and where. It proves that the item totals add up to the invoice total, the rule rounding differences break.
- If the portal is down, registration is retried with growing delays, and the invoice shows that it is not yet legally complete. After repeated failures it is marked failed and can be resubmitted.
- If the portal rejects the invoice, the reason is shown with a fix. The buyer's GSTIN (within the same state), name and address can be corrected on the same screen, and the invoice resubmitted. The state cannot change, because that changes the tax.
- An e-invoice can be cancelled within 24 hours. After that, Kora steers to a credit note.
- Whether e-invoicing applies is the owner's decision, recorded in Settings. The question asked is whether turnover has been above Rs 5 crore in any year since 2017-18, because a business that dipped below can still be covered. The threshold lives in configuration and is not hard-coded.

### Returns data
- **GSTR-1 JSON** for a month: B2B, B2CL, B2CS, credit and debit notes (registered and unregistered), nil and exempt supplies, HSN summary, and the document series summary. Kora proves that the sections add up to the sales ledger to the paisa and warns if they do not.
- **GST summary** laid out like GSTR-3B table 3.1 (outward supplies), net of credit notes, with reverse-charge, nil-rated and exempt supplies shown apart.
- Both are **data to prepare a return**. Aggregate turnover is left at 0 in the GSTR-1 file for the owner to enter.

### Records
- Every change to records is written to an append-only audit log with who made it and when. The application role cannot update or delete it.
- Money, GSTINs and totals are validated by the database as well as the application.

## What Kora does not do

- **It does not file returns.** GSTR-1, GSTR-3B and annual returns are filed by the owner or their CA on the GST portal.
- **No purchases or input tax credit.** Kora v1 records sales only, so the GST summary excludes ITC and inward supplies, and nothing is reconciled against GSTR-2B.
- **No e-way bills.** Planned for v1.5.
- **No exports, SEZ supplies or deemed exports.** Place of supply 96 is refused with a message.
- **No reverse-charge e-invoices.** An invoice marked as reverse charge cannot be registered as an e-invoice yet; Kora says so rather than guessing.
- **E-invoice is B2B only.** Sales to unregistered buyers are not sent to the portal, and sales to composition dealers are not treated differently.
- **No rate or HSN suggestions.** The rate list is a starting set and must be confirmed.
- **No guarantee about the partner or portal.** Kora depends on a GST partner. Its availability, fees and error codes are outside Kora's control.

## What a CA must confirm before beta

1. The GST rate list seeded in the database, and whether rates such as 0.25%, 3% and 40% apply to the items customers will invoice.
2. The HSN length rule: today, a tax invoice for a business above Rs 5 crore needs at least 6 digits (blocked), and below that at least 4 digits (a warning).
3. How nil-rated, exempt and non-GST supplies should appear. Today every 0% line in a tax invoice is reported as nil-rated, and every bill of supply as exempt.
4. The GSTR-1 JSON structure against the current GST offline utility, including the section and field names.
5. TCS applicability and rates, and how TDS deductions should be recorded.
6. The partner's error codes. Kora's plain-words messages are keyed to the mock partner's codes and must be mapped to the real partner's list.
7. Whether reverse-charge outward supplies need an e-invoice and how.

## Data protection

Kora stores customers' names, GSTINs, addresses, phone numbers and emails on behalf of businesses. Under India's data protection law the business is generally the data fiduciary, and Kora a processor. Before launch, a lawyer should confirm: consent and notice for customer data, the retention rule (issued invoices must be kept for the statutory period, so they are never auto-deleted), breach notification, and data residency (host in India).

## Security controls that support compliance

- Tenant isolation is enforced by row-level security, and a removed member's access ends at the database, not only in the app.
- Sign-in is by one-time code with rate limits, single-use codes, and HMAC-hashed storage. No passwords exist to leak. The portal password of a taxpayer is never requested or stored.
- Webhooks are verified by signature on the raw body and are idempotent by event id.
- The public invoice link holds only a hash of its token, can be revoked, and returns nothing but the one document.
- Spreadsheet exports neutralise cells that would run as formulas.
