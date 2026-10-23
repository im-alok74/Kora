# Compliance: what Kora does and does not do for GST

Kora is software that helps a business issue correct GST documents and prepare data for its returns. **The owner remains responsible for the accuracy of every invoice and for all filings.** This page says what the software does, what it does not, and what a practising CA must confirm before the first real invoice.

Nothing in this document is legal or tax advice. Rates, thresholds and portal rules change, and several values below are starting points marked for CA review.

## What Kora does

### Invoice content and numbering
- Will not issue a tax invoice without the supplier's GSTIN, a place of supply, the HSN or SAC where required, and a tax breakup that matches its lines. The database refuses the issue otherwise.
- Numbers are assigned by the database at the moment of issue, in sequence, per document type and financial year (1 April to 31 March). A failed or rolled-back issue never uses up a number. Prefix and number together are at most 16 characters, using letters, digits, `/` and `-`.
- A cancelled document keeps its number. Gaps are therefore always explained by a visible cancelled document.
- An issued document cannot be edited or deleted. The database blocks it. Corrections are credit notes and debit notes that point at the original; a credit note cannot take back more than the original holds.
- Statutory fields on the printed document (supplier and recipient, number, date, place of supply, HSN or SAC, quantity, rate, discount, taxable value, tax breakup, total, reverse-charge statement, IRN and QR) are printed by code. The template editor cannot hide, move or rename them.
- The recipient and supplier details at the time of issue are copied onto the document, so later edits to a customer never change history.

### Tax calculation
One library computes everything, in integer paise, with these rules:
- Intra-state supply charges CGST and SGST (equal halves of the rate); inter-state supply charges IGST.
- Place of supply for goods is the ship-to state, otherwise the bill-to state. For services it is the recipient's registered state.
- Tax is rounded per line (half up) and then added up. The invoice total is rounded to the nearest rupee, and never rounded to zero.
- Cess is supported as a percentage of taxable value. Per-unit cess is refused, not ignored.
- Reverse charge shows the tax but leaves it out of the amount due.
- TDS reduces what the customer pays, not the invoice. TCS is added using the rate the user supplies.
- A composition dealer can issue a bill of supply but not a tax invoice. An unregistered business cannot issue a tax invoice. An invoice with every line at 0% is flagged as a possible bill of supply.

### E-invoicing
- Kora sends the IRP e-invoice JSON to a GST Suvidha Provider partner, stores the IRN, acknowledgement number and date, and signed QR, and prints the IRN and QR on the invoice and PDF.
- Before sending, Kora checks the details the portal requires (addresses, pincodes, GSTINs, HSN, number format) and says in plain words what to fix and where. It proves that the item totals add up to the invoice total, the rule rounding differences break.
- If the portal is down, registration is retried with growing delays, and the invoice shows that it is not yet legally complete. After repeated failures it is marked failed and can be resubmitted.
- If the portal rejects the invoice, the reason is shown with a fix. The buyer's GSTIN (within the same state), name and address can be corrected on the same screen, and the invoice resubmitted. The state cannot change, because that changes the tax.
- An e-invoice can be cancelled within 24 hours. After that, Kora steers to a credit note.
- Whether e-invoicing applies is the owner's decision, recorded in Settings. The question asked is whether turnover has been above Rs 5 crore in any year since 2017-18, because a business that dipped below can still be covered. The threshold lives in configuration and is not hard-coded.

### Estimates and recurring invoices
- An estimate is not a tax document. Accepting or declining it, and turning it into an invoice, never changes the estimate; the invoice is a new draft that is numbered only when issued.
- A recurring invoice set to issue automatically issues a real tax invoice on each date, with the next number in sequence, and queues its e-invoice if one is required. The owner is responsible for what the template says. Draft mode leaves each invoice for review first.
- Each scheduled date makes at most one invoice, even if two workers run at once or the worker was down and catches up.

### Data export, import and integrations
- A full backup, an Excel workbook and a Tally file are available to the owner and the accountant. Each one is recorded (who, what, how many rows). Staff cannot take the business's data out.
- Imports of customers and items add new records only. Every row is checked as if it had been typed in, rows that already exist are skipped, and nothing is changed or deleted. Old invoices are imported only as **drafts**: the old invoice number is kept as a reference, the draft gets a Kora number when the owner issues it, and importing the same file twice does not repeat the drafts. An import can never create or alter an issued document.
- API keys act as staff (write) or accountant (read) and can never cancel, change settings or manage people. Issued documents stay immutable through the API; corrections are still credit and debit notes. Whatever totals a caller sends are ignored: Kora always works them out.
- Webhooks carry identifiers and amounts, signed with the endpoint's secret. They are sent only to public addresses.
- The Tally file follows Tally's import format as understood, and has not been tried against a live Tally. An accountant should check it in a test company.

### Late fees
- Kora never adds a late fee by itself. With late fees switched on, an overdue invoice shows what has built up (a percentage a month, pro rata by the day, or a flat amount once, after the grace days) and offers a draft debit note that points at the invoice. The owner reads it and issues it like any other debit note, with its own number.
- The fee carries GST at the rate the owner chooses (18% by default) under SAC 999799. Whether GST applies to a late payment charge, and under which code, is for the owner's CA to confirm.
- Days already charged are never charged again. Deleting an unissued late fee draft frees those days. Late fees need a regular GST registration, because the debit note does.

### Quotes in other currencies
- Estimates and proforma invoices can be in USD, EUR, GBP, AED, SGD, AUD or CAD, at an exchange rate the owner enters. They are not tax documents and carry no rupee rounding. The PDF says so and shows the rate used.
- A tax invoice, bill of supply or credit and debit note is always in rupees, and the database refuses anything else. Converting a quote to an invoice turns each line into rupees at the quoted rate, rounded to the paisa.
- Export invoices are still not supported. A quote to a customer outside India can be made, but it cannot be turned into an invoice, and a quote in rupees to such a customer is refused with the same message.

### Expenses
- Expenses are the owner's own record: date, vendor, category, amount paid, the GST inside it, and how it was paid. They do not feed the GST summary or GSTR-3B, and Kora does not claim input tax credit.
- A receipt (JPEG, PNG or PDF, up to 2 MB) is stored with the expense after its first bytes are checked against what the file claims to be. Receipts are kept apart from the audit log so file contents never appear there.

### Client portal
- Each customer can have one private link. It shows only that customer's issued invoices, estimates, payments and statement, lets them pay and answer estimates, and opens their documents through short-lived public links. It never shows drafts, other customers, or the business's reports.
- The link's token is long and random and only its hash is stored. The business can make a new link (the old one stops) or stop it at any time. Anyone who has the link can open it, so the page says so; it is not a login.
- An estimate answered from the portal is recorded as answered by the customer, with no staff user attached, and appears in the activity log as an automatic action.

### Returns data
- **GSTR-1 JSON** for a month: B2B, B2CL, B2CS, credit and debit notes (registered and unregistered), nil and exempt supplies, HSN summary, and the document series summary. Kora proves that the sections add up to the sales ledger to the paisa and warns if they do not.
- **GST summary** laid out like GSTR-3B table 3.1 (outward supplies), net of credit notes, with reverse-charge, nil-rated and exempt supplies shown apart.
- **GSTR-3B data**: tables 3.1 and 3.2 from the invoices, and table 4 (input tax credit) from the purchase bills the owner has recorded, as screen tables and as a JSON file in the shape of the offline tool. Inward supplies exempt or nil-rated (5) and interest and late fee (5.1) are left empty. The file layout has not been checked against the current offline utility, and a CA must check it before it is used.
- **TCS and TDS** are entered as percentages on an invoice. TCS is added to the total (on taxable value plus tax). TDS is not part of the total: it is shown as what the customer will deduct, and recorded as a payment of method TDS when it arrives, so the invoice closes. Whether TCS or TDS applies, and at what rate, is the owner's decision; Kora does not suggest rates.
- Both are **data to prepare a return**. Aggregate turnover is left at 0 in the GSTR-1 file for the owner to enter.

### Purchases and input tax credit
- The owner (or accountant) records purchase bills with the vendor's GSTIN and tax. Each bill is marked eligible or blocked, and a blocked bill must say why (for example food and beverages, or personal use). Kora does not decide eligibility.
- A GSTR-2B file can be loaded and matched against the bills: matched, different in amount, only in 2B, or only in the books. An eligible bill that the supplier has not filed is shown as at risk.
- Payables ageing and MSME payment dates are tracked. Expenses (see above) are separate and do not feed input credit.
- The matching rules and the eligible and blocked categories are for the CA to confirm.

### E-way bills
- For an issued tax invoice, bill of supply or delivery challan with goods, Kora builds the e-way bill JSON, checks the portal's content rules in plain words, and sends it through the GST partner. Until a partner is connected, the JSON can be downloaded and uploaded on the portal by hand.
- Cancellation is offered within 24 hours of making the bill. The payload field names and rules follow the public e-way bill API as understood and **have not been checked against the live portal or a partner sandbox**.

### Records
- Every change to records is written to an append-only audit log with who made it and when. The application role cannot update or delete it.
- Money, GSTINs and totals are validated by the database as well as the application.

## What Kora does not do

- **It does not file returns.** GSTR-1, GSTR-3B and annual returns are filed by the owner or their CA on the GST portal.
- **No input tax credit decisions.** Purchases, eligible and blocked status, GSTR-2B matching and the 3B table 4 figures are record keeping for the CA. The "GST summary" report (outward supplies only) still prints a note that purchases are not included.
- **No live e-way bill or e-invoice connection.** Both run against the local mock partner until a real GST partner is connected.
- **No exports, SEZ supplies or deemed exports.** Place of supply 96 is refused with a message.
- **No reverse-charge e-invoices.** An invoice marked as reverse charge cannot be registered as an e-invoice yet; Kora says so rather than guessing.
- **E-invoice is B2B only.** Sales to unregistered buyers are not sent to the portal, and sales to composition dealers are not treated differently.
- **No rate or HSN suggestions.** The rate list is a starting set and must be confirmed.
- **No guarantee about the partner or portal.** Kora depends on a GST partner. Its availability, fees and error codes are outside Kora's control.

## What a CA must confirm before beta

1. The GST rate list seeded in the database, and whether rates such as 0.25%, 3% and 40% apply to the items customers will invoice.
2. The HSN length rule: today, a tax invoice for a business above Rs 5 crore needs at least 6 digits (blocked), and below that at least 4 digits (a warning).
3. How nil-rated, exempt and non-GST supplies should appear. Today every 0% line in a tax invoice is reported as nil-rated, and every bill of supply as exempt.
4. The GSTR-1 JSON structure against the current GST offline utility, including the section and field names.
5. TCS applicability and rates, how TDS deductions should be recorded, and whether TCS should be charged on taxable value plus tax as Kora does.
5a. The GSTR-3B JSON field names and which table outward supplies with reverse charge belong in.
6. The partner's error codes. Kora's plain-words messages are keyed to the mock partner's codes and must be mapped to the real partner's list.
7. Whether reverse-charge outward supplies need an e-invoice and how.
8. The e-way bill JSON (field names, the Rs 50,000 limit, transport modes, the 24-hour cancellation rule) against the live portal.
9. Purchases: which bills are eligible or blocked for input credit, how GSTR-2B lines should match bills, and the table 4 layout of GSTR-3B.

## Data protection

Kora stores customers' names, GSTINs, addresses, phone numbers and emails on behalf of businesses. Under India's data protection law the business is generally the data fiduciary, and Kora a processor. Before launch, a lawyer should confirm: consent and notice for customer data, the retention rule (issued invoices must be kept for the statutory period, so they are never auto-deleted), breach notification, and data residency (host in India).

## Security controls that support compliance

- Tenant isolation is enforced by row-level security, and a removed member's access ends at the database, not only in the app.
- Sign-in is by one-time code with rate limits, single-use codes, and HMAC-hashed storage. A person may also set a password, which is stored only as a salted scrypt hash, and turn on an authenticator app with recovery codes. The GST portal password of a taxpayer is never requested or stored.
- Webhooks are verified by signature on the raw body and are idempotent by event id.
- The public invoice link holds only a hash of its token, can be revoked, and returns nothing but the one document.
- The portal link works the same way for one customer. Every portal action checks that the document belongs to that customer before reading or changing it, and the portal pages are marked not to be indexed by search engines.
- Spreadsheet exports neutralise cells that would run as formulas.
