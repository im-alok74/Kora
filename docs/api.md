# Kora API and webhooks

Kora has a small JSON API for reading your data and creating customers, invoices and payments from other software, and webhooks that tell your software when something happens. An OpenAPI description is served at `/openapi.json`.

Everything here is for **one business**. A key belongs to one business and can only see that business.

## Keys

The owner makes keys under **Developers**. A key is shown once. Only a hash is kept, so a lost key cannot be recovered: make a new one and revoke the old one.

| Access | Can do |
|---|---|
| Read only | List and read customers, items, invoices, payments, matters, purchase bills, stock |
| Read and write | The above, plus create customers, items, invoices, payments, matters, time entries and purchase bills, adjust stock, issue drafts, make share links |

No key can cancel an invoice, change settings, manage people or make more keys. A key stops working at once when it is revoked, and also if the person who made it is removed from the business. At most 20 live keys per business.

Send the key on every request:

```
Authorization: Bearer kora_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Conventions

- Base path `/api/v1`. Requests and answers are JSON. Writes need `Content-Type: application/json` (otherwise 415).
- **Money is whole paise** (1 rupee = 100 paise) in answers, as strings such as `"118000"`. In requests, rupees are text such as `"500.00"`, because that is how a person writes them. Never send a floating point number for money.
- Dates are `YYYY-MM-DD`. Times are ISO 8601 in UTC.
- Field names in answers are `snake_case`, as stored. Request bodies use the names shown below (`camelCase`).
- Lists take `limit` (1 to 200, default 50) and `offset`, and answer `{ "data": [...], "limit": 50, "offset": 0 }`.
- Errors always look like this, with a matching HTTP status:

```json
{ "error": { "code": "invalid_request", "message": "Add at least one line.", "field": "lines" } }
```

| Status | `code` | Meaning |
|---|---|---|
| 400 | `invalid_request` | The request is wrong. `message` says how, in plain words |
| 401 | `unauthorized` | Missing, wrong or revoked key |
| 403 | `forbidden` | The key cannot do this (for example a read-only key writing) |
| 404 | `not_found` | No such thing in your business |
| 409 | `conflict` | A change clashed with another change |
| 415 | `unsupported_media_type` | Send JSON |
| 429 | `rate_limited` | Slow down. See `Retry-After` |

**Rate limit:** 120 requests a minute for each key, counted across all server instances (set `API_RATE_LIMIT` to change it). Every answer has `X-RateLimit-Limit` and `X-RateLimit-Remaining`.

## Endpoints

| Method and path | Access | What it does |
|---|---|---|
| `GET /me` | read | The business and the key's access. A good first call |
| `GET /customers?q=` | read | List customers |
| `GET /customers/{id}` | read | One customer |
| `POST /customers` | write | Make a customer: `{ name, stateCode?, gstin?, phone?, email?, billingAddress?, currency? }`. A state is needed unless a GSTIN gives it |
| `GET /items?q=` | read | List items |
| `POST /items` | write | Make an item: `{ name, kind?, hsnSac?, unit?, defaultRateBp, price? }`. `defaultRateBp` is the GST rate in basis points (1800 = 18%) |
| `GET /invoices?type=&status=&q=` | read | List documents of every type |
| `GET /invoices/{id}` | read | One document with its lines and payments |
| `POST /invoices` | write | Make a draft, or issue it straight away with `"issue": true` |

| `POST /invoices/{id}/issue` | write | Issue a draft: gives it its number and locks it |
| `POST /invoices/{id}/payments` | write | Record a payment: `{ amount: "500.00", method, receivedOn?, note? }` |
| `GET /invoices/{id}/payments` | read | Payments on a document |
| `POST /invoices/{id}/share` | write | A public link the customer can open (valid 30 days) |
| `GET /payments?from=&to=` | read | Payments received in a period (this month by default) |
| `GET /matters?status=&kind=&q=` | read | Matters and projects. `kind` is `matter` or `project` |
| `GET /matters/{id}` | read | One matter with time, expenses, fees, client money and dates |
| `POST /matters` | write | Open one: `{ partyId, title, kind? }` |
| `POST /matters/{id}/time` | write | Log time: `{ duration: "1:30", description, date?, rate?, billable? }` |
| `GET /purchases?q=&state=&from=&to=` | read | Purchase bills |
| `POST /purchases` | write | Record a bill: vendor, bill number and date, and lines with rate and tax |
| `GET /stock?q=&low=1` | read | Stock on hand for tracked items; `low=1` lists those at or under their reorder level |
| `POST /stock/{itemId}/adjust` | write | `{ mode: "in" \| "out" \| "count", quantity, note?, date? }` |

A document body may also carry `reference` (the buyer's order or PO number, up to 60 characters), `subject` (up to 200) and `paymentTerms` (`receipt`, `net15`, `net30`, `net45`, `net60`, `eom` or `custom`). A preset other than `custom` fills `dueDate` when you leave it out; a `dueDate` you send always wins. These freeze when the document is issued, like everything else on it.

Everything else in the app (the web screens use `/api/...` routes without the `v1`) is not part of this API. Those routes use the signed-in browser session, can change at any time, and are not described here.

### Making an invoice

```bash
curl https://YOUR-HOST/api/v1/invoices \
  -H "Authorization: Bearer $KORA_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-10452" \
  -d '{
        "docType": "tax_invoice",
        "partyId": "CUSTOMER-ID",
        "issue": true,
        "dueDate": "2026-11-15",
        "lines": [
          { "name": "Consulting", "hsnSac": "998313", "quantity": "2", "rate": "500.00", "taxRateBp": 1800, "kind": "service" }
        ]
      }'
```

Kora works out every total itself. Whatever you send for totals is ignored. The answer is `{ "id", "status", "number", "warnings" }`.

`docType` is one of `tax_invoice`, `bill_of_supply`, `estimate`, `proforma`, `delivery_challan`. Credit and debit notes are made in the app, from the invoice they correct.

**Retries are safe.** Send an `Idempotency-Key` (8 to 64 letters, digits, `-` or `_`). If your request times out and you send it again with the same key, you get the same document back (status 200 instead of 201) and never a second invoice. Use a key that belongs to the thing you are invoicing, such as your order number.

**An issued document cannot be edited or deleted.** That is a rule of GST records, enforced by the database. Correct it with a credit or debit note.

## Webhooks

Add a web address under **Developers** and choose the events. Each event is a signed `POST` with a JSON body:

```json
{
  "id": "evt_0b8e4c1f2a6d4e7f9c3a1b5d7e9f2a4c",
  "type": "document.issued",
  "created": "2026-10-19T09:30:12.123Z",
  "data": {
    "id": "5f2c…", "number": "INV/26-27/0001", "doc_type": "tax_invoice", "doc_date": "2026-10-19", "due_date": "2026-11-15",
    "currency": "INR", "total_paise": "118000", "party_id": "…", "party_name": "Asha Stores"
  }
}
```

| `type` | Sent when | `data` |
|---|---|---|
| `document.issued` | A document is issued | as above |
| `document.cancelled` | An issued document is cancelled | `id, number, doc_type, reason` |
| `payment.received` | A payment is recorded or arrives from the gateway | `payment_id, document_id, number, amount_paise, method, status` |
| `estimate.accepted` | An estimate is accepted (by staff or the customer) | `id, number, answered_by` |
| `estimate.declined` | An estimate is declined | `id, number, answered_by` |

`data` holds identifiers and amounts. To get the full document, call `GET /invoices/{id}`.

### Check the signature

Every request has these headers:

```
Kora-Signature: t=1792400000,v1=5257a869e7ecebeda32af…
Kora-Event-Id: evt_0b8e…
Kora-Event-Type: document.issued
```

`v1` is the HMAC-SHA256, in hex, of the text `"<t>.<raw body>"` using the endpoint's signing secret (it starts `whsec_`, and is shown once when you add the webhook). **Check it against the raw body exactly as received**, and reject a `t` more than 5 minutes old.

Node:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(secret, header, rawBody, toleranceSeconds = 300) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? '');
  if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${m[1]}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(m[2], 'hex'));
}
```

Python:

```python
import hmac, hashlib, re, time

def verify(secret: str, header: str, raw_body: bytes, tolerance=300) -> bool:
    m = re.fullmatch(r"t=(\d+),v1=([0-9a-f]{64})", header or "")
    if not m or abs(time.time() - int(m[1])) > tolerance:
        return False
    expected = hmac.new(secret.encode(), m[1].encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, m[2])
```

### Delivery rules

- Answer with any `2xx` within 10 seconds. Anything else (or no answer) is retried with growing delays (30 seconds, doubling, up to an hour) for up to 8 tries.
- **A message can arrive more than once, and out of order.** Use `id` to ignore a repeat, and `created` to put events in order. A retry of the same event always has the same `id`.
- After 20 deliveries in a row fail for good, the address is switched off. Switch it back on under **Developers** once it works.
- Kora only sends to public internet addresses over `https`. Addresses on private networks, `localhost` and cloud metadata addresses are refused, both when you save the address and again at the moment of connecting. Redirects are not followed.
- **Send a test** under **Developers** sends a signed `ping` event right away and tells you what your server answered.
- Events are written in the same database transaction as the change itself. An invoice that is issued always has its event queued, and one that was rolled back never does.

## Moving data in and out

Under **Data**:

- **Excel**: one workbook with a sheet each for customers, items, documents, document lines, payments and expenses. Money is real numbers with two decimals; text that starts with `=` stays text and never runs as a formula.
- **Backup (ZIP)**: a CSV for each kind of record, `data.json` with the same data for other software (money in paise), and a `README.txt`. It does not include PDFs, receipt photos or settings. Taking a backup or a workbook is recorded in the activity log.
- **Tally**: sales, credit notes and receipts as a Tally import file. See the notes below.
- **Import**: customers or items from a CSV or an Excel file, or customers from a Tally ledger export (XML). The first row names the columns; common names such as *Customer Name*, *Mobile*, *GST Number*, *HSN or SAC*, *GST %* are understood. States can be a full name or a two-digit code. Rows that already exist (same GSTIN or name) are skipped, so importing the same file twice adds nothing. At most 2,000 rows and 1 MB a file. Each row is checked on its own: good rows are added, and every problem row is reported by its line number and left out.
- **Import invoices**: old invoices from a CSV or Excel file, as **drafts** (tax invoices, bills of supply, estimates or proforma invoices). The old invoice number is kept as the reference, and the draft gets a new Kora number when you issue it. At most 200 invoices and 2,000 rows a file, and importing the same file twice does not repeat the drafts.

The Data and Import screens use the signed-in session, not an API key, so none of the above is in the `/api/v1` API.

### Tally notes

The file follows Tally's voucher import format as I understand it, and **has not been tested against a live Tally**. Import it into a test company first and ask your accountant to check it.

- Invoices and debit notes become **Sales** vouchers, credit notes become **Credit Note** vouchers, payments become **Receipt** vouchers. Every voucher balances to the paisa; Kora refuses to write one that does not.
- Ledger names are settings (the defaults are `Sales`, `Output CGST`, `Output SGST`, `Output IGST`, `Output Cess`, `TCS Payable`, `Round Off`, `Cash`, `Bank Account`, `TDS Receivable`). Ledgers that do not exist are created in the same file, with your customers under *Sundry Debtors*.
- Tax payable by the customer under reverse charge is not billed to them, so it is not posted to the tax ledgers.
- Cancelled invoices are left out and counted. Payments with no customer (a walk-in sale) are left out and counted.
- Cash payments post to the cash ledger, TDS to the TDS ledger, and everything else to the bank ledger.
