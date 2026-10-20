# Product bible: Zoho Invoice

Date: 20 October 2026. Companion to `bible.md` (Kora's plan), `bible-kora.md` (Kora as built) and `comparison.md` (side by side).

## How this was made, and what it cannot tell us

Sources: Zoho's public product, feature, pricing and help pages, its mobile store listing, the earlier recon in `recon-zoho.md`, public review sites, and the screens Zoho publishes in its own marketing. Method: reading and observing public pages only.

What this document is **not**: it is not a teardown of Zoho's code, database or private API. The in-app screens sit behind a login, and Zoho's terms do not allow us to take its bundles apart or call its private endpoints. REA, the reverse engineering tool installed for this project, is therefore used for Kora's own build, and on Zoho only for what its public pages show. Every claim below is tagged:

- **[D]** documented by Zoho on a public page
- **[O]** observed in Zoho's public marketing screens
- **[I]** inferred from how the product behaves in its own documentation, not confirmed
- **[?]** unknown, could not be established without an account

Nothing here is a Zoho asset. Names of fields and steps describe behaviour; Kora writes its own words, layouts and code.

## Who it is for

Freelancers, small service firms and small businesses, worldwide, with an India edition that adds GST. Free tier with limits; paid tiers add users, automation and e-invoicing. [D] Zoho sits inside a larger family (Books, Billing, Expense, Inventory, CRM), so Invoice is the entry point of an upsell path. [D]

## Modules and what each contains

| Module | Contents | Source |
|---|---|---|
| Dashboard | Receivables summary with ageing bars (current, 1-15, 16-30, 31-45, 46+ days), income and expense chart, quick actions: new invoice, customer, expense, time log | [O] mobile dashboard |
| Customers | Contact with portal access, custom fields, statements, reminders, saved cards, multiple contacts | [D] |
| Items | Goods or services, SKU, HSN or SAC, tax, active flag, custom fields | [D] |
| Quotes | Expiry date, portal approval, convert to invoice | [D] |
| Invoices | Statuses draft, sent, viewed, partially paid, paid, overdue, void [I]; send by email, WhatsApp, SMS; PDF; clone; credit note; e-invoice push and cancel | [D] |
| Recurring invoices | Profiles with schedule, auto-send, optional auto-charge | [D] |
| Retainer invoices | Advance requests applied to later invoices | [D] |
| Sales receipts | Pay-at-sale documents | [D] |
| Delivery challans | GST challan with conversion to invoice | [D] |
| Payments received | Record, link to invoices, refunds, payment links, online gateways | [D] |
| Credit notes | Refund by credit note applied to an invoice | [D] |
| Expenses and mileage | Billable expenses convert into invoice lines | [D] |
| Time tracking | Projects, tasks, timesheets, billed by hour or fixed | [D] |
| Reports | About 30: sales, receivables, payments, taxes, expenses, projects | [D] |
| Client portal | View and pay, accept quotes, comment, bulk pay, statements | [D] |
| Settings | Organisation, users and roles, taxes (GST, TDS, MSME), templates, email and SMS, reminders, MFA, backup, import and export, API | [D] |
| GST filing | Connect to GSTN, prepare returns, approval step before filing | [D] |

## The invoice screen, field by field

This is the screen Kora has to beat. The structure below comes from Zoho's help pages and marketing screens; exact layout is [I].

**Header:** customer picker (with a quick "new customer" step), invoice number (auto or manual), order number, payment terms (due on receipt, net 15, net 30, net 45, net 60, end of month, custom), invoice date, due date, salesperson, subject line. [D]

**Item table:** item details (name and a free description), quantity, rate, discount (percent or amount per line), tax (chosen from a list), amount. Add row, add in bulk, reorder. [D]

**Totals block:** sub total, discount on the whole bill (percent or amount, before or after tax), shipping charges, adjustment (a free plus or minus to round), tax lines by rate, TDS or TCS selector, total, and payments applied. [D]

**Below the table:** customer notes, terms and conditions, attach files (a few files per invoice), pick a PDF template. [D]

**Actions:** save as draft, save and send, save and record payment. After issue: edit, clone, record payment, send, mark as sent, void, delete, create credit note, e-invoice. [D]

**Document view:** a paper preview next to a side panel; a "next steps" strip suggests sending, recording payment; status ribbon on the paper; payment history and activity underneath. [O]

## Invoice PDF structure

Logo and organisation block, invoice title and number, date and terms, bill to and ship to, place of supply, item table with HSN or SAC, tax breakdown, totals, amount in words, notes, terms, bank details and a UPI or payment link, signature, footer. Several template styles; colour, font and header options are editable. [D]/[O]

## Data model (inferred, not observed)

Organisation (GSTIN, legal and trade name, state, registration type) [D]; Contact with portal flag and custom fields [D]; Item with tax and SKU [D]; Quote, Invoice, Retainer, Sales Receipt, Credit Note, Delivery Challan as typed documents with line items [I]; Recurring profile [D]; Payment with allocations and refunds [I]; Expense, Mileage, Project, Task, Timesheet [D]; User with role and customer restriction [D]; Tax return with approval state [I]; e-Invoice record with status [I]. Actual schema, constraints, indexing, audit approach and tenant isolation: [?].

One hard rule Zoho documents: once taxed transactions exist, GST cannot be switched off and the GSTIN and state should not change; the remedy is a new organisation. [D]

## Collections and communication

Email, WhatsApp and SMS delivery; automated payment reminders on a schedule; payment links; UPI, cards and net banking through gateways (Razorpay, Zoho Payments, PayPal, Stripe, Paytm and others, by country). [D] How deep WhatsApp goes (templates, delivery status, two-way): [?].

## Compliance (India edition)

GST invoices with CGST, SGST, IGST, cess; reverse charge flag; TDS and MSME fields; e-invoicing (IRN and QR) on paid plans through its own GSP; e-way bill status: paid plans only per its own tax guide, details [?]; GSTR-1 export; filing from inside the product with an approval step. [D]

## Platform

Web app, iOS and Android apps, Chrome extension for time logging, REST API with OAuth, webhooks, Zapier and many integrations, import and export, Tally. [D] Offline use: limited, mobile drafts [?]. Performance, uptime, and infrastructure: [?]. Security: MFA, role permissions, backup. [D]

## Pricing and limits

Free tier: two users, three projects, 500 invoices a year, "Powered by Zoho" branding (India page). Paid plans add users, automation, e-invoicing, custom domain and branding removal. Prices were not visible on pages readable without a session. [D]

## Strengths to respect

Breadth in one product; polished document editor with payment terms, bill-level discount, shipping and adjustment; strong template control; client portal; time tracking; a large ecosystem; a free tier; trust of a known vendor.

## Weaknesses (from reviews and its own docs)

Caps that reset yearly; e-invoicing and e-way bill behind paid tiers; currency cannot be changed while building an invoice; sync lag in GST features; mobile lag; limited template design in the eyes of some users; English-centric. See `complaints.md`.

## What stayed unknown, and why

Real click counts, the exact responsive behaviour of its editor, its database design, its audit and numbering mechanics, its queueing and retry behaviour, and its WhatsApp depth. Each needs an account or traffic we are not entitled to take. They are listed so that no one treats an inference as a fact.
