# GST and money correctness audit

Audit date: 23 October 2026. Branch: `overnight-tax-audit`. Scope: `packages/tax`, the money paths of `packages/core`, `packages/pdf`, the GST returns, and the free tools in `apps/web`.

This is an engineering audit against the GST law as published, not legal or tax advice. Items marked **unverified** are where the source could not be read in full or the portal's own specification was not available; a practising CA must confirm them before the owner relies on them. The "Needs you" list at the end is for decisions only the owner can make.

## How to read this

Each row says what rule was checked, the result, the evidence, and what was done. Test names are in the files named at the top of each section. All money is bigint paise; no figure on the paths audited passes through floating point except where listed under "Floating point".

Results: **OK** (matches the rule), **Fixed** (was wrong, now right, with a test that failed first), **Gap** (not supported; documented, behaviour unchanged), **Decision** (a product call for the owner).

Sources read: CBIC Tax Information portal (CGST Act s34, IGST Act s10), GST Council Notification 12/2024-Central Tax, CBIC Notifications 9/2025-Integrated Tax (Rate) and the matching Central Tax (Rate) notification, Notification 78/2020-Central Tax (HSN), CBDT Circular 17/2020 (para 4.6.1).

## 1. Tax engine (`packages/tax`)

Tests: `packages/tax/test/audit-rates.test.ts`, `audit-invariants.test.ts`, plus the existing `cases.test.ts`, `property.test.ts`, `inclusive.test.ts`.

| Rule | Result | Evidence and notes |
|---|---|---|
| Rate slabs: 0, 0.25, 3, 5, 18 and 40 percent for supplies on or after 22 September 2025; 12 and 28 percent only before it (Notification 9/2025 Integrated Tax (Rate) and the Central Tax (Rate) equivalent) | **Fixed** | The engine accepted 12 and 28 for any date and had no date. New `allowedRatesOn(date)`, `RATE_REFORM_DATE`, and `supplyDate` on `DocumentInput`. Tests: `rate slabs depend on the date of supply` (9 cases). With no date the old behaviour holds (every slab ever used), so callers that do not know the date are unchanged. |
| A credit or debit note raised now for an invoice issued before the reform | **Fixed** | Must be allowed to carry the old rate. `build()` in `documents.ts` accepts the slabs of either the note's date or the invoice's date. Test: `lets a credit note raised now correct an invoice from before the reform`. |
| CGST equals SGST on every line | **OK** | `P2` property over 10,000 invoices. In-state tax-inclusive lines move an odd paisa into the taxable value to keep the halves equal (by design, see below). |
| Rounding: half up, per line, then summed; no float | **OK** | `roundHalfUp` is bigint only. `P7` checks each line's tax is within half a paisa of exact. The GST law does not prescribe line versus invoice rounding; per line is what the returns need because the HSN and rate tables sum lines. |
| Parts sum to the total (taxable, tax, TCS, adjustment, round-off), including reverse charge, inclusive prices and adjustments | **OK** | `audit-invariants`: `grand total = taxable + tax (unless reverse charge) + TCS + adjustment + round-off`, 5,000 random documents. |
| No negative or fractional paise | **OK** | Every figure is a bigint; only round-off and adjustment may be negative. |
| Order of lines does not change any total | **OK** | Property test (reverse and rotate). |
| No drift across many lines | **OK** | 200 identical lines are exactly 200 times one line. The tax on the pooled value differs from the sum of line taxes by under two paise a line (at most Rs 4 on a 200-line document); this is inherent in per-line rounding. |
| Tax-inclusive then exclusive round trip within one paisa | **OK with a stated limit** | Inter-state: within 1 paisa. In-state: up to 2 paise, because keeping CGST equal to SGST leaves an odd paisa in the taxable value and each half then rounds up when taxed again. The invoice itself is always self-consistent. |
| A tax-inclusive line is worth exactly quantity x rate less discount | **OK** | Property test over any rate, discount and cess. |
| Discount before tax; discount after tax | **OK** | Discount is deducted before tax; a later discount is a credit note (CGST Act s34). |
| Cess: ad valorem on taxable value; per-unit cess refused rather than ignored | **OK** | `specific_cess_unsupported`. Compensation cess was removed from most goods in 2025; the field remains for what is left. |
| Reverse charge: tax shown but not added to the payable total | **OK** | `P3`. E-invoices for reverse-charge supplies are refused with a clear message (Gap, see below). |
| Composition: bill of supply, no tax, no tax invoice or credit note | **OK** | `cases.test.ts`. |
| TDS the customer deducts is on the taxable value, excluding GST | **OK** | Matches CBDT Circular 23/2017. Test: `money-flows-audit` TDS case. |
| TCS base | **OK, unverified for the section** | Computed on taxable value plus tax. CBDT Circular 17/2020 para 4.6.1 says no adjustment for GST is made for TCS under s206C(1H), so the base including GST matches. I believe s206C(1H) was omitted from 1 April 2025 (Finance Act 2025); the field is a user-supplied rate, so it still serves the other TCS sections. Confirm with a CA. |
| Round-off to the nearest rupee, never below Rs 1 total | **OK** | `P3`, `TC31`. |
| HSN digits: 4 up to Rs 5 crore turnover, 6 above (Notification 78/2020-CT) | **OK** | `checkHsn` and the policy in `documents.ts`: above Rs 5 crore the invoice is refused, below it the user is warned (the notification requires the 4 digits on B2B invoices; B2C is not required, so a warning is the safe reading). |
| Invoice number: at most 16 characters; letters, digits, `/` and `-` (CGST Rule 46(b)) | **OK** | `validateInvoiceNumber` property tests; the database checks `length(prefix) + pad_width <= 16`. The e-invoice portal also refuses a number that starts with `/`, `-` or `0`; `DOC_NO` in `einvoice.ts` encodes that. |
| Financial-year series | **OK** | `ensureSeries` and `fy_label()`; the series restarts each 1 April. |
| GSTIN check digit and state code | **OK** | Property test: a built GSTIN is valid, and changing any one character makes it invalid. `gstinValid` does not check the state code against the list (a code such as 25 or 28 passes the pattern). The database function mirrors it and a test compares the two, so changing only the TypeScript would break that test; left as is (see Remains). |
| Place of supply, goods: delivery state, else bill-to state (IGST Act s10(1)(a)) | **OK** | `resolvePlaceOfSupply`. |
| Place of supply, services: recipient's registered state, else the address state, else the supplier's state (s12(2)) | **OK** for the default case | The exceptions in s12(3) to s12(14) (immovable property, events, transport and so on) are not modelled (Gap). |
| An explicit place of supply typed or sent to the API | **Fixed** | Any text was accepted (including `00`, `99` and `96`), so a tax invoice could carry IGST for "another country" and go to the returns as an ordinary inter-state sale. Now it must be a real state or territory code; `96` is refused on a rupee document because exports are not supported. Test: `an explicit place of supply is checked the same way as a derived one` (also checks `constructor` and `__proto__`). |
| Union territories without a legislature charge UTGST, not SGST (UTGST Act s8; CGST Rule 46 asks for each tax by name) | **Fixed** (labels) | Chandigarh 04, Ladakh 38, Lakshadweep 31, Andaman and Nicobar 35, Dadra and Nagar Haveli and Daman and Diu 26. The invoice and bill printed "SGST". The PDF now prints "UTGST" for a supplier in those five. Delhi, Puducherry and Jammu and Kashmir keep SGST. Amounts are unchanged; the return files carry the same field. Tests in `packages/pdf/test/render.test.ts`. |
| Bill to ship to (s10(1)(b)) | **Gap, Decision** | Kora treats the ship-to address as another address of the same buyer (s10(1)(a)). When the goods go to a third person on the buyer's direction, the place of supply for the invoice to the buyer is the buyer's principal place of business, not the ship-to state. There is no field for that case. See Needs you. |
| SEZ, export, deemed export | **Gap, Decision** | `96` is refused and there is no SEZ flag on a customer. A supply to an SEZ unit is inter-state even inside the same state (s7(5)(b)); today a same-state SEZ customer would be charged CGST and SGST. |

## 2. Credit and debit notes (CGST Act s34)

Tests: `tax-audit.test.ts` (`a credit or debit note belongs to the invoice it corrects`, `a credit note copied from a tax-inclusive line...`), existing `credit.test.ts`.

| Rule | Result | Evidence and notes |
|---|---|---|
| A credit note cannot take back more taxable value than the invoice holds | **OK** | `assertCreditWithinOriginal`, checked at save and again at issue. |
| A note goes to the customer of the invoice and cannot predate it | **Fixed** | Neither was checked. Now refused with a clear message. A note started from an invoice that is dated in the future starts on the invoice date instead of today (`startNote`). |
| Copy of a tax-inclusive line with a discount | **Fixed** | The database stores an inclusive line's discount without tax, but the editor takes it with tax. A credit note started from such an invoice took back more than was invoiced and was refused at issue (`3 x Rs 118.00 with Rs 11.80 off`). `linesToInput` now works the discount back from the line total. Also fixes duplicate, convert and revise for those lines. |
| Time limit: the note must be declared by 30 November after the financial year, or the annual return date, whichever is earlier | **Gap, Decision** | Not enforced (s34(2)). |
| Credit note for a walk-in (no customer) sale | **Gap, Decision** | `build()` demands a customer for credit and debit notes, so a point-of-sale sale to an unnamed buyer cannot be credited, and GSTR-1 has a place for it (cdnur). |

## 3. E-invoice and e-way bill

Tests: `tax-audit.test.ts` (`an e-invoice carries a manual adjustment`), existing `einvoice.test.ts` and `ewaybill.test.ts`.

| Rule | Result | Evidence and notes |
|---|---|---|
| Invoice value equals the sum of item values plus other charges, less discount, plus round-off | **Fixed** | A manual adjustment (Rs 10,000 up or down, untaxed) is part of the total but belongs to no item, so the check "invoice total equals the sum of its lines" failed and an adjusted invoice could never be e-invoiced. A deduction now goes in the invoice-level `Discount`, an addition in `OthChrg`. The mock partner's check now subtracts `Discount` too. **Unverified against the portal's own validation**: the portal's rule is described as `TotInvVal = AssVal + taxes + OthChrg - Discount + RndOffAmt`; I could not open the IRP schema document to confirm it. |
| Number format accepted by the portal | **OK** | `DOC_NO`. |
| Threshold and time limit | **Gap, Decision** | The e-invoice switch is a setting; the turnover threshold and the 30-day reporting window for larger taxpayers are not checked. |
| E-way bill when consignment value is more than Rs 50,000 | **OK** | `ewayAdvice`. Services (SAC starting 99) are excluded. |

## 4. GSTR-1 and GSTR-3B (`packages/core/src/gstr.ts`)

Tests: `tax-audit.test.ts` (`GSTR-1 B2C large threshold`, `GSTR-1 and GSTR-3B reconcile to the sales register to the paisa`), existing `gstr.test.ts`.

| Rule | Result | Evidence and notes |
|---|---|---|
| B2C large (B2CL): an inter-state invoice to an unregistered buyer is reported by invoice only if its value is MORE than Rs 1 lakh from 1 August 2024 (Notification 12/2024-CT, 10 July 2024); Rs 2.5 lakh before | **Fixed** | The code used Rs 2.5 lakh for every date, so every invoice between Rs 1 lakh and Rs 2.5 lakh was filed as consolidated B2CS instead of B2CL from August 2024. Tests: exactly Rs 1,00,000.00 is B2CS, Rs 1,00,001 is B2CL; July 2024 keeps the old limit. |
| Totals reconcile to the sales ledger to the paisa | **OK** | New test builds a month with registered, unregistered, reverse charge, nil-rated, exempt, credit and debit notes. Taxable value in the GST summary (taxable + reverse charge + nil + exempt) equals the sales register; tax by head in GSTR-1's sections equals the register; the GSTR-3B liability equals the register's tax less the tax the recipient pays under reverse charge. |
| The reconciliation inside GSTR-1 | **Fixed** | It converted rupee figures back to paise by multiplying a float by 100. Now by text. |
| The GST summary note about purchases | **Fixed** (text) | It said Kora records no purchases; it does. The note now points at the GSTR-3B data. `docs/compliance.md` line 80 is similarly stale and belongs to the docs session. |
| HSN table (Table 12) | **Gap** | From May 2025 the portal splits it into B2B and B2C tables and requires 4 or 6 digits by turnover; Kora files one table and does not net credit notes. Field names for GSTR-1 and GSTR-3B JSON were not checked against the current offline utility (the code already says so). |
| Bill of supply reported as exempt | **Decision** | A composition dealer files CMP-08 and GSTR-4, not GSTR-1. |

## 5. Money flows

Tests: `packages/core/test/money-flows-audit.test.ts`, existing `credit.test.ts`, `writeoff.test.ts`, `latefee.test.ts`, `statements.test.ts`.

| Flow | Result | Evidence and notes |
|---|---|---|
| Part payments settle to the paisa and one more is refused | **OK** | `three part payments settle an invoice`. |
| Overpayment | **OK** | Refused by the application and by the database guard `allocation_guard`. |
| Two payments at once for the last of an invoice | **OK** | `for update` on the document. Exactly one succeeds. |
| Two invoices of one customer applying the same advance at once | **Fixed** | One of them hit the database guard and the caller saw a raw error. `applyCredit` now locks the customer first, so the second sees what is left. |
| Payment on a written-off invoice | **Fixed** | The write-off removes the invoice from receivables and puts the bad debt on the statement; a payment on top would count the money twice and drive the customer's balance negative. Now refused with "cancel the write-off first". Test: `a written-off invoice and money that turns up afterwards`. A gateway payment cannot be refused (the money has arrived) and is still recorded; see Remains. |
| TDS deducted by the customer | **OK** | Recorded as its own payment of method `tds`; the invoice is paid when both arrive. |
| Customer statement | **OK** | Property: opening + billed - credited = closing, with payments, TDS, an advance, a refund of it and a write-off. |
| Late fee arithmetic | **OK** | Percentage per 30 days pro rata by the day, half up; no day is charged twice. |
| Late fee GST rate | **Fixed** | Accepted anything up to 28 percent, including rates that are not slabs (10 percent, 12 percent); the draft debit note then failed. Now must be a slab in force today. |
| Foreign-currency quote turned into a rupee invoice | **Fixed** | The unit rate was converted to whole paise and multiplied by the quantity, so 1,000 units at USD 0.01 and 83.25 became Rs 830.00 instead of Rs 832.50. The taxable value of each line is now converted once, half up, from the quote's own taxable value. A rate that converts to whole paise is kept; otherwise the line becomes one unit of the converted amount with the original quantity and price in the description. Tests: `a quote in another currency becomes a rupee invoice without losing paise`. |

## 6. Floating point and formatting

Everything shown on an invoice, a receipt, a statement, a GST return and a free tool is formatted from bigint paise (`formatRupees`, `formatMoney`, `money()` in the PDF renderer). A search for `toFixed`, `parseFloat`, `* 100` and `Number(` over `packages` and `apps/web` found these remaining uses; none changes a stored or printed amount:

- E-invoice `Qty` and the unit price of a tax-inclusive line are JSON numbers computed in floating point (`einvoice.ts`). The totals are bigint and are what the portal checks.
- GSTR-1 HSN quantity is a JavaScript number (a quantity, not money).
- A few screens pre-fill a refund amount with `(Number(paise) / 100).toFixed(2)`. The values are below 2^53, so the result is exact; the field is then parsed back to paise as text.
- Importers read a GST percentage with `parseFloat` and multiply by 100 (`0.25` and `1.5` are exact in binary at two decimals); the result is checked against the slab list.
- The GSTR-2B import converted rupee numbers to paise with `Math.round(n * 100)`; now text-based (`purchases.ts`).
- A bill created from a GSTR-2B line stores a tax rate inferred from tax divided by taxable value, which can come out as 1799 or 1801 instead of 1800 (only the display rate; the amounts are the portal's). Remains.

## 7. Free tools (`apps/web`)

Tests: `apps/web/test/tools-audit.test.ts`.

- The GST calculator calls the same `computeDocument` as an invoice (`apps/web/lib/gstCalc.ts`). Hand-worked table of nine cases and a sweep over every slab, amount, mode and supply type agrees with a one-line invoice.
- The document maker (`DocGenerator.tsx`) offered 0, 5, 12, 18 and 28 percent for any date. It now offers the slabs for the document date, keeps a rate already on a line visible, and passes the date to the engine, so a quote dated today cannot carry 12 or 28 percent.
- The invoice editor, the item screen and the recurring screen use the same list (`taxRatesFor` in `lib/client.ts`). The offline totals pass the document date to the engine.

## 8. What remains (not fixed, not a product call)

- `gstinValid` does not check the state code against the list; the database mirror would have to change with it (needs a migration, not made).
- A gateway payment for a written-off invoice is recorded without cancelling the write-off.
- A late-fee debit note that was cancelled still counts as a charge for the "already charged" test: unverified, no test written.
- Credit notes are not netted out of the HSN summary.
- The GSTR-2B inferred display rate (section 6).
- `docs/compliance.md` still says Kora has no purchases or input tax credit.

## 9. Needs you

Decisions that only the owner can make. None of them changes behaviour in this pull request.

1. **Rejecting 12 and 28 percent.** This pull request refuses them for supplies dated on or after 22 September 2025. Items saved at 12 percent keep that rate and are marked "not valid on this date" in the editor until changed. Existing recurring invoices at those rates will fail on their next run with a clear note in the run log. Say if you would rather warn than refuse.
2. **Exports, SEZ and deemed exports.** Not supported: no LUT, no export of services, no SEZ customer flag. A same-state SEZ customer is wrongly charged CGST and SGST today. Needs a customer registration type and a decision on which return sections to build.
3. **Bill to ship to.** Only the case where the ship-to address is the buyer's own is handled. The three-party case needs a consignee field.
4. **Untaxed positive adjustment.** The "adjustment" (up to Rs 10,000) is added to the total without tax. An addition for packing, freight or similar is part of the value of supply (CGST Act s15(2)) and would normally be taxed. Consider allowing only deductions, or taxing additions.
5. **Credit and debit note time limit** (s34(2)) and **credit notes for walk-in sales**.
6. **E-invoice** threshold, the 30-day reporting limit for larger taxpayers, and **composition** dealers making inter-state supplies of goods (not allowed by s10(2) CGST).
7. **GSTR-1 HSN table** split and **file layouts** to be checked against the current offline utility by a CA.
8. **Commit trailer.** The brief asked for `Co-Authored-By: Claude Opus 5`; the model that did this work was Claude Sonnet 5.5 and the trailers say so. Rewrite them if you prefer the other.
