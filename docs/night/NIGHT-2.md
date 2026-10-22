# Night 2: money in, money out, and the people involved

Branch: night-2. Migration range: 0120 to 0129. Worktree: ../kora-night-2.

## Tasks

- [x] 1. Study Zoho Invoice and two other products, write gap list
- [x] 2. MSME 45-day payment-due warnings on vendor bills, Udyam flag on vendor
- [x] 3. TDS payable: record TDS on vendor payments, report by vendor and section
- [x] 4. Automatic reminders: schedules per customer, stop when paid, preview, history (mock messenger)
- [x] 5. Customer portal: code login, invoices and quotes, bulk pay, statement PDF, quote comment/approve, PO attach
- [x] 6. Payment links and receipts: partial payments, refunds, payment history, paid-state timeline
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

### 2026-10-22 Tasks 2 to 6 (done, pushed on night-2)

- 2 MSME: migration 0120 (party.udyam_number, msme_class). `msme.ts`, warning chip on the bills list, banner on the bill, Vendors page (new) with the Udyam fields and a "pay these on time" panel. The wording about interest and tax deduction is general and says to check with the CA.
- 3 TDS payable: 0121 (purchase_payment.tds_paise, tds_section). The bill is settled by cash plus tax held back. Report "TDS payable" by vendor and section with deposit dates (7th of next month, 30 April for March). Rates are not built in: the CA decides, the user types the amount.
- 4 Reminders: 0122 (party.reminder_override). Per customer schedule, replanning of open invoices, preview, history, Reminders tab. Stops when paid (existing trigger). Mock messenger only.
- 5 Portal: 0123 (code_login, portal_code, portal_session, portal_comment, payment_link_item, document_file.from_customer). Code sign-in with cookie session, bulk pay (one link, money spread oldest first in applyGatewayEvent), statement PDF with ageing, comments, PO upload, Portal tab for staff. Found and fixed while testing: wrong code guesses were rolled back with the transaction, so the five-guess limit did nothing.
- 6 Payments: timeline of every payment, refund and write-off on the invoice with the balance after each; refund against an invoice payment (frees the allocation, then records the refund). Small edit outside my area: `invoices/[id]/page.tsx` renders the new timeline component.

### Notes for the next person

- Python on this Windows box reads files as cp1252 unless PYTHONUTF8=1.
- The Bash tool chokes on long commands with apostrophes inside heredocs; write files with the editor tool.
- Docker Desktop died once under load from four chats; restart it and run `pnpm db:up`.

### Needs you

(nothing yet)
