# Kora quotation-to-payment verification

Date: 22 October 2026. Local test data and mock integrations only.

## Scope

A service quotation for two design sessions at Rs 2,500 each plus 18% GST: Rs 5,900 total. Accept the quotation, convert it into an invoice, preserve its commercial details, issue, download a PDF, receive Rs 2,000, download the payment receipt, then receive Rs 3,900 and verify that the settled state survives reload.

## Cases

| Case | Check | Evidence |
| --- | --- | --- |
| QP-H1 | Acceptance and conversion produce one editable invoice with identical totals | Existing estimates-recurring browser test |
| QP-H2 | PO, subject, salesperson, custom fields and payment terms survive conversion | New core regression test and quote-to-payment browser test |
| QP-H3 | Invoice due date is recalculated from payment terms, not copied from quotation expiry | New core regression test |
| QP-H4 | PDF and payment receipts return real PDF bytes | quote-to-payment browser test |
| QP-H5 | Partial payment leaves Rs 3,900; final payment closes the invoice | quote-to-payment and collections browser tests |
| QP-E1 | Repeated conversion returns the existing invoice | Core and existing conversion browser tests |
| QP-E2 | Reload preserves paid state and both receipts | quote-to-payment browser test |
| QP-N1 | Expired quotation cannot be accepted or converted | Existing expiry browser test |
| QP-N2 | Overpayment is refused without changing balance | Existing collections browser test |
| QP-A1 | Editor and invoice detail have no WCAG A/AA axe violations | quote-to-payment browser test |

## Reproduced defect

**QP-001 — S2: Conversion drops quotation details.**

Steps: issue a quotation containing PO-402, Website refresh, salesperson Asha, Project WEB-26 and net30 payment terms; convert to invoice; inspect the generated draft.

Expected: these details survive and the invoice due date follows its own date plus 30 days.

Actual before fix: reference, subject, salesperson, extra and payment_terms all became null. The regression test reproduced all five missing values.

Fix: explicitly select and copy these fields in `packages/core/src/estimates.ts`. Do not copy the quotation expiry date. Existing invoice validation computes the invoice due date. The source quotation stays unchanged. Local changes are uncommitted.

Verification: 33 core tests pass across estimates/recurring, currency and TDS/TCS. Four baseline browser checks pass: quotation acceptance/conversion, expired quotation rejection, partial/overpayment, public invoice and PDF. Combined journey result is recorded below after execution.

## Limits

Mock services establish application behaviour, not live gateway settlement or real email/WhatsApp delivery. This pass does not certify every paper/printer combination, every language, screen-reader behaviour or the full signup flow.
