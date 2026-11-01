# Claims sheet

Every product statement in the carousels and videos, and where in the repository it is true. If the code changes, change the post. If a claim is not on this list, do not post it.

| Claim in the content | Source in the repository |
|---|---|
| 12% and 28% are retired for supplies on or after 22 September 2025; slabs are 0, 0.25, 3, 5, 18, 40 | `packages/tax/src/rules.ts` (`RATE_REFORM_DATE`, `SLABS_FROM`); `docs/gst-audit.md` rate slabs row cites Notification 9/2025 (Integrated Tax (Rate)) |
| Earlier supplies can still carry 12% or 28% | same, `SLABS_BEFORE` |
| Old items show "not valid on this date" | `apps/web/lib/client.ts` `taxRatesFor` |
| A credit note for an invoice issued before the change may carry the old rate | `packages/core/src/documents.ts` (`allowedRateBp` for notes), `docs/gst-audit.md` |
| A repeating invoice copies the rate saved with it | `packages/core/src/recurring.ts` (profile payload) |
| Tax from the place of supply, CGST+SGST same state, IGST otherwise | `packages/tax/src/compute.ts`, `packages/tax/src/rules.ts` (`resolvePlaceOfSupply`) |
| Totals in whole paise; tax rounded per line and summed | `packages/tax/src/compute.ts` header comment; property tests in `packages/tax/test` |
| Invoice numbers in sequence per financial year, 16 characters at most | `packages/tax/src/rules.ts` `validateInvoiceNumber`; numbering under a row lock in `packages/db/migrations/0001_init.sql` |
| An issued invoice and the activity log cannot be edited or deleted; fix with credit and debit notes | `document_guard` trigger (`0001_init.sql`), landing FAQ |
| Kora checks the HSN rule for the turnover band | `packages/core/src/documents.ts` `hsnPolicy` |
| A UPI QR with the amount still due on every invoice | `packages/pdf/src/upi.ts` `upiBlockFor`; landing page |
| A link you can share | pricing page feature list |
| GSTR-1 data and the GST summary match the sales register to the paisa; Kora prepares data, you and your CA file | `packages/core/test/tax-audit.test.ts` ("reconcile to the sales register"); landing FAQ "Does Kora file my GST returns? No." |
| 17 free tools, no sign-up, run in the browser, nothing typed is uploaded | `apps/web/lib/tools.ts`; privacy notice; `docs/audit-2026-10.md` section B "Keep this" |
| GSTIN check reads format and check digit only | `packages/tax/src/gstin.ts` (does not query the GST portal) |
| Start free: 10 invoices and quotes a month, no card | `packages/core/src/plans.ts` (`PLANS.starter`); the free plan has no payment step |
| Firm view: every client on one screen, an inbox, purchases against GSTR-2B | landing "CA firms" segment; `docs/gst-audit.md` and the firm screens |
| Kora is in early access | landing hero |

## Deliberately not claimed

- E-invoicing, e-way bills: no live GST partner yet (launch checklist row 7).
- Sending on WhatsApp, SMS or email, scheduled reminders: needs the worker or the 5-minute tick and a live provider test (launch checklist rows 1 and 4).
- Any price other than "10 invoices and quotes a month free". Prices are placeholders.
- Customer counts, testimonials, savings, "trusted by", rankings, comparisons with named products.
- Filing GST returns.
