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

- [ ] 2.1 Sales receipts: a paid-at-the-time document for any business, not only the till (Zoho, Vyapar). M
- [ ] 2.2 Retainer or advance invoices that later invoices draw down (Zoho). M
- [ ] 2.3 Customer credit balance: an advance or overpayment held on the customer and applied to the next invoice (Zoho, QuickBooks). M
- [ ] 2.4 Refund of a payment, recorded against the payment and the credit note (Zoho). S
- [ ] 2.5 Bank statement upload (CSV) with suggested matches to open invoices and bills (Vyapar, QuickBooks). L
- [ ] 2.6 A second gateway adapter, Cashfree, behind the same interface (Zoho, Vyapar). M, **needs keys to go live**
- [ ] 2.7 Billable expenses that turn into invoice lines (Zoho). S

## Phase 3: lists and workspace (code only)

- [ ] 3.1 Saved views on the documents list: filters, sort and columns remembered by name (Zoho, QuickBooks). M
- [ ] 3.2 Column chooser on the documents, customers and items lists (Zoho). S
- [ ] 3.3 Keyboard shortcuts: new invoice, search, go to a page, with a help sheet (Zoho, QuickBooks). S
- [ ] 3.4 In-app help: a short guided tour on first sign-in and a help panel on each page (Zoho, FreshBooks). M
- [ ] 3.5 Comments on a document, visible to the team only (Zoho, QuickBooks). M
- [ ] 3.6 Export any list to CSV or Excel from the list itself (all). S

## Phase 4: templates, languages and messages (code only)

- [ ] 4.1 Template gallery with live preview: Classic, Compact, Modern, Minimal, plus the existing narrative and thermal (Zoho, Ninja, Vyapar). M
- [ ] 4.2 More fixed-word languages: Tamil, Telugu, Kannada, Bengali, Malayalam, Punjabi (Zoho 10+). M, **words need a native reader's review**
- [ ] 4.3 Editable message templates for WhatsApp, SMS and email, with placeholders (Zoho, MyBillBook). M
- [ ] 4.4 PDF attached to the email, not only a link (Zoho, FreshBooks). S
- [ ] 4.5 Receipt for a payment, as a document the customer can download (Zoho, QuickBooks). S

## Phase 5: moving in and out (code only)

- [ ] 5.1 Excel (.xlsx) import for customers and items (Vyapar, MyBillBook). M
- [ ] 5.2 Invoice import from CSV or Excel, with a mapping step and a dry run (Zoho, Vyapar). L
- [ ] 5.3 Migration helpers: column maps for Zoho Invoice, MyBillBook and Vyapar exports (all). M
- [ ] 5.4 Tally import, to complement the Tally export (SAG, Tally). M
- [ ] 5.5 Customer and statement export per customer (all). S

## Phase 6: compliance that does not need a live partner (code only)

- [ ] 6.1 E-way bill: data, validation, the JSON the portal accepts, and a mock partner path, with the same retry and plain-words errors as e-invoice (MyBillBook, SAG). M
- [ ] 6.2 Export invoices under LUT and SEZ supplies, with a rate on the invoice and tax shown in rupees (Zoho, SAG). L
- [ ] 6.3 GSTR-9 annual summary data (SAG). M
- [ ] 6.4 TDS receivable and TDS payable reports (Zoho, SAG). S
- [ ] 6.5 MSME payment-due warnings on vendor bills (Zoho). S

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
| 20 Oct 2026 | Phase 1 | Default notes and terms, extra details, salesperson, live preview tab, attachments (migrations 0025, 0026) |
| 20 Oct 2026 | Before phase 1 | Order or PO number, subject, payment terms, discount on the whole bill, shipping helper, duplicate as draft |
