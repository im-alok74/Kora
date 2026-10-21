# Zoho Invoice feature parity — inventory and gap analysis

**Source:** Zoho Invoice API v3 reference (`zoho.com/in/invoice/api/v3/`), scraped 2026-10-21.
271 documented operations across 21 functional modules. The API reference is used rather than
the marketing page because it enumerates every entity and operation, not just the sellable ones.

**Compared against:** Kora at commit `c477eb1`, by reading `packages/db/migrations/*.sql`,
`packages/core/src/*.ts` and `apps/web/app/`. Every "have"/"gap" below is grounded in a file,
not an assumption.

---

## 1. Zoho's module inventory (operation counts)

| Module | Ops | Module | Ops |
|---|---|---|---|
| invoices | 40 | currency | 11 |
| credit-notes | 26 | users | 10 |
| projects | 24 | time-entries | 10 |
| estimates | 23 | recurring-invoices | 10 |
| contacts | 23 | recurring-expenses | 10 |
| retainer-invoices | 21 | items | 10 |
| taxes | 18 | expenses | 10 |
| customer-payments | 12 | expense-category | 8 |
| | | contact-persons | 7 |
| | | price-lists | 6 |
| | | organizations | 5 |
| | | integration (CRM) | 4 |

---

## 2. Where Kora already matches or beats Zoho

| Capability | Kora evidence |
|---|---|
| Invoices, credit/debit notes, estimates, proforma, delivery challan | `document.doc_type` (7 types), `packages/core/src/documents.ts` |
| Draft → issued → cancelled lifecycle, immutable snapshots at issue | `document.status`, `supplier_snapshot`/`recipient_snapshot` |
| Customer payments + allocation + refunds | `payment`, `payment_allocation`, `payment_refund`, `payments.ts`, `credit.ts` |
| Recurring invoices | `recurring_profile`, `recurring_schedule`, `recurring_run`, `recurring.ts` |
| Estimates with accept/decline state | `estimate_state`, `estimates.ts` |
| Expenses + receipts | `expense`, `expense_receipt`, `expenses.ts` |
| Projects & matters: time entries, fixed fees, expenses, advances, invoice-from-entries | `matter`, `matter_entry`, `client_fund_entry`, `matters.ts` |
| Items | `item`, `items.ts` |
| Multi-currency on documents | `document.currency`, `exchange_rate_micro` |
| Users, roles, permissions | `app_user`, `member`, `team.ts`, `permissions.ts` |
| Organizations | `business`, `business.ts` |
| Client portal + payment links | `portal_link`, `payment_link`, `portal.ts` |
| Reminders, delivery, message templates | `reminder`, `delivery`, `message_templates` (0029), `reminders.ts` |
| Document templates | `document_template`, `template.ts` |
| Comments & history | `document_comment`, `comments.ts` |
| Attachments / file storage | `document_file`, `attachments.ts`, `blobs.ts` |
| API keys + webhooks | `api_key`, `webhook_endpoint`, `webhook_event`, `webhook_delivery` |

**Beyond Zoho Invoice (India compliance depth Zoho puts in Books, not Invoice):**
e-invoice/IRN (`einvoice`), e-way bill (`eway_bill`), GSTR returns (`gstr`), ITC, TDS/TCS fields
on every document, reverse charge, place-of-supply validation, GSTIN validation,
number series per financial year, Tally import, bank statement import, POS, stock movements,
offline invoicing, audit log, data export/erasure.

---

## 3. Confirmed gaps

Ordered by how much a paying Indian SMB would miss them.

### Tier 1 — real holes in a billing product

| # | Gap | Zoho ops | Why it matters | Touches |
|---|---|---|---|---|
| G1 | **Contact persons** — a customer has one `phone`/`email`. No multiple named contacts, no primary flag. | 7 | Any company customer has AP + procurement + a signatory. Invoices go to the wrong inbox. | DB, BE, FE |
| G2 | **Multiple addresses per contact** — `party` has exactly one `billing_address` + one `shipping_address`. | 4 | Multi-branch customers; ship-to differs per order. | DB, BE, FE |
| G3 | **Customer statement of account** — no statement generation or emailing. | 2 | The single most-requested collections artifact. | BE, FE |
| G4 | **Write-off invoice / cancel write-off** — no way to write off a bad debt. | 2 | Today the only exit is `cancelled`, which is wrong accounting. | DB, BE, FE |
| G5 | **Void vs cancel** — `status` is only `draft/issued/cancelled`; no void, no re-open a voided doc. | 3 | Zoho distinguishes void (number burnt, kept) from delete. Kora conflates. | DB, BE |
| G6 | **Recurring expenses** — `recurring_profile` drives invoices only. | 10 | Rent, SaaS subscriptions, retainers paid out. | DB, BE, FE |
| G7 | **Price lists** — no entity at all. Per-customer/volume pricing is manual. | 6 | Standard for wholesale and tiered B2B. | DB, BE, FE |

### Tier 2 — expected in a mature product

| # | Gap | Zoho ops | Notes | Touches |
|---|---|---|---|---|
| G8 | **Retainer invoices** as a first-class doc type. Advances exist for matters/projects (`client_fund_entry`) but you cannot issue and email a standalone retainer invoice against a customer balance. | 21 | Partial coverage, not parity. | DB, BE, FE |
| G9 | **Expense categories as an entity** — `expense.category` is free text (`expenses.ts:9` says so). No CRUD, no active/inactive. | 8 | Breaks expense reporting consistency. | DB, BE, FE |
| G10 | **Tax groups, tax authorities, tax exemptions** — `tax_rate` is a flat global table (`rate_bp`, `label`, `active`), not per-business. | 18 | Kora hardcodes GST slabs. Fine for GST, blocks exemption handling. | DB, BE |
| G11 | **Exchange rate management** — documents store `exchange_rate_micro` but there is no rate table, history, or CRUD. | 11 | Rates are entered per-invoice by hand. | DB, BE, FE |
| G12 | **Timer (start/stop)** — `matter_entry.minutes` is logged after the fact; no running timer. | 3 | Table-stakes for hourly billing. | DB, BE, FE |
| G13 | **Project tasks, per-project user assignment/invite, clone project** — `matter` has no task breakdown or member list. | 9 | Projects are currently a flat bucket of entries. | DB, BE, FE |
| G14 | **Bulk export / bulk print / bulk email** of invoices and estimates. | 6 | Month-end workflow. | BE, FE |

### Tier 3 — nice to have

| # | Gap | Zoho ops | Notes |
|---|---|---|---|
| G15 | Client reviews in the portal (view, reply) | 3 | Low value for Indian SMB billing. |
| G16 | CRM integration (import customer/item by CRM id) | 4 | Only meaningful with a Zoho CRM equivalent. |
| G17 | Per-contact reminder enable/disable toggle | 2 | Reminders exist; the per-contact switch does not. |
| G18 | Mark contact / item active-inactive | 4 | `party.archived_at` partially covers this. |

---

## 4. Suggested build order

Each row is one shippable slice: migration + core module + API route + page.

1. **G1 + G2 contacts** — one migration (`contact_person`, `party_address`), one core module, extend the customer page. Unblocks G3.
2. **G3 statements** — read-only; pure reporting on existing `document`/`payment`.
3. **G4 + G5 invoice lifecycle** — one migration adding `written_off`/`void` to the status check plus `write_off_paise`; touches `documents.ts` and the invoice page.
4. **G9 expense categories** then **G6 recurring expenses** — G6 depends on G9.
5. **G7 price lists** — new entity + hook into the invoice line pricing path.
6. **G11 exchange rates** — new table + a resolver in `documents.ts`.
7. **G12 + G13 projects/time** — extends the existing `matter` engine.
8. **G14 bulk operations** — needs the PDF path to be batchable first.
9. **G8 retainer invoices** — largest; defer until the lifecycle work (G4/G5) lands.

Tier 3 is not recommended for this product.

---

## 5. Honest scope note

271 Zoho operations is not a sprint. The 14 Tier 1+2 gaps are roughly 14 migrations,
14 core modules, ~40 API routes and ~14 pages. Kora already covers the invoicing core and
exceeds Zoho on Indian GST compliance; the gaps are breadth, not foundations.
