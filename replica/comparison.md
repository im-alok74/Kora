# Kora against Zoho Invoice, one to one

Date: 20 October 2026. Sources: `bible-zoho.md` (public information, tagged by confidence) and `bible-kora.md` (the code). Verdicts: **Ahead** (Kora does more or does it better), **Par**, **Behind**, **Open** (neither, or Zoho unknown). Where Zoho's side is inferred, the row says so.

## 1. Invoice editor, field by field

| Field or step | Zoho Invoice | Kora | Verdict | Action |
|---|---|---|---|---|
| Customer picker with quick add | Yes | Yes, with inline add and GSTIN check | Par | Done |
| Document number | Auto or manual | Auto, gapless per series and year, by the database | Ahead | Done |
| Order or PO reference | Yes | Yes, on the document, the PDF and the page | Par | Built in this pass |
| Payment terms presets | Due on receipt, net 15, 30, 45, 60, end of month, custom | Same list; fills and follows the due date | Par | Built in this pass |
| Subject line | Yes | Yes, printed under the title | Par | Built in this pass |
| Salesperson | Yes | No | Behind | Defer: staff are in `member`; add only if asked |
| Item description | Name and free text | Name, HSN or SAC, tick for tax-inclusive price | Par | Done |
| Quantity, rate | Yes | Yes | Par | Done |
| Discount per line | Percent or amount | Amount or percent | Par | Built in this pass |
| Discount on the whole bill | Yes | Yes, shared over the lines to the paisa so tax stays correct line by line | Par | Built in this pass |
| Shipping charges | Yes | Button adds a freight line at the highest rate on the bill (SAC 996511) | Par | Built in this pass |
| Adjustment | Free plus or minus | Round-off only | Open | Keep: the law expects a computed round-off, not a free number |
| Tax per line | List | List with intra and inter-state split by place of supply | Ahead | Done |
| TDS and TCS | Selector | Rates, shown with net payable | Par | Done |
| Customer notes and terms | Yes | Yes | Par | Done |
| Attach files | Yes | No | Behind | Defer: needs the files store wired to documents |
| Pick a PDF template | Gallery | Layouts: classic, compact, narrative, thermal; colour, font, language | Par | Gallery with previews later |
| Save draft, issue, send | Yes | Yes, plus offline draft with conflict handling | Ahead | Done |
| Live preview next to the form | Preview after save | Totals live; paper preview after save | Behind | Build later: preview endpoint |
| Currency per document | Not while generating (a known complaint) | Quotes only | Par | Invoices in other currencies need export (LUT) design |
| Custom fields | Yes | No | Behind | Defer: a `custom` jsonb on documents, parties and items |

## 2. Document view

| Aspect | Zoho | Kora | Verdict |
|---|---|---|---|
| Paper beside actions | Yes | Yes, sheet on a neutral canvas | Par |
| Status line and money strip | Status ribbon | Total, received, balance, due date with days late | Ahead |
| Timeline of progress | Activity list | Created, issued, sent, viewed, paid | Par |
| Next-step prompts | Yes | Panels for payment and sending | Par |
| Activity and audit | Activity feed | Append-only audit log nobody can edit | Ahead |
| Clone | Yes | Duplicate as draft | Par |
| Mark as sent, void | Yes | Cancel with reason; sent is a tracked fact | Par |

## 3. Invoice PDF

| Aspect | Zoho | Kora | Verdict |
|---|---|---|---|
| Layout blocks | Logo, parties, items, totals, notes | Same, plus meta strip, tax summary by HSN, amount in words, UPI card | Par to ahead |
| Locked statutory fields | Not stated | Printed from code, template cannot remove them | Ahead |
| Languages | 10+ | English, Hindi, Marathi, Gujarati | Behind in count, ahead in Indian scripts |
| IRN and QR | Paid plans | Printed when registered | Par |
| Thermal receipt | No | Yes, 80 mm | Ahead |

## 4. Customers, items, stock

| Area | Zoho | Kora | Verdict |
|---|---|---|---|
| Customer detail page with history, statement | Yes | Yes, overview with ageing | Par |
| Portal | Account-based | Private link, no account | Par (different) |
| Item master | SKU, tax, custom fields | HSN or SAC, tax, stock, barcode, reorder, network listing | Ahead on stock, behind on custom fields |
| Inventory | Separate product | Built in with triggers | Ahead |

## 5. Money in

| Area | Zoho | Kora | Verdict |
|---|---|---|---|
| Record payment, partial | Yes | Yes | Par |
| Payment links and gateways | Many gateways | Razorpay adapter, UPI QR on every document | Behind on breadth, ahead on UPI |
| Reminders | Email, SMS | WhatsApp, SMS, email on a schedule | Par |
| Late fees | Not stated | Debit note drafts | Ahead |
| Retainer invoices | Yes | No | Behind |
| Sales receipts | Yes | Till covers shops; no general receipt | Behind |
| Refunds and credit notes | Yes | Credit notes applied against invoices | Par |

## 6. Recurring, estimates, challans

Zoho and Kora both have recurring profiles, estimates (quotes) with conversion, and delivery challans. Kora adds the estimate expiry state machine and conversion-once guarantee. Par to ahead.

## 7. Compliance

| Area | Zoho | Kora | Verdict |
|---|---|---|---|
| E-invoice | Own GSP, paid plans | Partner adapter with retry; live partner not connected | Behind until the partner is connected |
| E-way bill | Paid plans | Table exists; generation not built | Behind |
| GSTR-1, 3B | Export and filing with approval | Export, summary, 3B including table 4 | Par without filing |
| Input credit and GSTR-2B matching | Billing product dependent | Built | Ahead |
| TDS | Yes | Yes | Par |

## 8. Segments Zoho does not serve in one product

CA firm multi-client screen and inbox, lawyer matters with trust accounting, shop till with barcodes, B2B network. **Ahead** on all.

## 9. Platform

| Area | Zoho | Kora | Verdict |
|---|---|---|---|
| API and webhooks | REST with OAuth | JSON API with keys, signed retrying webhooks, OpenAPI | Par; OAuth missing |
| Integrations | Large ecosystem | Tally export, import, API | Behind |
| Mobile | Native apps | Installable offline-first web app | Behind on native, ahead on offline drafts |
| Roles | Yes | Enforced in the database | Ahead on enforcement |
| Security | MFA | MFA, recovery codes, device list, security log | Par |

## 10. Database and engineering (Zoho side unknown)

Zoho's schema, audit and tenancy are [?]. Kora's: row-level security on every tenant table, triggers for numbering, totals check and immutability, append-only audit, integer paise, 56 tables, encrypted backups with restore check. We do not claim to be better than a system we cannot see; we claim these properties are tested here.

## 11. Ranked list of what to build next

1. Order or PO reference, subject line, payment terms presets (small, visible, every invoice).
2. Discount on the whole bill (spread over lines to the paisa) and a percent option per line.
3. Shipping charge helper.
4. Duplicate as draft.
5. Custom fields on documents, customers and items.
6. Attach files to a document.
7. Live paper preview in the editor.
8. Retainer invoices and general sales receipts.
9. Template gallery with previews.
10. E-way bill generation; live GST partner connection (needs credentials).

Items 1 to 4 are built (20 October 2026), with unit, PDF and browser tests. The rest are listed so the next pass starts from facts.
