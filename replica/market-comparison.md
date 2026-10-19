# Kora against the invoicing market

Date: 19 Oct 2026. Products: Zoho Invoice (the "JoHo" in your message), MyBillBook, Vyapar, Refrens, Gen GST, and, for the global view, QuickBooks Online, FreshBooks, Wave and Invoice Ninja.

**How to read this.** Evidence is public vendor pages, store listings and aggregator summaries. I did not use any competitor's app, so everything marked "claimed" is a vendor claim, and UI notes describe patterns, not pixels. Nothing here is copied from a competitor. There is no "RCA" skill installed in this workspace, so I applied root cause analysis directly: for every gap, the symptom, why it exists, and the smallest fix. Kora's column is from `features.csv` and the code as of commit `f998d58`.

Legend: **Y** has it, **P** partly, **N** no, **?** could not confirm, **skip** deliberately not built.

## 1. Feature matrix

### Documents

| Feature | Zoho | MyBillBook | Vyapar | Refrens | Global (QB, FB, Wave, Ninja) | Kora |
|---|---|---|---|---|---|---|
| Tax invoice, bill of supply | Y | Y | Y | Y | invoice only | **Y** |
| Estimate or quote, accept, convert | Y | Y | Y | Y | Y | **Y** (expiry, accept or decline, convert once) |
| Proforma invoice | ? | Y | Y | Y | some | **Y** |
| Delivery challan | Y | Y | Y | Y | N | **Y** |
| Credit and debit notes | Y (credit) | Y | Y | Y | credit | **Y** |
| Sales receipt (pay at sale) | Y | via POS | Y | ? | Y | N |
| Purchase order, vendor bill, purchases | Books | Y | Y | Y | QB, Ninja | N |
| Recurring invoices | Y | ? | Y | Y | Y | **Y** (draft, issue, or issue and send) |
| Retainers, deposits, progress billing | Y | N | N | ? | FB, QB | N |
| Custom fields | Y | ? | Y | Y | Ninja | N |
| Attachments on documents | Y | Y | ? | Y | Y | P (receipts on expenses only) |
| Gapless numbering per series and year | not seen | not seen | not seen | not seen | not applicable | **Y**, enforced in the database |
| Issued documents immutable | not seen | not seen | not seen | not seen | partly | **Y**, enforced in the database |

### India tax and compliance

| Feature | Zoho | MyBillBook | Vyapar | Refrens | Kora |
|---|---|---|---|---|---|
| CGST, SGST, IGST from place of supply | Y | Y | Y | Y | **Y** |
| HSN or SAC on items | Y | Y | Y | Y | **Y** |
| Cess, reverse charge | Y | Y | Y | Y | **Y** (cess is ad valorem only) |
| TDS and TCS on documents | Y | ? | ? | ? | **Y** |
| GSTIN lookup fills name and address | Y | Y | Y | Y | P (state only, needs a GST partner) |
| E-invoice IRN and QR | Y, paid plans | Y | Y | Y, bulk | P (full flow, **mock partner only**) |
| E-invoice cancel in 24 hours | Y | ? | ? | Y | **Y** |
| Plain-words rejection fixes and resubmit | not seen | not seen | not seen | not seen | **Y** |
| E-way bill | ? | Y | Y | Y | **N** |
| GSTR-1 export | Y | Y | Y | Y | **Y** (CA must check against the offline tool) |
| GSTR-3B summary | Y | Y | Y | Y | P (3.1 and 3.2, no input tax credit) |
| GSTR-2A or 2B, input tax credit | Books | Y | Y | Y | **N** (no purchases) |
| File returns from inside the product | Y | ? | ? | ? | **N** (by design) |
| Composition, SEZ, exports with LUT | Y | P | Y | Y | P (composition yes, export and SEZ invoices not complete) |
| MSME, Udyam on documents | Y | ? | ? | ? | N |

### Collections and money

| Feature | Zoho | MyBillBook | Vyapar | Refrens | Global | Kora |
|---|---|---|---|---|---|---|
| UPI QR on invoice | ? | Y | Y | Y | n/a | **Y**, amount still due |
| Payment link and gateways | Y, many | Y | Y | Y | Y | P (mock gateway, needs credentials) |
| Part payments, allocation, credit notes applied | Y | Y | Y | Y | Y | **Y** |
| Auto-match gateway payments, idempotent | claimed | ? | ? | ? | Y | **Y** (mock) |
| Reminders on WhatsApp, SMS, email | email, WhatsApp claimed | Y | Y | Y | email | P (all three, mock senders) |
| Late fees | Y | ? | ? | ? | FB, QB | **Y** (draft debit note, never automatic) |
| Auto-charge saved card or mandate | Y | N | N | ? | Y | N |
| Multi-currency | Y | N | P | Y | Y | P (quotes only, tax invoices in rupees) |
| Expenses, receipts, billable expenses | Y | Y | Y | Y | Y | P (no billable, no input tax credit) |
| Bank feeds and reconciliation | Books | AI claimed | ? | ? | QB, FB, Wave | N |
| Customer statements and ageing | Y | Y | Y | Y | Y | **Y** |

### Delivery, portal, templates

| Feature | Zoho | MyBillBook | Vyapar | Refrens | Global | Kora |
|---|---|---|---|---|---|---|
| PDF, email, WhatsApp, SMS | Y | Y | Y | Y | email | P (live providers not connected, email has no PDF attached yet) |
| Public link with view tracking | ? | ? | ? | ? | FB, QB | **Y** |
| Client portal with login | Y | live ledger link | ? | Y | Y | P (private link per customer, no customer accounts) |
| Template editor, many layouts | Y | themes | Y | Y | Ninja deep | P (colour, font, layout, logo, locked statutory fields; no block editor) |
| Thermal and A5 | N | Y | Y | ? | N | N |
| Many languages on output | Y | Hindi etc. | Y | Y, custom scripts | Y | N |

### Platform, team, integrations

| Feature | Zoho | MyBillBook | Vyapar | Refrens | Global | Kora |
|---|---|---|---|---|---|---|
| Roles and permissions | Y | Y | Y | Y | Y | **Y**, enforced in the database |
| Activity log that cannot be edited | ? | ? | ? | ? | QB audit log | **Y** |
| MFA | Y | ? | ? | ? | Y | P (OTP, passkeys later) |
| Mobile apps | Y | Y | Y | Y | Y | P (installable web app, offline drafts) |
| Offline drafts with sync and conflict prompt | N | partly (desktop) | desktop | N | N | **Y** |
| Public API and webhooks | Y | N | N | ? | Y | **Y** (keys, idempotency, signed webhooks, OpenAPI) |
| Tally, Excel import and export | Y | Y | Y | Y | Y | P (export yes, Tally import and xlsx import no) |
| Integrations marketplace | Y, large | N | N | some | Y, large | skip |
| Inventory with batches, serials, barcodes | SKU only | deep | deep | Y | QB | N |
| POS and thermal counter billing | N | Y | Y | N | N | N |
| Time tracking and projects | Y | N | N | Y | FB | N |
| Marketing, loyalty, catalogue | N | Y | Y | N | N | skip |
| Backup and data export | Y | ? | Y | Y | Y | **Y** |

## 2. UI patterns the market shares

| Pattern | Seen in | Kora now |
|---|---|---|
| Left navigation with grouped sections | Zoho, Vyapar, QB, FB | **Y**, dark sidebar, groups, phone drawer |
| Dashboard: receivables, overdue, sales, expenses, chart | all | **Y**, with a setup checklist and quick actions |
| Document list with tabs, search, status filters | all | **Y** |
| Split invoice screen: form left, live preview or totals right | Zoho, Refrens | **Y**, sticky summary; no live PDF preview |
| Invoice detail with status, big amount, actions, payment history | all | **Y** |
| Template gallery with live preview | Zoho, Ninja, Vyapar | P |
| Customer detail with tabs (overview, transactions, statements, comments) | Zoho, QB | N, flat pages |
| Bulk actions on lists (send, delete, export, mark paid) | Zoho, Vyapar, QB | N |
| Saved views and column chooser | Zoho, QB | N |
| Global search and keyboard shortcuts | Zoho, QB | N |
| Notification centre, in-app help, guided tour | Zoho, FB | N, setup checklist only |
| Dark mode, accent colour per business | few | N |
| Marketing page with pricing, demo, testimonials, integrations | all | P (no pricing section, deliberately no invented testimonials) |

## 3. Root cause analysis of Kora's gaps

Format: symptom, root cause, fix and size (S under a day, M a few days, L a week or more).

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | Nothing real is sent, paid or registered | All outside connections are mock adapters. We cannot hold live WhatsApp, gateway or GSP credentials, and we will not call live government or payment endpoints without them. | Sign a partner (GSP, gateway, WhatsApp provider), fill the existing adapter slots, run the existing contract tests against sandboxes. **L, blocked on credentials.** This is the biggest gap. |
| 2 | No e-way bill | Not built: scope was held to documents and e-invoice first. Needs the same partner as 1. | Reuse the e-invoice adapter pattern, add a transport panel on the invoice. **M after 1.** |
| 3 | No purchases, input tax credit, GSTR-2B, GSTR-3B incomplete | Data model has sales only. Every ITC feature hangs off vendor bills. | Vendor master, bills, purchase orders, then ITC into GSTR-3B. **L.** |
| 4 | Foreign-currency tax invoices and export or SEZ invoices missing | Totals and the GST library assume rupees. Quotes were made multi-currency first because they carry no tax duty. | Store a rate on the invoice, tax in rupees, LUT and export fields, GSTR-1 export tables. Needs CA review. **L.** |
| 5 | No inventory, POS, thermal, barcode | A deliberate scope choice: shop billing is MyBillBook and Vyapar territory and is a different product. | Only if we target shops. Otherwise a light stock count on items. **L for deep, S for light.** |
| 6 | No bulk actions, saved views, global search, customer tabs | UI built page by page. No shared list component or command layer yet. | One reusable list with selection and bulk bar, then a search command box. **M.** |
| 7 | Templates are configurable but not a block editor, no gallery, no languages | Print uses one fixed HTML layout with options. Statutory fields must stay locked, which constrains a free editor. | Layout presets with live preview first, language packs next. **M, then L.** |
| 8 | No customer login accounts or saved payment methods in the portal | Portal was built on hash-only private links to avoid password risk. | Optional customer OTP login on top of the same link. Saved cards only through the gateway's vault. **M.** |
| 9 | No auto-charge, bank feeds, bank reconciliation | Needs gateway mandates and an account-aggregator partner. | After 1. **L.** |
| 10 | No projects, time tracking, billable expenses | Out of the first buyer's workflow. | Billable expenses first (small), projects later. **M, L.** |
| 11 | Import limited to customers and items as CSV | Importer was scoped to the simplest cases. | .xlsx reader, invoice import, Tally import. **M.** |
| 12 | No marketing-page pricing, demo or proof | We have no price decided and no customers to quote. We will not invent either. | Decide pricing, add a real demo tenant, add real quotes when they exist. **S once decided.** |

## 4. Where Kora is ahead, with how sure we are

| Edge | Evidence | Confidence |
|---|---|---|
| Gapless numbers and immutable issued documents enforced by the database | Tests and triggers in this repo. No competitor evidence either way. | High for Kora, unknown for rivals |
| Plain-words e-invoice rejections with fix and resubmit | Built and e2e tested against a mock partner. | High, but untested on the real portal |
| Offline drafts with conflict handling | e2e tested. Only desktop-era rivals do similar. | High |
| Public API with idempotency and signed webhooks, at no extra tier | Built and tested. Zoho has an API, the Indian shop apps mostly do not. | Medium |
| Late fee as a draft debit note, never automatic | Built. | High |
| Audit log nobody can edit, roles enforced in the database | Built. | High |
| No invoice cap | A pricing decision, not a feature. Zoho's free plan caps at 500 a year. | Depends on the price we set |

## 5. Where Kora is behind, plainly

1. Live connections. Until gap 1 is closed, Kora cannot send a real WhatsApp, take a real payment or register a real IRN. Competitors do all three today.
2. Breadth. Purchases, e-way bills, inventory, POS, projects, bank feeds and an integrations marketplace are all absent.
3. Maturity. Rivals have years of real users, support teams and review histories. Kora has tests, not customers.
4. UI depth. The look is now at parity on the main screens, but bulk actions, saved views, customer tabs, search and template gallery are missing.

## 6. Suggested order

1. Partner credentials for GSP, a gateway and WhatsApp, then switch the adapters (gap 1, then 2).
2. List component with bulk actions, search, customer tabs (gap 6).
3. Vendor bills and input tax credit (gap 3), then GSTR-3B completion with a CA.
4. Template presets and language packs (gap 7).
5. Decide the first buyer (freelancer, shop or CA-led firm). It decides whether inventory and POS (gap 5) are ever built.

## Sources

- [Zoho Invoice pricing and limits](https://www.zoho.com/in/invoice/pricing/), [features](https://www.zoho.com/in/invoice/features/), [e-invoicing help](https://www.zoho.com/in/invoice/help/e-invoicing/)
- [MyBillBook](https://mybillbook.in/)
- [Refrens GST billing](https://www.refrens.com/gst-billing-invoicing-software), [Refrens against Vyapar](https://www.refrens.com/grow/refrens-vs-vyapar/) (vendor-authored)
- [Capterra: Vyapar against MyBillBook](https://www.capterra.com/compare/180579-202732/Vyapar-vs-FloBooks)
- [G2: FreshBooks against Invoice Ninja](https://www.g2.com/compare/freshbooks-vs-invoice-ninja)
- Earlier recon in this folder: `recon-zoho.md`, `recon-mybillbook.md`, `recon-sag.md`, `complaints.md`, `features.csv`

## 7. Three audiences: businesses, CAs, lawyers

Honest position: Kora today fits a **service business or small trader that wants correct GST invoices and collections**. It is a decent base for CAs and a poor fit for lawyers until matter billing exists. "Win every field" is not one product; it is a shared core (documents, tax, collections, audit) with a different front door and a few extra modules per audience. Order matters: a CA who trusts Kora brings many businesses with them.

| Need | Business owner | CA or accounting firm | Lawyer or law firm | Kora today |
|---|---|---|---|---|
| Correct GST invoices, payments, reminders | core | core | core | **Y** |
| Many clients under one login, switch fast | one or few | many | many | P (switcher exists, no firm dashboard) |
| Firm view: all clients' dues, filing status, pending work | n/a | core | useful | N |
| Invite a client, client uploads bills, CA approves | n/a | core | n/a | N (accountant role exists) |
| Bulk GSTR-1 and 3B across clients | n/a | core | n/a | N |
| Purchases, ITC, GSTR-2B reconciliation | useful | core | useful | N |
| Tally and Excel in and out | useful | core | n/a | P |
| Audit log, immutable records | useful | core | core | **Y** |
| Matters or cases as the thing you bill against | n/a | engagements | **core** | N |
| Time entries and hourly rates, fixed fees, retainers | n/a | useful | **core** | N |
| Advance or client money kept separate from fees | n/a | n/a | **core** | N |
| Disbursements (court fees, stamp duty) billed at cost, with receipts | n/a | useful | **core** | P (expenses exist, not billable) |
| Invoice per matter with narrative lines, no HSN item list | n/a | useful | **core** | N (item-based editor) |
| Conflict check, hearing dates, deadlines | n/a | due dates | **core** | N |
| Client confidentiality, per-matter access, secure sharing | n/a | useful | **core** | P (roles are per business, not per matter) |

### Root causes for the lawyer gap

1. **Symptom:** an advocate cannot bill by matter or hour. **Root cause:** the document model is customer and item lines, and there is no matter, time entry or rate card. **Fix:** a Matter entity (client, title, rate, status), time entries that roll into a draft invoice, fixed-fee and retainer lines. **L.**
2. **Symptom:** client money cannot be kept apart. **Root cause:** payments settle invoices only; there is no unapplied advance ledger. **Fix:** a client-money ledger with deposits, drawdowns against invoices and a statement. Rules on holding client funds differ by bar council and need a lawyer's review before launch. **M to L.**
3. **Symptom:** legal-service tax cases are not handled. **Root cause:** place of supply and tax library were built for goods and general services. Services by an advocate to a business entity are generally under reverse charge, and professional fees often carry TDS. Both flags exist (reverse charge, TDS), so this is mostly defaults and a legal template. **Needs a CA to confirm the current rules. S to M.**
4. **Symptom:** a lawyer's invoice looks like a shop bill. **Root cause:** one template with an item table. **Fix:** a narrative template with matter reference, period and disbursements section. **S to M.**
5. **Symptom:** confidentiality cannot be promised per matter. **Root cause:** roles apply to the whole business. **Fix:** per-matter access lists enforced by the same database policies. **M.**
6. **Marketing caution:** Indian bar rules restrict how advocates may advertise. Kora's page should describe the product, not solicit clients for lawyers. Get this checked.

### Root causes for the CA gap

1. **Symptom:** a CA with 40 clients has no single view. **Root cause:** each business is isolated, by design, and nothing aggregates across them. **Fix:** a firm workspace with a read-only roll-up per client (dues, drafts, GST due dates), built on the existing multi-business login. **M.**
2. **Symptom:** the CA cannot do ITC work. **Root cause:** no purchase side (gap 3 above). **Fix:** vendor bills plus a 2B import and match screen. **L.**
3. **Symptom:** clients cannot hand over documents. **Root cause:** only invoices and expense receipts exist. **Fix:** a client inbox for uploaded bills with a review queue. **M.**

### What I recommend

1. Keep the core promise narrow and true: correct, audited GST documents and collections.
2. Build for the **CA firm** next: firm roll-up, purchases and ITC, client inbox. A CA brings dozens of businesses and tests the compliance claims harder than anyone.
3. Treat **lawyers** as a vertical module on the same core (matters, time, retainers, client money, narrative template), and only after a practising advocate and a CA have reviewed the tax and client-money rules.
4. Do not promise "every field" on the site. Say who it is for today and add audiences as each module ships and is reviewed.
