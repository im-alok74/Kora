# Night 2: money in, money out, and the people involved

Branch: night-2. Migration range: 0120 to 0129. Worktree: ../kora-night-2.

## Tasks

- [x] 1. Study Zoho Invoice and two other products, write gap list
- [ ] 2. MSME 45-day payment-due warnings on vendor bills, Udyam flag on vendor
- [ ] 3. TDS payable: record TDS on vendor payments, report by vendor and section
- [ ] 4. Automatic reminders: schedules per customer, stop when paid, preview, history (mock messenger)
- [ ] 5. Customer portal: code login, invoices and quotes, bulk pay, statement PDF, quote comment/approve, PO attach
- [ ] 6. Payment links and receipts: partial payments, refunds, payment history, paid-state timeline
- [ ] 7. Customer and vendor pages: contacts, notes, tags, credit limit, opening balance, merge, import/export
- [ ] 8. Expenses: categories, receipt upload, billable to invoice, recurring, mileage
- [ ] 9. Reports: sales by customer/item/month, ageing both ways, GST summary, P&L, ranges, saved views, CSV/Excel, print
- [ ] 10. Dashboard: owed, due this week, cash in, top customers, one-click actions
- [ ] 11. Polish at 375px and dark mode

## Log

### 2026-10-22 Task 1: research and gap list

Sources read this session: Zoho Invoice public features page (heavy nav, little text), Refrens home page (accounting, invoicing, payments, expenses, vendors, bank reconciliation, AI helper), myBillBook home page (WhatsApp and SMS payment reminders with UPI links, shareable live ledgers, outstanding dues, AI bank reconciliation, daily cash flow and outstanding reports, Tally export, loyalty). Also the repo's earlier Zoho API inventory, `docs/zoho-invoice-feature-parity.md`. Ideas only, nothing copied.

Gap list for my area (what Kora has is in brackets):

1. MSME 45-day rule: no Udyam flag on vendors, no warning on bills (ROADMAP 6.5). Nobody in the Indian set shows this well; a clear win.
2. TDS payable: only TDS receivable report exists. No TDS cut on vendor payments, no section report.
3. Reminders: a reminder engine exists but there is no per-customer schedule (before, on, after due), no preview, no sent history, no auto-stop shown to the user (myBillBook sells this as a headline feature).
4. Portal: private link only. No code sign-in, no all-invoices view, no bulk pay, no statement PDF, no quote comment/PO attach (Zoho portal).
5. Payments: partials and refunds exist in the data; the invoice page lacks a payment history and a paid-state timeline.
6. Customers and vendors: contact persons exist (0033); notes, tags, credit limit, opening balance, merge duplicates, export are missing or partial.
7. Expenses: categories are free text, billable expenses do not become invoice lines, mileage is missing (recurring expenses exist, 0035).
8. Reports: limited set. Missing sales by customer/item/month, payables ageing, P&L, saved views, Excel export, print view.
9. Dashboard: thin. No money due this week, cash in this month, top customers, quick actions.
10. Other products also offer: loyalty points, online catalogue, WhatsApp campaigns. Out of scope for this area.

### Needs you

(nothing yet)
