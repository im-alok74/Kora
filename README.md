# Kora

GST invoicing and collections for Indian small businesses, built to be run with the CA who advises them.

Kora issues legally correct GST documents, sends them on WhatsApp, collects by UPI, registers e-invoices through a GST partner, and prepares GSTR-1 data. The owner stays responsible for filings; see [docs/compliance.md](docs/compliance.md).

## What is in the box

| Area | What it does |
|---|---|
| Documents | Tax invoice, bill of supply, estimate, proforma, delivery challan, credit note, debit note. Gapless numbering per series and financial year. Issued documents cannot be edited; corrections go through credit and debit notes. Estimates have a valid-until date, can be accepted or declined, and turn into an invoice once. Recurring invoices repeat weekly, monthly or yearly and are saved as drafts, issued, or issued and sent automatically. |
| Tax | One pure library (`packages/tax`) computes CGST, SGST, IGST and cess in integer paise. 10,000-run property tests and a database cross-check. |
| Parties and items | GSTIN checksum and state validation, HSN or SAC, allowed rate list. |
| Delivery | PDF (headless Chromium), public link with view tracking, WhatsApp, SMS and email through a retrying queue. |
| Collections | Dynamic UPI QR for the amount still due, hosted payment links, idempotent gateway webhooks, partial payments, reminders on a schedule, receivables ageing. |
| Compliance | E-invoice (IRN and QR) through a partner adapter with retry, rejection handling and the 24-hour cancellation window. GSTR-1 JSON export, GST summary, reconciliation to the ledger. |
| Offline | Installable web app. Drafts made offline are kept on the device and sync when the connection returns, with conflict handling. |
| Team | Owner, staff and accountant roles enforced in the database. Activity log that cannot be edited. Several businesses per login. |
| Client portal | A private link per customer where they see what they owe, pay, answer estimates and read their statement, with no account. The business can replace or stop the link any time. |
| Expenses | Record what the business spends, with a receipt photo or PDF, totals by category and a CSV. |
| Late fees and other currencies | Overdue invoices offer a draft late fee debit note that you issue. Estimates and proforma invoices can be quoted in another currency and convert to a rupee invoice. |
| Reports | Sales register, sales by customer, payments received, ageing, customer statement, with CSV export that is safe to open in a spreadsheet. |

What is **not** in v1: filing returns, purchases and input tax credit, e-way bills, exports and SEZ, customer login accounts, inventory. See [docs/compliance.md](docs/compliance.md).

## Run it locally

You need Node 22, pnpm 10 and Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up          # Postgres 16 with the same roles as production
pnpm migrate        # applies packages/db/migrations
pnpm dev:all        # web on :3000, worker, and the mock GST partner on :3202
```

Sign in at http://localhost:3000. In development the one-time code is printed in the web server console; nothing is sent anywhere. Payment links point at a test page inside the app, and the GST partner is a local mock. **No live government, payment or messaging service is ever called.**

## Environment variables

Copy `.env.example`. Never commit `.env`.

| Variable | Used by | Meaning |
|---|---|---|
| `DATABASE_URL` | web, worker | Postgres connection as the `kora_web` role (subject to row-level security). |
| `MIGRATE_DATABASE_URL` | `pnpm migrate` | Connection as `kora_owner`, which runs migrations. |
| `OTP_PROVIDER`, `OTP_HMAC_SECRET` | web | `mock` prints codes to the console. The secret (32+ characters) signs stored code hashes. |
| `GATEWAY`, `GATEWAY_WEBHOOK_SECRET` | web | Payment gateway adapter (`mock`) and its webhook signing secret. |
| `GSP_URL`, `GSP_TOKEN`, `GSP_TIMEOUT_MS` | web, worker | GST partner base URL and bearer token. |
| `MESSENGER` | worker | Message provider (`mock`). |
| `APP_URL` | web, worker | Public base URL, used in message links and payment links. |
| `SESSION_TTL_DAYS` | web | Sign-in lifetime, default 30. |
| `KORA_ALLOW_MOCKS` | web, worker | Set to `1` only for a staging demo. In production every mock adapter refuses to start without it. |
| `WORKER_HEALTH_PORT`, `REMINDER_TICK_MS`, `RECURRING_TICK_MS` | worker | Liveness endpoint port, and how often reminders (30s) and recurring invoices (60s) are checked. |

## Tests

```bash
pnpm db:up
pnpm typecheck
pnpm db:smoke       # SQL-level rules, run as superuser
pnpm test           # unit, property and database integration tests
pnpm e2e            # Playwright: starts web, worker and the mock partner, and runs the browser suite
```

Playwright needs Chromium once: `pnpm --filter @kora/pdf exec playwright install chromium`.

## Architecture on one page

```
 browser (installable web app, IndexedDB drafts, service worker)
        |
   apps/web  (Next.js)  -- public invoice page, webhooks, API routes
        |                         ^
        |   set app.business_id    | signed webhooks
        v                         |
   PostgreSQL 16  <------ apps/worker (job queue consumer, reminders)
   - row-level security on every tenant table          |
   - triggers: numbering, totals check, immutability   +--> messenger adapter (WhatsApp, SMS, email)
   - append-only audit log                             +--> GSP adapter  --> GST partner --> IRP
                                                       +--> gateway adapter --> Razorpay or Cashfree
```

- **One database does the enforcing.** The rules that make an invoice legal (gapless numbers, totals equal the sum of lines, frozen issued documents, one payment per webhook event, tenant isolation, an audit trail nobody can edit) live in Postgres triggers, constraints and row-level security. The application cannot skip them.
- **Tenancy.** Every tenant table carries `business_id`. Each request runs inside `withTenant()`, which sets `app.business_id` and `app.user_id`. Policies also check that the user is still a member, so a removed member's session stops working at the database.
- **Money.** Integer paise in `bigint`. The tax library uses `bigint` too. There is no floating point in any money path.
- **Jobs.** A small Postgres queue (`job` table, `SKIP LOCKED`, exponential backoff). Jobs are inserted in the same transaction as the change that needs them, so an issued invoice always has its e-invoice and send work queued.
- **Adapters.** Payments, messaging, OTP, GSTIN lookup and the GST partner are interfaces with mock implementations. Real providers are new files, and nothing else changes.

| Folder | Contents |
|---|---|
| `packages/tax` | Tax and money library, GSTIN checks |
| `packages/db` | Migrations, `withTenant`, test helpers |
| `packages/core` | Services: auth, documents, payments, jobs, e-invoice, GSTR, reports, team |
| `packages/adapters` | Adapter interfaces, mocks, the mock GST partner server |
| `packages/pdf` | Invoice HTML renderer, PDF output, UPI and e-invoice QR |
| `apps/web` | The Next.js app |
| `apps/worker` | Background worker |
| `apps/mock-gsp` | The mock GST partner as a runnable server |
| `e2e` | Playwright suite |
| `replica/` | Research, plan, schema record, tax cases, design tokens, brand, final report |
| `docs/` | Compliance and deployment |

## Licence and clean-room note

Kora reproduces what invoicing apps do, not how they look or sound. No code, templates, copy, icons or brand from any competitor is used; `replica/brand.json` lists the names the sweep checks for.
