# GST decisions for the owner and a CA

These are the points from the October 2026 audit (`docs/audit-2026-10.md`, findings C-2 to C-5, C-8, C-9) that code cannot settle. Each has the options and a recommendation. Nothing here changes behaviour until you choose. Marked **unverified** where I could not confirm a rule from a primary source; have a CA confirm before acting.

## C-2 Exports and SEZ
Today: place of supply `96` (other country) is refused, a customer has no SEZ flag, and e-invoice supply type is always `B2B`. A SEZ unit in your own state is charged CGST and SGST, though IGST applies (IGST Act s7(5)(b)).
- **A. Out of scope for now.** Say so in onboarding and on the help page. No code.
- **B. SEZ only.** Use the existing `sez` registration type on the customer, force IGST, set e-invoice supply type to `SEZWP`/`SEZWOP`. Small.
- **C. Full exports.** B plus an export document type, LUT or bond handling, shipping bill fields, GSTR-1 table 6A. Large.
- **Recommendation:** A at launch, B next, C only when a customer asks.

## C-3 Bill-to and ship-to different parties
Today the ship-to state is always treated as the buyer's own (s10(1)(a)). For goods delivered to a third party on the buyer's direction, s10(1)(b) makes the bill-to state the place of supply.
- **A. Warn** when ship-to state differs from bill-to, and let the user pick which rule applies.
- **B. Model a consignee** on the document and apply s10(1)(b).
- **Recommendation:** A now (small), B when e-invoice is live, because the portal asks for both parties.

## C-4 Untaxed manual adjustment
The adjustment (up to Rs 10,000 either way) is added to the total without tax. A positive amount for packing or freight is part of the value of supply (CGST s15(2)) and would normally be taxed.
- **A. Deductions only.** Reject a positive adjustment; use a line item for charges.
- **B. Keep as is** and label it "round-off or goodwill, not for charges".
- **Recommendation:** A. It is the smaller change and removes the risk.

## C-5 Credit and debit notes: time limit and walk-in sales
(1) s34(2) limits a credit note's tax adjustment to 30 November after the financial year, or the annual return date, if earlier. Not enforced. (2) A credit or debit note needs a customer, so a counter sale to an unnamed buyer cannot be credited (GSTR-1 has `cdnur` for that).
- **For (1):** warn past the date, do not block (the user may have a valid reason). Recommended.
- **For (2):** allow a party-less note when the original has no party. Recommended.

## C-8 E-invoice applicability and reporting window
Today a switch decides it; the column `einvoice_threshold_paise` exists and nothing reads it, and old documents are not checked against the reporting window for larger taxpayers. **Unverified:** the exact window per turnover band; a CA should confirm.
- **A. Keep the switch**, add a plain message when the portal rejects a stale document.
- **B. Read the threshold** against the business's turnover and warn when a registration is due.
- **Recommendation:** A with the message now, B once a GST partner is chosen.

## C-9 GSTR-1 and GSTR-3B file layouts
The JSON field names are written from knowledge, not checked against the current offline utility, and the HSN table is one table (the portal splits B2B and B2C from May 2025, with 4 or 6 digit rules). Returns are prepared data, not filed, so the risk is a rejected upload.
- **Action:** a CA runs one real month through the offline tool and reports differences; then split the HSN table. Until then the downloads are labelled early access.

## TCS under section 206C(1H)
CBDT Circular 17/2020 para 4.6.1 says no GST adjustment is made for this TCS. I believe 206C(1H) was omitted from 1 April 2025; **unverified**. The TCS field stays a user-entered rate until a CA confirms.

## Retired slabs
Today a rate that was valid before 22 September 2025 (12%, 28%) is refused on a later date. Alternative: warn instead of refusing. Recommendation: keep refusing; the editor already shows "(not valid on this date)".
