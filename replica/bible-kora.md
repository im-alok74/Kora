# Product bible: Kora, as built

Date: 20 October 2026. Written from the code in this repository, not from the plan. Where `bible.md` says what Kora intends, this file says what exists. Companion files: `bible-zoho.md`, `comparison.md`.

## One line

GST-first invoicing and collections for Indian businesses, with tools for CA firms, lawyers, freelancers, shops and businesses that trade with each other, on one engine that the database itself keeps correct.

## Size of the thing

133 API routes, 36 pages, 23 migrations, 56 tables, 47 service modules in `packages/core`, a pure tax library, a PDF renderer, a worker, a mock GST partner, and a test suite of 378 unit and integration tests, 17 PDF tests and 87 browser tests. Roles: `kora_owner`, `kora_app`, `kora_web`, `kora_svc`.

## Principles that shape every module

1. **Money is whole paise.** Integer in `bigint`, no floating point in any money path.
2. **Issued documents are sealed.** Triggers refuse edits; corrections go through credit and debit notes.
3. **Numbers have no gaps.** The database assigns them under a row lock per series and financial year.
4. **The database enforces tenancy.** Row-level security on every tenant table; the app cannot skip it.
5. **Every change is logged.** An append-only audit log that nobody can edit, and a separate security log.
6. **Statutory fields are printed from code.** A template can change colour, font and optional blocks, never the legal fields.
7. **No live government or payment service is called** from tests or local runs; everything outside goes through adapters with mocks.

## Modules

| Area | What exists |
|---|---|
| Documents | Tax invoice, bill of supply, estimate, proforma, delivery challan, credit note, debit note. Series per financial year. Drafts, issue, cancel with reason, clone via notes, bulk issue, delete, remind, cancel. Estimates accept, decline, expire and convert once. Offline drafts with conflict handling |
| Tax | Pure library: CGST, SGST, IGST, cess, TCS, TDS, reverse charge, round-off, tax-inclusive (MRP) prices, place of supply, GSTIN checksum, HSN or SAC, allowed rate list. Property-tested |
| Parties and items | Customers and vendors, state and GSTIN validation, multiple addresses, currency; items with HSN or SAC, rate, price, stock tracking, barcode, reorder level, network listing |
| Delivery | PDF (Chromium, serverless-capable), public link with view count, WhatsApp, SMS, email through a retrying queue |
| Collections | UPI QR for the amount still due, payment links, idempotent gateway webhooks (Razorpay), partial payments, TDS as a payment, reminders on a schedule, late-fee debit notes, receivables ageing, client portal by private link |
| Compliance | E-invoice (IRN and QR) through a partner adapter with retry, rejection and cancellation window; e-way bill table; GSTR-1 JSON, GST summary, GSTR-3B including table 4, GSTR-2B import and matching |
| Purchases | Vendor bills, payments, payables ageing, input tax credit status, reconciliation |
| Inventory and shop | Stock ledger by trigger, counts, low stock, barcode lookup, till with 80 mm receipt, Hindi, Marathi and Gujarati documents |
| CA firm | Clients screen across businesses with attention list, inbox for client documents |
| Lawyers | Matters with time, expenses, fees, hearings, client money held in trust with ledger, invoices paid from held funds, private matters |
| Freelancers | Projects on the matters engine, timer, billing of tracked hours |
| Network | Invoices delivered between Kora businesses and accepted as purchase bills, directory, catalogue, purchase orders that become invoices |
| Expenses | Spend records with receipt files, category totals |
| Reports | Sales register, by customer, payments, ageing, statements, CSV safe for spreadsheets |
| Team | Owner, staff, accountant roles enforced in the database; several businesses per login |
| Security | One-time codes, optional authenticator app, recovery codes, device list, security log, account closing, rate limits |
| Platform | JSON API with keys and signed retrying webhooks, OpenAPI, Excel and Tally export, import, search palette, notifications, dark theme, container image, backups, daily tick, jobs admin |
| Languages | English, Hindi, Marathi, Gujarati for the fixed words on documents |

## The invoice screen as built

Header: customer, document type, date, payment terms, due date, order or PO number, subject. Items: description with HSN or SAC and a price-includes-GST tick, quantity, rate, discount (amount or percent), GST rate, amount; a shipping-charge button and a discount on the whole bill shared over the lines. Notes, terms, reverse charge, TCS and TDS rates. A sticky summary with bill-to, tax lines, total, place of supply and warnings, and Issue and Save draft. Live totals come from the server and from the same tax library on the device when offline.

The invoice document: top bar, number and dates strip with place of supply, bill-to and ship-to cards, tinted item table, tax summary by HSN or SAC, total bar, amount in words, bank and UPI cards, notes, terms, signature, footer; IRN and QR when registered.

## Data model in brief

`business`, `member`, `app_user`, `party`, `item`, `document`, `document_line`, `number_series`, `payment`, `payment_allocation`, `einvoice`, `eway_bill`, `reminder`, `delivery`, `job`, `audit_log`, `share_link`, `portal_link`, `recurring_profile`, `estimate_state`, `expense`, `purchase_bill`, `stock_movement`, `matter` and its entries, `network_*`, and the security tables. `docs/database.md` has the full diagram.

## Known gaps in the build (see `comparison.md` for the ranked list)

No custom fields, no files attached to a document, no retainer invoices, no sales receipts, no live preview in the editor, no template gallery, e-way bill generation, a live GST partner connection, customer login accounts, export invoices under LUT.
