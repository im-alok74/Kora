# Recon: MyBillBook

Date read: 18 Oct 2026. Public pages only. Capterra returned HTTP 403 to automated access, and I did not work around it.

## Sources actually read

| ID | URL | Used for |
|---|---|---|
| M1 | https://mybillbook.in/ | positioning, feature blocks, FAQ |
| M2 | https://mybillbook.in/pricing and /e-invoice-software | rendered empty or redirected to M1 in a headless read |
| M3 | Search-engine summaries of the Capterra, GetApp and Software Advice listings (listed in complaints.md) | rating, review count, entry price |

Pricing is not confirmed from the vendor. M2 gave no text. The only price I saw is "basic plans start from Rs.199 per month" via a Software Advice summary (M3). The bible's "Rs 399 a year" on another listing could not be found. Treat both as unverified until someone opens the live pricing page in a normal browser.

## Positioning

Counter-billing and stock app for shops, distributors, wholesalers and manufacturers. Claims: "Trusted by 1 Crore+ Businesses", "Create GST bill in 8 seconds", "Collect 97% payments on time", "Save upto 65% today" banner (M1). All vendor claims, no independent check.

## Feature blocks stated on M1

| Area | Stated |
|---|---|
| GST and non-GST invoices | auto-tax, HSN or SAC, custom formats, quotations, purchase orders, POS billing |
| Templates | logo, colours, fonts, themes; thermal, A4 and A5 print |
| Inventory | real-time stock, low-stock alerts, batch tracking, expiry management, barcode scanning |
| Collections | WhatsApp and SMS payment reminders carrying UPI links, shareable live ledgers, outstanding dues |
| Bookkeeping | "AI powered Hissab Kitaab": AI bank reconciliation, stock updates |
| Marketing | online catalogue, WhatsApp and SMS campaigns, loyalty points |
| Reports | cash flow, sales, outstanding, GSTR reports, Tally export |
| Compliance | GSTR-1, GSTR-2, GSTR-3B reports, input tax credit, e-invoicing, e-way billing |
| Platforms and team | PC, web, Android, iOS; real-time sync; multi-user access |
| Onboarding | free account setup, upload inventory and parties, product demo, staff training |

## Screens and flows (inferred from block names only)

S01 Home dashboard, S02 Sales invoice create, S03 Party ledger, S04 Item and stock list, S05 Barcode and POS billing, S06 Payment reminder composer, S07 GST reports, S08 e-Invoice and e-way bill actions, S09 Online catalogue, S10 Campaigns and loyalty, S11 Hissab Kitaab bookkeeping, S12 Settings and users.

F01 Bill at the counter: scan, add, tax auto, print on thermal or share. F02 Chase dues: pick overdue parties, send WhatsApp or SMS with UPI link. F03 Month-end: export GSTR-1 and share with the CA. F04 Move from Tally or another app by uploading items and parties.

I could not walk any of these. Confidence is low on step counts.

## Inferred data model

Party (customer or supplier, ledger), Item (HSN, stock, batch, expiry, barcode), Bill (GST or non-GST, quotation, purchase order), Payment, Reminder, Loyalty account, Catalogue, User. [medium, from feature wording only]

## Why this matters for Kora

- It is the proof that WhatsApp plus UPI-link reminders is already table stakes in India. Kora cannot call that a differentiator on its own.
- It targets the shop owner. Kora's bible says the first buyer is still an open question (freelancer, shop, or CA-led business). MyBillBook's inventory and POS depth is a reason not to chase shops in v1.

## Out of scope for Kora

WhatsApp marketing campaigns, loyalty points, online catalogue, "Hissab Kitaab" AI bookkeeping, restaurant and pharmacy verticals. These are separate products.

## What cannot be cloned

The 1 crore user base, vendor-side GSP arrangements, and the Hindi-language trust built with shop owners.
