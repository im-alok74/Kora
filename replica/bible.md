# Invoice SaaS Product Bible

Oct 18, 2026 · @Alok Sharma

The plan is a GST-first invoicing and billing SaaS for Indian small businesses that matches Zoho Invoice on breadth and beats it on compliance depth, collection speed and price clarity.

## Method and ground rules

Everything here comes from public pages: Zoho's feature and help pages, India pricing write-ups, MyBillBook listings on Capterra and GetApp, SAG Infotech's own site, and government e-invoicing guides. Facts are as of 18 October 2026.

No app was decompiled. Zoho Invoice is a hosted web product, so Ghidra or JADX would only hand us its code, and the code is neither useful nor ours to copy. What we need is the feature set, the flows and the complaints, and those are public. The build follows clean-room rules: we copy what an app does, never its code, copy, icons, templates or brand.

Where sources disagree, this document says so instead of picking one. The clearest case is Zoho's free-plan cap, which one source puts at 500 invoices a year and another at 1,000, while Zoho itself says the limits change every year.

## Competitor teardown

The three products serve three different buyers, which is why none of them covers the whole market. Zoho Invoice is a free, global freelancer tool. MyBillBook is a mobile-first counter-billing app for shops. SAG Infotech sells desktop GST software to chartered accountants.

| Product | Core buyer | Pricing | Invoicing and sales | India compliance | Limits users hit |
|---|---|---|---|---|---|
| Zoho Invoice | Freelancers, small service firms | Free plan; more volume means moving to Zoho Billing or Books | Templates, 10+ languages, recurring invoices, estimates, retainers, credit notes, client portal, time and project billing, 10+ payment gateways, 30+ reports, REST API | GST and TDS supported; e-invoicing and e-way bill not in the free India edition | Yearly invoice cap, 2 users and 3 projects on free India plan (per one review site); no currency change while generating an invoice; no phone support |
| MyBillBook | Shops, traders, distributors | Paid plans from Rs 199 a month on one listing and Rs 399 a year on another | GST and non-GST bills, quotes, proforma, delivery challans, WhatsApp, email and SMS sharing, themes, custom fields | e-invoice and e-way bill in one click, GSTR-1 reconciliation and JSON export | Weak for subscription billing; one reviewer reports settings resetting after an app update; best features sit on top plans |
| SAG Infotech Gen GST | Chartered accountants and tax professionals | One-time installation fee plus yearly updation fee (Rs 5,000 plus Rs 2,000 for Gen GST; Rs 15,000 plus Rs 7,000 for All In One) | Billing, digital signature on invoices, import and export of JSON | GSTR-1, 3B, 9 and others, e-invoice with IRN, bulk e-way bills, ITC register | Desktop-first, installation and demo process, built for professionals rather than business owners |

MyBillBook's own pages claim more than 1 crore businesses use it and show a 4.4 out of 5 average on Capterra. Zoho Invoice shows 4.7 out of 5 on G2. These are vendor-reported or review-site figures, so treat them as signals of satisfaction, not market share.

## Where Zoho Invoice is weak

Zoho wins on breadth and price, so we will not beat it by listing more features. We beat it where its own users and its India edition leave gaps. The first seven rows below come from user reviews and Zoho's own tax documentation; the last two are our bets and need customer interviews before they are promised.

| Gap | Evidence | Our answer |
|---|---|---|
| E-invoicing and e-way bill missing on the free India edition | Zoho's tax guide states both are unsupported in the free version | Ship IRN, QR and e-way bill on the first paid tier, priced flat |
| Annual invoice, user and project caps | Zoho's help page says limits reset yearly; one review site lists 500 invoices, 2 users, 3 projects for India | No invoice cap on any plan; limits only on businesses and seats |
| Cannot change currency while creating an invoice | Repeated G2 complaint | Currency and exchange rate editable per document, with RBI-style rate source noted on the invoice |
| Limited template design | G2 reviewers cite few design options | A real template editor with brand colours, logo, layout blocks and GST-compliant locked fields |
| Slow GST sync and laggy mobile app | G2 reviewers mention both | Background queue with a visible status per invoice; offline-first mobile app |
| No offline desktop option for patchy connectivity | G2 reviewer from a rural area | Installable web app that saves drafts offline and syncs when back online |
| Few local payment options | One review calls payment integrations limited | UPI-first collection: dynamic UPI QR on every invoice, payment link, automatic reconciliation |
| Email-only reminders | Hypothesis; MyBillBook already shares by WhatsApp | WhatsApp-first sending and reminders with delivery status |
| English-centric interface | Hypothesis | Hindi and regional-language interface and invoice output from v2 |

## Product scope

Version 1 has to produce a legally correct GST invoice, get it to the customer on WhatsApp, and let the customer pay by UPI. Everything else is sequenced behind that. Full double-entry accounting, payroll and acting as a GST Suvidha Provider are out of scope for the first year, because each is a product of its own.

| Module | Capability | Priority | Release |
|---|---|---|---|
| Documents | Tax invoice, bill of supply, estimate, proforma, delivery challan, credit note, debit note | Must | v1 |
| Parties and items | Customers, vendors, item master with HSN or SAC, GSTIN validation, place of supply | Must | v1 |
| Numbering and templates | Series per financial year, no gaps, template editor with locked statutory fields | Must | v1 |
| Delivery | PDF, WhatsApp, email, SMS, public invoice link with view tracking | Must | v1 |
| Collections | Dynamic UPI QR, payment link, partial payments, automatic reconciliation, reminders, late fee | Must | v1 |
| Compliance | GST calculation (CGST, SGST, IGST, cess), e-invoice IRN and QR, TDS and TCS fields | Must | v1 |
| E-way bill | Generate from an invoice, bulk generate, extend and cancel | Should | v1.5 |
| Reports | Sales, receivables ageing, GST summary, GSTR-1 JSON export | Must | v1 |
| Team and roles | Owner, staff, accountant seat with read and export rights | Should | v1 |
| Multi-business and currency | Several GSTINs per owner, per-document currency | Should | v1.5 |
| Recurring billing | Schedules, auto-send, auto-collect with mandates | Should | v2 |
| Client portal | Statements, pay, accept estimates, download documents | Should | v2 |
| Inventory | Stock, godowns, batches, serials, barcodes, low-stock alerts | Should | v2 |
| Expenses and purchases | Bills, expenses, receipt capture, input tax credit view | Should | v2 |
| Integrations | Tally and Excel import and export, public API and webhooks | Should | v2 |
| Time and projects | Billable hours and project billing | Could | v3 |
| POS and online store | Counter billing, barcode scan, simple storefront | Could | v3 |
| AI assist | Invoice from a WhatsApp message or photo, HSN suggestions, late-payment risk | Could | v3 |

## India compliance

Compliance is the real moat in this market, because a wrong invoice is a legal problem for the customer and not just a bad experience. The product must make the legal path the easy path.

| Obligation | What the system must do |
|---|---|
| GST invoice content | Enforce supplier and recipient GSTIN, HSN or SAC, place of supply, tax breakup and sequential numbering before an invoice can be issued |
| Tax split | Pick CGST plus SGST or IGST from place of supply automatically; show cess where it applies |
| Exempt supplies | Issue a bill of supply, not a tax invoice, when the supply is fully exempt |
| E-invoicing | Above Rs 5 crore aggregate turnover, send the invoice JSON to the Invoice Registration Portal and store the returned IRN, signed data and QR code on the document |
| Threshold memory | The Rs 5 crore rule counts turnover in any year since FY 2017-18, so a business that dipped below it may still be covered; ask at onboarding and let the owner override |
| Rejections | The IRP rejects rounding differences and missing fields, so validate the schema and recompute totals before submitting |
| Cancellation | The IRP allows cancellation for a short window only (24 hours per one guide); after that the product must steer the user to a credit note |
| E-way bill | Generate from the e-invoice data where it applies, with bulk generation, extension and cancellation |
| Returns | Export GSTR-1 JSON and a GSTR-3B summary; reconcile against the portal's purchase data in v2 |
| Portal security | Multi-factor login became mandatory on the IRP and e-way bill portals from 1 April 2026, so never design around storing a taxpayer's portal password |

The integration choice for version 1 is a GST Suvidha Provider partner API instead of a direct IRP connection. A direct connection needs registered credentials, IP whitelisting and sandbox certification per setup, and one guide puts it at 500 or more invoices a month before it pays off. A partner gets us to market sooner and can be swapped out later behind an adapter interface. This is a recommendation, and the partner, its per-invoice fee and its uptime record still need to be checked.

The threshold may keep falling; commentary points to a possible cut below Rs 5 crore, so the e-invoice module must be switchable per business and never hard-coded to one number.

## Architecture and stack

One deployable web app, one Postgres database and one background worker is enough for the first year. Splitting into services earlier would add failure modes without adding speed.

| Layer | Choice | Why |
|---|---|---|
| App | Next.js with TypeScript | One codebase for the marketing site, the dashboard and the public invoice page; server rendering keeps the pay page fast on cheap phones |
| Database | Managed Postgres | Invoices need transactions, constraints and row-level security; a document store gives none of that for free |
| Tenancy | Shared schema, business_id on every row, Postgres row-level security | Cheapest to run, and the database itself refuses cross-tenant reads if application code slips |
| Money | Integer paise in bigint, tax computed in one shared library | Floating point rounding differences are rejected by the IRP, so totals must be exact and reproducible |
| Background jobs | Postgres-backed queue such as pg-boss | A job is queued in the same transaction that issues the invoice, so an invoice is never issued without its e-invoice, reminder or WhatsApp job |
| PDF | HTML templates rendered by headless Chromium | The template editor and the PDF share one layout engine, so what the user designs is what prints |
| Files | S3-compatible object storage | Invoice PDFs, logos and receipts; signed URLs for sharing |
| Payments | Razorpay or Cashfree behind an adapter | UPI QR, payment links and webhooks; the adapter keeps a second gateway one afternoon of work |
| Messaging | WhatsApp Business Cloud API through a provider, SMS via a DLT-registered sender, email through a transactional provider | WhatsApp is the main delivery channel in India; SMS needs DLT template approval, so start that registration early |
| GST connector | Adapter interface over a GSP partner API | Lets us start with a partner and move to direct IRP access without touching the invoice code |
| Auth | Phone or email OTP, then passkeys | Small-business owners rarely manage passwords well; OTP matches how they already log in to banking apps |
| Mobile | Installable web app with offline drafts first, native later | Ships once for all devices, and offline drafts answer a real review complaint about patchy connectivity |
| Audit | Append-only audit log, issued invoices immutable | Corrections happen through credit and debit notes, which is also what GST law expects |

The two hardest design rules are the shared tax library and the immutability of issued documents. Get those wrong and the damage is slow to notice and costly to repair.

## Data model

The schema is built so that the database, not the application, stops an illegal invoice from existing. Every table carries business_id and a row-level security policy on it.

| Table | Holds | Constraint that matters |
|---|---|---|
| business | Legal name, GSTIN, state, turnover band, e-invoice flag | One owner at minimum; GSTIN format check |
| member | User, business, role (owner, staff, accountant) | Unique per user and business |
| party | Customer or vendor, GSTIN, billing and shipping address, state | GSTIN validated by pattern and checksum |
| item | Name, HSN or SAC, unit, default tax rate, price | Tax rate from an allowed list, not free text |
| number_series | Document type, prefix, financial year, last number | Row lock on issue so numbers stay sequential; length limited to what GST rules allow (16 characters) |
| document | Type, number, status, dates, currency, place of supply, reverse-charge flag, totals in paise | Unique on business, series and number; totals must equal the sum of lines |
| document_line | Item snapshot, quantity, rate, discount, taxable value, tax amounts | Snapshot copied at issue, so later item edits never change history |
| payment | Amount, method, gateway reference, received date | Unique on gateway and event id, which makes webhooks idempotent |
| payment_allocation | Payment to document, amount | Sum of allocations cannot exceed either the payment or the document total |
| einvoice | IRN, acknowledgement number and date, signed JSON, QR, status, error | One live record per document; cancellation window tracked |
| eway_bill | Number, validity, vehicle details, status | Linked to a document that is already issued |
| recurring_schedule | Template document, interval, next run, mandate | Next run computed in the business's time zone |
| reminder | Document, channel, scheduled time, delivery status | Stops automatically once the document is paid |
| audit_log | Actor, action, before and after, time | Append-only; no update or delete permission for the app role |

Once a document moves from draft to issued, a trigger blocks any change to its numbers, lines and totals. A mistake is fixed with a credit note that points back to the original, and a new invoice is raised if needed. That one rule removes a whole class of audit trouble.

## Key flows

These four flows decide whether the product feels faster than Zoho. The target for the first is under 60 seconds from opening the app to a sent invoice.

### Create and send an invoice

- Pick or add a customer; GSTIN lookup fills name, address and state.

- Add items; HSN, rate and tax split fill from the item master and place of supply.

- Review the totals and the live preview, then issue. Numbering and validation run in one transaction.

- If the business is e-invoice enabled, the document waits in a visible "registering" state until the IRN and QR return, then the PDF is regenerated with them.

- Send by WhatsApp, email or link; the public page records views.

### Collect payment

- The invoice carries a UPI QR and a pay button that opens a gateway page.

- The gateway webhook arrives and is deduplicated on its event id.

- The payment is allocated to the document; the status moves to paid or part paid.

- Pending reminders for that document are cancelled and the owner gets a notification.

### E-invoice failure handling

- A rejection from the IRP is stored with its error code and shown in plain words.

- The user fixes the field, usually a GSTIN, a rate or a total, and resubmits from the same screen.

- If the portal is down, the job retries with backoff and the owner is told the invoice is not yet legally complete.

### Recurring billing

- The owner turns an invoice into a schedule with an interval, a start date and a send mode.

- A scheduler creates a draft or issues directly at the business's local midnight.

- Failed sends and failed e-invoices land in one exceptions list so nothing is silently skipped.

## Pricing and packaging

The market sets two anchors. Zoho Books has a permanent free tier and paid plans that climb to Rs 9,999 a month, all excluding 18 percent GST. MyBillBook starts under Rs 400 a year on one listing and Rs 199 a month on another, with e-invoicing and e-way bills reserved for higher plans. We should price for the shop owner who needs e-invoicing without paying for an accounting suite.

The tiers below are starting hypotheses, not decisions. They need a cost model first, because three costs scale with usage and are paid to others: the per-invoice fee of the GST partner, WhatsApp message fees, and gateway charges on payments.

| Plan | Hypothesis price per month, excl. GST | Includes | Deliberate limits |
|---|---|---|---|
| Free | Rs 0 | Unlimited GST invoices, UPI QR, public pay link, GSTR-1 export, 1 user, 1 business | Our branding on the public link; no e-invoice; no WhatsApp automation |
| Business | About Rs 399 | Everything in Free, e-invoice and e-way bill (bundled monthly allowance), WhatsApp sending and reminders, recurring invoices, template editor, 3 users | Allowance on e-invoices and WhatsApp, with pass-through pricing beyond it |
| Pro | About Rs 999 | Everything in Business, inventory, multiple businesses, accountant seats, API and webhooks, larger allowances | Fair-use on messages |

Two rules keep the promise clear. We never cap the number of invoices, because that cap is a stated pain point on Zoho's free plan. And every metered cost is shown in the app as a plain counter, so the bill is never a surprise.

A note on UPI economics: a trade news item on SAG Infotech's site reports that NPCI has postponed merchant discount rates on some UPI payments to after Diwali, with a rollout expected in the second week of November. If that goes ahead it changes who pays for collection, so keep payment fees out of the plan price and pass them through.

## Roadmap and build order

The order follows risk: prove the tax logic first, then the invoice, then the money, then the government connection. Weeks are counted from the start of work and assume one to three builders; they are estimates to adjust once the team is fixed.

| Phase | Weeks | What gets built | Gate to leave the phase |
|---|---|---|---|
| 0. Foundations | 1 to 2 | Auth, tenancy with row-level security, schema, the shared tax library with a large test suite of GST cases | Tax library passes every case, including mixed rates and inter-state supply |
| 1. Core invoicing | 3 to 6 | Parties, items, documents, numbering, template editor, PDF, WhatsApp, email and link sharing, offline drafts | A new user issues and sends an invoice in under 60 seconds |
| 2. Collections | 7 to 9 | UPI QR, payment links, webhooks, allocation, reminders, receivables ageing | Test payments reconcile with no manual steps |
| 3. Compliance | 10 to 13 | E-invoice through the partner sandbox, GSTR-1 export, GST summary, error handling | A batch of sandbox invoices registers with no rejections caused by our totals |
| 4. Closed beta | 14 to 17 | 10 to 20 real businesses and two or three CAs; support loop; fix list | Beta users issue real invoices weekly and would be unhappy to lose the product |
| 5. Public launch (v1) | 18 | Pricing live, onboarding, help centre | Support load per business is manageable |
| v1.5 | After launch | E-way bill, multi-business, per-document currency | Driven by beta requests |
| v2 | Months 6 to 9 | Recurring billing, client portal, inventory, expenses, Tally and Excel import and export, API | Retention of paid plans |
| v3 | Months 10 to 14 | Time and projects, POS, AI assist, regional languages | Demand from paying users |

The closed beta is the most important gate. Compliance bugs only appear on real invoices, and CAs are the people who will find them.

## Risks, open questions and sources

### Risks

- Compliance errors. A bad tax calculation hurts the customer. Mitigation: one shared tax library, a large test suite, review by a practising CA before beta, and clear in-app wording that the owner remains responsible for filings.

- Partner dependency. The GST partner controls e-invoice cost and uptime. Mitigation: the adapter interface, retries with backoff, and a second partner evaluated before launch.

- Metered costs. WhatsApp, e-invoice and gateway fees scale with usage. Mitigation: pass-through pricing and visible counters.

- Competitor response. Zoho can add e-invoicing to its free tier at any time. Our defence is speed, WhatsApp and UPI depth, and support in Indian languages, not a single feature.

- Copying risk. We reproduce functions, not Zoho's templates, wording, icons or code. The product needs its own name and design language.

- Data protection. Customer GSTINs and addresses are personal or business data held for others. Check current Indian data protection rules with a lawyer before launch.

### Open questions

- Which buyer comes first: service freelancers, shop owners, or businesses led by their CA? The answer changes the onboarding and the first integrations.

- How many builders, and over what period? The roadmap weeks assume one to three.

- What is the product name? A working name is enough for the build, but the trademark and domain checks should start now.

- Which GST partner will be used, and what does it charge per e-invoice?

- Do you want the REA reverse-engineering tool used later on your own test account of a competitor, with its owner's terms in mind? It was not installed here because its setup edits agent configuration files.

### Sources

Figures marked in this document come from these pages. Only SAG Infotech's home page was opened in full; the others were read as search results, so confirm prices and limits on the live pages before relying on them. As of 18 October 2026.

- Zoho Invoice features

- Zoho Invoice free invoice limits

- Zoho tax systems and the free India edition

- Zoho Invoice reviews on G2

- Zoho Invoice review by Merchant Maverick

- Zoho Invoice alternatives for Indian freelancers, Skydo

- Zoho Books pricing in India 2026

- Zoho Books GST guide

- myBillBook on GetApp

- myBillBook on Capterra

- myBillBook on FitGap

- SAG Infotech

- E-invoicing threshold limit in India, Tally

- GST e-invoicing implementation guide

- E-invoicing rules 2026 checklist

- How to generate an e-invoice, 2026 guide

- E-invoicing under GST, Motilal Oswal
