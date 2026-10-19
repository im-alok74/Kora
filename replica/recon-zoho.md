# Recon: Zoho Invoice (India edition)

Date read: 18 Oct 2026. Method: public pages only, read in a headless browser at human pace. No login, no JavaScript bundles, no network inspection. Nothing here is copied from Zoho's code, copy or templates.

## Sources actually read

| ID | URL | Used for |
|---|---|---|
| Z1 | https://www.zoho.com/in/invoice/ | positioning |
| Z2 | https://www.zoho.com/in/invoice/features/ | feature list |
| Z3 | https://www.zoho.com/in/invoice/pricing/ (same FAQ text on /invoice/pricing/) | limits, payment and WhatsApp claims |
| Z4 | https://www.zoho.com/in/invoice/help/gst/ | GST settings, registration types, help-centre tree |
| Z5 | https://www.zoho.com/in/invoice/help/e-invoicing/ | e-invoicing plan availability and flow |
| Z6 | https://play.google.com/store/apps/details?id=com.zoho.invoice&hl=en_IN&gl=IN | mobile app claims, 4.7 stars, 32.6K reviews |

Not reachable: G2 and Capterra return HTTP 403 to automated access. I did not try to get around that. The Zoho help URL /in/invoice/help/ also returned 403.

## Where the bible needs correcting

1. **E-invoicing exists on Zoho's paid plans.** Z5: "This feature is available in all the paid plans of Zoho Invoice (Basic, Standard, and Professional)." Zoho calls itself a registered GST Suvidha Provider and supports push to IRP, IRN and QR on the document, and cancellation. The bible says e-invoicing is missing from the free India edition, which is true, but "ship IRN on the first paid tier" is then parity, not a gap. Paid plan prices were not visible on any page I could read.
2. **Z5 is stale.** It still says the e-invoicing duty starts "from 1 January 2021 ... Rs. 100 crore and above". The Play listing (Z6) says Rs 5 crore. Zoho's own docs disagree with each other. A small point for Kora: keep the threshold in config and date-stamp the help text.
3. **Free-plan cap is settled for today.** Z3 says: up to two users, a maximum of three projects, up to 500 invoices per year, and "Powered by Zoho Invoice" branding. This resolves the bible's 500 versus 1,000 question as 500 on Zoho's own page.
4. **The "few local payment options" and "email-only reminders" gaps are weak.** Z3 claims invoices by email or WhatsApp, payments by UPI, cards and net banking, automated reminders. Z4 lists Razorpay, Zoho Payments, PayPal, Verifone, ICICI eazypay, Paytm and Stripe. Z3 shows a promo block "Send invoices through WhatsApp". I could not see how deep the WhatsApp feature goes (templates, delivery status, reminders), so "WhatsApp depth" stays a bet, not a proven gap.
5. **Zoho can file GST from inside the product.** Z4 describes online filing settings: GSTN username, monthly or quarterly period, an approval step before filing. The bible only credits Zoho with "GST and TDS supported".

## Screens and areas inferred from the help tree (Z4, Z5)

IDs are stable for later files. Evidence is the help-centre table of contents, not screenshots.

| ID | Area | Notes |
|---|---|---|
| S01 | Dashboard | receivables, sales, expenses widgets (Z2) |
| S02 | Customers list and detail | custom fields, portal access, statements, payment reminders, saved cards (Z2) |
| S03 | Items list and detail | SKU, custom fields, active or inactive, digital-service flag (Z2, Z4) |
| S04 | Quotes (formerly Estimates) | expiry date, portal approval, convert to invoice or project (Z2) |
| S05 | Invoice create and edit | tax split, GST fields, reverse-charge toggle (Z4) |
| S06 | Invoice detail and actions | send, record payment, credit note, e-invoice push and cancel (Z5) |
| S07 | Sales receipts | pay-at-sale document |
| S08 | Payment links | create, receive, manage |
| S09 | Recurring invoices and profiles | associate projects, auto-charge |
| S10 | Credit notes | refund by credit note applied to an invoice (Z2) |
| S11 | Bill of supply | listed under help topics |
| S12 | Expenses and mileage | billable expenses convert to invoices |
| S13 | Projects and timesheets | project hours or task hours, Chrome extension |
| S14 | PDF template gallery and editor | item table styling, per-contact template assignment (Z2) |
| S15 | Customer portal | view, accept, pay, comment, bulk pay (Z2) |
| S16 | Reports | about 30 reports, custom date ranges, Zoho Analytics link (Z2) |
| S17 | Settings: organisation, users and roles, GST, TDS, MSME, SMS, email, reminders, MFA, backup, AI | (Z4) |
| S18 | GST filing and online filing settings | GSTN connect, approvals (Z4) |
| S19 | e-Invoicing setup | enable, connect to IRP, permissions, statuses (Z5) |
| S20 | Online payments settings | gateways (Z4) |
| S21 | Import, export, migrate from other software | (Z4) |

## Key flows and click counts

I cannot count real clicks without using the app. The vendor claim to beat is "create GST-compliant invoices in one click" (Z3), which is marketing, not a measurement. Kora's own target stays at under 60 seconds from open to sent. Before Phase 3, someone should time a first invoice in Zoho's public demo account (Z3 links one) to get a real number.

- F01 Create GST invoice: customer, items, tax auto-split, save, email or WhatsApp (Z3).
- F02 Quote to invoice: send quote, customer accepts in portal, convert (Z2).
- F03 Collect: invoice sent, customer pays by UPI, card or net banking, reminders run (Z3).
- F04 Refund: credit note applied to invoice (Z2). A Play reviewer says finding this took three days (see complaints.md C06).
- F05 e-Invoice: enable, connect IRP, create invoice, push, IRN and QR return, cancel if needed (Z5).
- F06 Recurring: profile, schedule, optional auto-charge with saved card (Z2).
- F07 GST filing: connect GSTN, generate return, approval, file (Z4).

## Components (from descriptions only)

Item table with configurable header and rows, address-format configurator, PDF template gallery, status chips, portal pages, reminder rule editor, role and permission matrix, report filter bar, "Ask Zia" chat widget.

## Inferred data model (confidence in brackets)

Organisation (GSTIN, legal name, trade name, state, registration type, registered-on date, reverse-charge flag) [high, Z4]. Contact (customer with portal, custom fields, saved cards) [high]. Item (SKU, active flag, custom fields, digital-service flag, tax rate) [high]. Quote, Invoice, Sales Receipt, Credit Note, Recurring Profile [high]. Payment and payment link [high]. Expense, Mileage, Project, Timesheet [high]. User with role and customer-restriction [high]. Tax return with approval state [medium]. e-Invoice record with statuses [medium].

Z4 gives a hard constraint worth copying in spirit: once taxed transactions exist, GST cannot be switched off, GSTIN should not be changed, and state cannot be changed. Their remedy is "create a new organisation". Kora's schema should model GSTIN change as a new business or a dated registration history, not an edit.

## Feature matrix

See features.csv. Rows tagged `zoho` in the notes come from this recon.

## Out of scope for Kora

- Zoho Marketplace and the wider Zoho ecosystem (CRM, Books, Desk, Analytics, Cliq): a partner network, not a feature.
- Zoho Analytics connector.
- Ask Zia AI assistant: an AI bet for v3 at the earliest.
- Time-zone and country coverage beyond India.

## What cannot be cloned

The 15 or so other country editions, Zoho's GSP licence and its IRP connection, and its brand and user base.

## Size

L for the whole surface; the bible's v1 slice is roughly M to L because the tax library and e-invoice adapter carry the risk.
