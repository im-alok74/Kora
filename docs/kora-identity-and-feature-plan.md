# Kora identity and next feature pass

23 October 2026. Local work; no deployment requested.

## Identity direction implemented first

The folded-K concept was rejected by the user. The active direction is a product symbol: a folded invoice with three ledger lines and a payment-status dot. The symbol contains no letter; a separate Kora wordmark identifies the brand. Loading draws the lines, then reveals the payment dot. Header/sidebar motion runs once. Reduced motion disables animation. Favicons and install icons use the same invoice symbol.

## Requested feature coverage from the supplied screenshot

This is the user's requested scope, not a verified claim of complete parity.

- Getting started / business onboarding.
- Dashboard: current receivables, overdue ageing, sales versus expenses and reporting period selection.
- Items and customers.
- Separate navigation for quotations, delivery challans and invoices.
- Payments received and receipts.
- Expenses.
- Projects and timesheets.
- Reports and a directly accessible template library.
- Global new-document action, search, notifications, settings and help.
- Time tracking and timer access.

Next pass: map each entry to Kora's existing screens/services, identify missing workflows, then implement the gaps. Do not duplicate existing document/payment engines simply to add navigation entries. Native desktop packaging is a separate deliverable; a desktop screenshot does not establish that Kora already has a native app.

## Carry-forward QA

The quotation metadata preservation fix passed 33 core tests. Four baseline browser flows passed. The new combined quotation-to-payment test reached the editor and found selected-navigation contrast below AA; that colour was corrected. Its final rerun was blocked on 22 October by automatic approval review's usage limit. Do not report the combined journey or signup check as passed until rerun.
