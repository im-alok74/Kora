# Kora roadmap: everything still pending against the invoicing market

Date: 20 October 2026. Built from `comparison.md` (Zoho, one to one), `market-comparison.md` (MyBillBook, Vyapar, SAG Infotech, Refrens, QuickBooks, FreshBooks, Invoice Ninja and the shared UI patterns), `features.csv`, `complaints.md` and the code as it stands. Tick a box only when the item is built, tested and in the repository. Each phase says what it needs from you, if anything.

How to read it: **Size** S is under a day, M a few days, L a week or more. **Seen in** names the competitor that has it today. **Blocked by** is set only when code alone cannot finish the item.

## Already done (so no one rebuilds it)

Documents of every type, gapless numbering, sealed issued documents, tax engine with inclusive prices, e-invoice with a mock partner, GSTR-1 and 3B, purchases with input credit and GSTR-2B matching, stock, till and thermal receipts, four languages, CA firm screens, lawyer matters and trust money, freelancer projects, the Kora network, MFA, search, notifications, dark theme, bulk actions, customer pages, a public API with webhooks, offline drafts, backups, jobs admin, and from this week: the invoice document redesign, editor item table, detail page with money strip and timeline, documents list with due and balance, order or PO number, subject, payment terms, discount on the whole bill, shipping helper, duplicate as draft.

---

## Phase 1: finish the invoice screen (code only)

The screen people use all day. After this phase it has every field Zoho's invoice form has, plus a live preview none of the Indian shop apps have.

- [x] 1.1 Default notes and terms per business, prefilled on every new document (Zoho, MyBillBook). S
- [x] 1.2 Extra details on a document: up to five label and value pairs, printed under the meta strip (Zoho custom fields, in the form that needs no setup). M
- [x] 1.3 Live paper preview beside the editor, refreshed as you type, from the same renderer as the PDF (Zoho, Refrens). M
- [x] 1.4 Salesperson on a document, from the team list (Zoho). S
- [x] 1.5 Files attached to a document, for the team (Zoho). M. Showing them to the customer on the public page moves to 7.2, because it needs its own access rule

## Phase 2: money in, completely (code only)

- [x] 2.1 Pay at the counter: tick "The customer has paid in full" when issuing; the payment is recorded in the same step and the invoice carries a PAID mark (Zoho sales receipts, Vyapar). M
- [ ] 2.2 Receipt voucher for an advance on services, which GST requires when the money is received (Zoho retainer invoices). M, **a CA must confirm the wording and tax treatment first**. Advances themselves are done (2.3)
- [x] 2.3 Customer credit: an advance or overpayment held on the customer and applied to an invoice in one click (Zoho, QuickBooks). M
- [x] 2.4 Refund of money held for a customer, guarded in the database so it can never be applied and refunded twice (Zoho). S
- [x] 2.5 Bank statement upload (CSV) with suggested matches to open invoices and bills, recorded on confirmation, never twice (Vyapar, QuickBooks). L. Page: Bank
- [ ] 2.6 A second gateway adapter, Cashfree, behind the same interface (Zoho, Vyapar). M, **needs Cashfree's API documentation and test keys: the request and webhook signing formats must come from their documents, not from memory**
- [ ] 2.7 Billable expenses that turn into invoice lines (Zoho). S, **needs a CA decision first: re-billed costs are taxed differently as a pure agent's reimbursement than as part of the supply**

## Phase 3: lists and workspace (code only)

- [x] 3.1 Saved views on the documents list: filters, sort and columns remembered by name, on this device (Zoho, QuickBooks). M. Views follow the browser, not the account
- [x] 3.2 Column chooser on the documents list (Zoho). S. Customers and items are short lists and keep their fixed columns
- [x] 3.3 Keyboard shortcuts: n for a new invoice, g then a letter to go to a page, ? for the help sheet, with a help button in the top bar (Zoho, QuickBooks). S
- [ ] 3.4 In-app help: a short guided tour on first sign-in (Zoho, FreshBooks). M. The help sheet with shortcuts and where things are is done; the tour is not
- [x] 3.5 Notes on a document, visible to the team only, removable by the writer or an owner (Zoho, QuickBooks). M
- [x] 3.6 Export the list you are looking at to a spreadsheet-safe CSV, from documents, customers and items (all). S

## Phase 4: templates, languages and messages (code only)

- [x] 4.1 Template gallery with live samples in the business's own colour and details: Classic, Modern, Minimal, Compact, Professional fees; thermal stays a per-document choice (Zoho, Ninja, Vyapar). M
- [ ] 4.2 More fixed-word languages: Tamil, Telugu, Kannada, Bengali, Malayalam, Punjabi (Zoho 10+). M, **needs a native reader's review of every word, and the Noto fonts for those scripts added to the container image (the image installs no extra fonts today)**
- [x] 4.3 Editable message wording for invoices and reminders, with placeholders, a live preview and a reset to Kora's wording (Zoho, MyBillBook). M. Live WhatsApp still needs an approved Meta template whose single variable carries this text
- [ ] 4.4 PDF attached to the email, not only a link (Zoho, FreshBooks). M, **the PDF builder (UPI QR, e-invoice block) lives in the web app; it must move to a shared package before the worker can attach it, and the Resend adapter needs attachment support**
- [x] 4.5 Receipt for a payment, as a PDF from the invoice page and the customer page (Zoho, QuickBooks). S

## Phase 5: moving in and out (code only)

- [x] 5.1 Excel (.xlsx) import for customers and items, with the same preview and checks as CSV; the reader caps size, parts and rows because the file is untrusted (Vyapar, MyBillBook). M
- [x] 5.2 Invoices from CSV or Excel as DRAFTS, with a dry run that checks each one and groups lines by reference; the old number is kept as the reference because Kora numbers a document only when it is issued; importing the same file twice makes nothing new (Zoho, Vyapar). L. Headings are recognised by name; there is no manual column-mapping screen
- [x] 5.3 Column names from Zoho Invoice, MyBillBook and Vyapar exports are recognised for customers and items, with two-letter state codes. The names come from those products' public templates and help pages and are not checked against a current real export, so a changed heading shows as ignored and can be renamed (all). M
- [x] 5.4 Customers from a Tally ledger export (Sundry Debtors only), to complement the Tally export (SAG, Tally). M. Not tried against a live Tally file; the XML tags follow Tally's documented master format
- [x] 5.5 Statement of account per customer, as CSV, from the customer page (all). S

## Phase 6: compliance that does not need a live partner (code only)

- [x] 6.1 E-way bill: data, validation, the JSON the portal accepts, and a mock partner path, with the same retry and plain-words errors as e-invoice (MyBillBook, SAG). M Done: check, generate and cancel through the mock partner, validity shown, portal JSON download. Not checked against the live portal; extending validity is not built.
- [ ] 6.2 Export invoices under LUT and SEZ supplies, with a rate on the invoice and tax shown in rupees (Zoho, SAG). L Open: needs a CA to confirm GSTR-1 table 6A and the e-invoice export fields.
- [ ] 6.3 GSTR-9 annual summary data (SAG). M Open: needs a CA to confirm the table layout.
- [x] 6.4 TDS receivable and TDS payable reports (Zoho, SAG). S Done for TDS receivable (Reports, TDS deducted, with CSV). TDS payable not built: Kora does not yet record TDS cut from vendor payments.
- [ ] 6.5 MSME payment-due warnings on vendor bills (Zoho). S Open: needs a party Udyam flag and migration, next up.

## Phase 7: portal and customer accounts (code only)

- [ ] 7.1 Optional customer sign-in with a one-time code on top of the private link (Zoho portal). M
- [ ] 7.2 Customers can comment on an estimate and attach a purchase order (Zoho portal). M
- [ ] 7.3 Bulk pay: a customer pays several invoices in one go (Zoho portal). M
- [ ] 7.4 Statement of account as a PDF, with ageing (QuickBooks, Zoho). S

## Phase 8: platform and integrations (code only)

- [ ] 8.1 OAuth for the API, alongside keys (Zoho). L
- [ ] 8.2 A signed webhook event catalogue page and a test-send button (Zoho, Stripe). S
- [ ] 8.3 Installable mobile wrapper (Capacitor) around the existing app, store listing files ready (Zoho, MyBillBook). L
- [ ] 8.4 Public status page data and uptime check for the health route (Stripe). S

## Phase 9: needs you, not code

These cannot be finished by writing more software. Each is listed so nothing waits unseen.

- [ ] 9.1 Apply migrations 0021 to 0024 to the hosted database and push the repository. **Needs the database password.**
- [ ] 9.2 Live GST partner: sign with a GSP, give credentials, switch the adapter. Unlocks real IRN and e-way bill.
- [ ] 9.3 Live WhatsApp (Meta Cloud API), SMS sender (MSG91, DLT registration) and email (Resend) keys.
- [ ] 9.4 Live Razorpay keys and webhook secret; Cashfree if wanted.
- [ ] 9.5 Upstash, object storage, Sentry and `CRON_SECRET` set on the host; `DEMO_FIXED_OTP` unset for real customers.
- [ ] 9.6 Decide pricing, then add the pricing section to the landing page; real testimonials only when they exist.
- [ ] 9.7 A lawyer reads the Terms and Privacy pages; a CA signs off `tax-cases.md` and the GST outputs.
- [ ] 9.8 Decide the data region (the hosted database is in Sydney) and the support and grievance addresses.
- [ ] 9.9 Decide whether the recent colour change (purple) stays; commit or revert it.
- [ ] 9.10 Native-language review of every translated word before it ships.

---

## Order of work and why

Phase 1 first because it is the screen every customer judges the product on. Phases 2 and 3 next: they are what a daily user hits after the first week. Phases 4 and 5 remove the reasons to stay on the old software (templates, languages, migration). Phase 6 builds everything for compliance that can be built before a partner signs. Phases 7 and 8 widen reach. Phase 9 runs beside all of them and is the real gate to a launch.

## Progress log

| Date | Phase | What changed |
|---|---|---|
| 20 Oct 2026 | Phase 5 | Excel reader, invoices as drafts from a spreadsheet, Tally ledger import, other software's column names, customer statement download (migration 0030) |
| 20 Oct 2026 | Phase 4 | Template gallery with two new looks (Modern, Minimal), message wording editor (migration 0029), payment receipts. Languages and email attachments left open with reasons |
| 20 Oct 2026 | Phase 3 | Saved views, column chooser, CSV export from lists, keyboard shortcuts and help sheet, team notes on documents (migration 0028). Guided tour left open |
| 20 Oct 2026 | Phase 2.5 | Bank statement page: CSV reader for common bank formats, matching to open invoices and bills, confirmation, duplicate protection. Also fixed two contrast failures the new palette introduced (sidebar group labels, landing band) |
| 20 Oct 2026 | Phase 2 (part) | Advances, customer credit, refunds, pay at the counter with a PAID mark (migration 0027). E2E now builds into `.next-e2e`, so it can run beside a dev server |
| 20 Oct 2026 | Phase 1 | Default notes and terms, extra details, salesperson, live preview tab, attachments (migrations 0025, 0026) |
| 20 Oct 2026 | Before phase 1 | Order or PO number, subject, payment terms, discount on the whole bill, shipping helper, duplicate as draft |
