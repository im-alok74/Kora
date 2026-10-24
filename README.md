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
| Compliance | E-invoice (IRN and QR) through a partner adapter with retry, rejection handling and the 24-hour cancellation window. E-way bills for goods, through the same partner or as a JSON file for the portal. GSTR-1 and GSTR-3B JSON export, GST summary, reconciliation to the ledger. |
| Offline | Installable web app. Drafts made offline are kept on the device and sync when the connection returns, with conflict handling. |
| Team | Owner, staff and accountant roles enforced in the database. Activity log that cannot be edited. Several businesses per login. |
| Client portal | A private link per customer where they see what they owe, pay, answer estimates and read their statement, with no account. The business can replace or stop the link any time. |
| Expenses | Record what the business spends, with a receipt photo or PDF, totals by category and a CSV. |
| Late fees and other currencies | Overdue invoices offer a draft late fee debit note that you issue. Estimates and proforma invoices can be quoted in another currency and convert to a rupee invoice. |
| Data and integrations | Export to Excel, a full backup (ZIP with CSV and JSON), and a Tally import file. Import customers and items from a spreadsheet or a Tally ledger file, and old invoices as drafts. A JSON API with keys and signed, retrying webhooks. See [docs/api.md](docs/api.md). |
| Reports | Sales register, sales by customer, payments received, ageing, customer statement, with CSV export that is safe to open in a spreadsheet. |
| CA firms | One screen for every client with what is overdue and what is due, an inbox for documents clients send, and one-click switching between businesses. |
| Lawyers | Matters with time, expenses, fees and hearing dates. Client money held in trust, with a ledger, and invoices paid from it. Matters can be made private to chosen people. |
| Freelancers | Projects on the same engine as matters, with a timer, a rate, and billing of tracked hours. |
| Shops | Stock with reorder levels and counts, barcodes, tax-inclusive prices, a till with an 80 mm receipt, and documents in English, Hindi, Marathi or Gujarati. |
| Purchases and input credit | Purchase bills, payables ageing, input tax credit with eligible or blocked status, GSTR-2B import and matching, and GSTR-3B table 4 figures. |
| Kora network | An invoice to a customer who is on Kora lands in their account and becomes a purchase bill on accept. A directory, catalogues and purchase orders that turn into invoices. |
| Security | One-time codes plus an optional authenticator app and recovery codes, a list of signed-in devices, a security log, and closing your own account. |
| Search and notifications | A search palette (Ctrl+K) across documents, customers, items and matters, a bell for what needs attention, bulk actions, and a dark theme. |
| Operations | Container image, daily background tick for hosts with no worker, encrypted backups with a restore check, error reporting, shared rate limiting, a jobs admin route. See [docs/deploy.md](docs/deploy.md). |

What is **not** built yet: filing returns, export invoices under LUT and SEZ supplies, and a live GST partner connection (e-invoices and e-way bills run against the local mock partner until one is connected; an e-way bill can also be downloaded as JSON for the portal). Customers do not have accounts with passwords: they use a private link and, if they want, a sign-in code sent to the email or mobile saved on their record. Invoices from other software come in as drafts, never as issued documents. See [docs/compliance.md](docs/compliance.md).

## Run it locally

You need Node 22, pnpm 10 and Docker (Docker Desktop on Windows and Mac). The commands below work in a terminal on Windows (Git Bash or PowerShell), Mac and Linux.

```bash
pnpm install
cp .env.example .env     # on PowerShell: Copy-Item .env.example .env
pnpm db:up               # Postgres 16 in Docker on port 54329, with the same roles as production
pnpm migrate             # applies packages/db/migrations (reads MIGRATE_DATABASE_URL from .env)
pnpm dev:all             # web on :3000, the worker, and the mock GST partner on :3202
```

Then open http://localhost:3000 and sign in with any mobile number. In development the one-time code is printed in the terminal that runs `pnpm dev:all`, on a line that starts `[mock-otp]`. Nothing is sent anywhere. After signing in, create a business (a GSTIN is optional if you choose "unregistered"), or press "Try it with sample data" on the dashboard to fill a labelled demo business. Payment links point at a test page inside the app, and the GST partner is a local mock. **No live government, payment or messaging service is ever called.**

PDFs are made with headless Chromium. Install it once with `pnpm --filter @kora/pdf exec playwright install chromium`, or invoice PDFs will fail locally.

If something does not start, read [docs/troubleshooting.md](docs/troubleshooting.md). To start from a clean database, run `pnpm db:down` (this deletes the local data) and then the `db:up` and `migrate` steps again.

## Environment variables

Copy `.env.example`. Never commit `.env`. The file lists every variable the code reads, with the live services (SMS and email sign-in codes, WhatsApp, Razorpay, Upstash rate limiting, object storage, Sentry, backups) commented out. Leave them out and Kora uses safe local mocks. A test (`apps/web/test/envDocs.test.ts`) fails if the code reads a variable that `.env.example` does not name.

For production, use [docs/launch-checklist.md](docs/launch-checklist.md), which lists every variable by name with where it is used and whether it is required.

| Variable | Used by | Meaning |
|---|---|---|
| `DATABASE_URL` | web, worker | Postgres connection as the `kora_web` role (subject to row-level security). |
| `MIGRATE_DATABASE_URL` | `pnpm migrate` | Connection as `kora_owner`, which runs migrations. Read from `.env` locally; in production pass it in the environment. |
| `OTP_PROVIDER`, `OTP_HMAC_SECRET` | web | `mock` prints codes to the console, `live` sends through MSG91 (SMS) and Resend (email). The secret (32+ characters) signs stored code hashes. |
| `MSG91_*`, `RESEND_API_KEY`, `EMAIL_FROM` | web, worker | Live sign-in codes and messages by SMS and email. |
| `MESSENGER`, `WHATSAPP_*` | worker | `mock` logs messages, `live` sends on WhatsApp (Cloud API), by email and by SMS. |
| `GATEWAY`, `GATEWAY_WEBHOOK_SECRET`, `RAZORPAY_*` | web | `mock` for local use, `razorpay` for Razorpay Payment Links. Point the Razorpay webhook at `/api/webhooks/razorpay`. |
| `GSP_URL`, `GSP_TOKEN`, `GSP_TIMEOUT_MS` | web, worker | GST partner base URL, bearer token and timeout. |
| `APP_URL` | web, worker | Public base URL, used in message links and payment links. |
| `SESSION_TTL_DAYS` | web | Sign-in lifetime, default 30. |
| `KORA_ALLOW_MOCKS` | web, worker | Set to `1` only for a staging demo. In production every mock adapter refuses to start without it. |
| `DEMO_FIXED_OTP` | web | Staging demos only; needs `KORA_ALLOW_MOCKS=1`. Never use it with real customers. |
| `API_RATE_LIMIT` | web | Requests a minute for each API key (default 120), counted in the shared limiter (Upstash if set, otherwise Postgres). |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `API_RATE_PER_MINUTE` | web | Request limits shared by every server instance. The per-address limit across `/api` is on only when Upstash is set (default 300 a minute). |
| `BLOB_S3_*` | web, worker | Files in object storage instead of the database. |
| `SENTRY_DSN`, `LOG_LEVEL` | web, worker | Error reporting and log detail. |
| `CRON_SECRET` | web | Guards `/api/cron/tick` and `/api/admin/jobs`; 16 or more characters. |
| `KORA_WEBHOOK_ALLOW_PRIVATE` | web, worker | Set to `1` only in development or tests so webhooks may go to `localhost` over http. **Never set it in production.** |
| `WORKER_HEALTH_PORT`, `REMINDER_TICK_MS`, `RECURRING_TICK_MS` | worker | Liveness endpoint port (off when unset), and how often reminders (30s) and recurring invoices (60s) are checked. |
| `DB_POOL_MAX`, `PDF_CHROMIUM`, `NEXT_PUBLIC_SITE_URL`, `KORA_RELEASE_REPO` | web | Optional tuning. See `.env.example`. |
| `BACKUP_*` | `infra/backup.sh` | Backups. Not read by the app. |

## Tests

```bash
pnpm db:up
pnpm typecheck
pnpm db:smoke       # SQL-level rules, run as superuser (a bash script: use Git Bash on Windows)
pnpm test           # unit, property and database integration tests (uses the Postgres from db:up)
pnpm e2e            # Playwright: builds and starts web, worker and the mock partner, and runs the browser suite
```

- `pnpm test` creates a throwaway database for each test file (named `kora_t_` plus random letters) as the `postgres` superuser (`TEST_ADMIN_URL`, which defaults to the `db:up` container), and drops it afterwards. It never touches the `kora` database you run the app on.
- Playwright needs Chromium once: `pnpm --filter @kora/pdf exec playwright install chromium`.
- `pnpm e2e` takes several minutes. It drops and recreates a database called `kora_e2e`, uses ports 3200 (web), 3201 (worker health) and 3202 (mock partner), and builds into `apps/web/.next-e2e`. Because `pnpm dev:all` also starts the mock partner on 3202, **stop `pnpm dev:all` before running it**, or set `KORA_E2E_REUSE=1` to let the e2e run reuse servers that are already listening. Two e2e runs at the same time on one machine will break each other.
- To run one browser test file: `pnpm --filter @kora/e2e exec tsx scripts/prepare-db.ts`, then `pnpm --filter @kora/e2e exec playwright test tests/first-invoice.spec.ts`.
- Convention and the checks expected before a pull request are in [docs/contributing.md](docs/contributing.md).

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
                                                       +--> gateway adapter --> Razorpay
```

- **One database does the enforcing.** The rules that make an invoice legal (gapless numbers, totals equal the sum of lines, frozen issued documents, one payment per webhook event, tenant isolation, an audit trail nobody can edit) live in Postgres triggers, constraints and row-level security. The application cannot skip them.
- **Tenancy.** Every tenant table carries `business_id`. Each request runs inside `withTenant()`, which sets `app.business_id` and `app.user_id`. Policies also check that the user is still a member, so a removed member's session stops working at the database.
- **Money.** Integer paise in `bigint`. The tax library uses `bigint` too. There is no floating point in any money path.
- **Jobs.** A small Postgres queue (`job` table, `SKIP LOCKED`, exponential backoff). Jobs are inserted in the same transaction as the change that needs them, so an issued invoice always has its e-invoice and send work queued.
- **Adapters.** Payments, messaging, OTP, GSTIN lookup and the GST partner are interfaces with mock implementations, chosen by environment variables. Live providers exist for Razorpay, MSG91, Resend and the WhatsApp Cloud API; they run only when their keys are set. GSTIN lookup is still a mock.

The longer version, with a diagram of an invoice from draft to paid, is in [docs/architecture.md](docs/architecture.md).

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
| `apps/desktop`, `apps/mobile` | Windows and Mac (Electron) and Android (Capacitor) shells around the web app. Not part of the pnpm workspace. See [docs/apps.md](docs/apps.md) |
| `infra` | Local database roles, SQL smoke test, backup and restore-check scripts |
| `e2e` | Playwright suite |
| `replica/` | Research, plan, schema record, tax cases, design tokens, brand, final report |
| `docs/` | [Architecture](docs/architecture.md), [launch checklist](docs/launch-checklist.md), [deployment](docs/deploy.md), [troubleshooting](docs/troubleshooting.md), [contributing](docs/contributing.md), [compliance](docs/compliance.md), [database](docs/database.md) and the [API and webhooks guide](docs/api.md), and the [October 2026 audit](docs/audit-2026-10.md) |

## Licence and clean-room note

Kora reproduces what invoicing apps do, not how they look or sound. No code, templates, copy, icons or brand from any competitor is used; `replica/brand.json` lists the names the sweep checks for.
