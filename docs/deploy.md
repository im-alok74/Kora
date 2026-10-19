# Deploying Kora

This is the path from a working repository to a real business issuing real invoices. Nothing here has been run against production, because no production accounts exist yet. Steps that need an account are marked **needs account**.

## What runs

| Process | Needs | Scale |
|---|---|---|
| `apps/web` (Next.js) | Postgres, Chromium (for PDF), outbound HTTPS to the GST partner | Stateless. Run two or more behind a load balancer. |
| `apps/worker` | Postgres, outbound HTTPS to the messaging providers and the GST partner | Stateless. Run two for availability. Jobs use `SKIP LOCKED`, so extra workers never double-run work. |
| PostgreSQL 16+ | Managed service in an Indian region | One primary with point-in-time recovery. |
| Object storage | Optional in v1 (PDFs are generated on demand) | |

The mock partner (`apps/mock-gsp`) is for development and staging only.

## Order of work

1. **Accounts first, because they take weeks** (**needs account**): GST partner (GSP) sandbox, payment gateway, WhatsApp Business provider with approved templates, DLT registration for SMS (entity, header, templates), transactional email domain, hosting, domain, trademark clearance.
2. Database.
3. Migrations.
4. Web and worker with mock adapters, on a staging URL with `KORA_ALLOW_MOCKS=1`.
5. Swap in real adapters one at a time, sandbox first.
6. CA review of the items in [compliance.md](compliance.md).
7. Closed beta with 10 to 20 real businesses and two or three CAs.

## Database

Create three roles. Production passwords come from your secret store, never from the repository.

```sql
create role kora_app nologin;                                         -- the policies target this role
create role kora_owner login password '...' bypassrls;                -- runs migrations, owns functions
create role kora_web  login password '...' in role kora_app;          -- the application connection
create database kora owner kora_owner;
```

- `kora_web` must **not** be a superuser and must **not** have `BYPASSRLS`. Check with `select rolsuper, rolbypassrls from pg_roles where rolname = 'kora_web'`; both must be false. The test suite asserts this for the test database.
- Run migrations as `kora_owner`: `MIGRATE_DATABASE_URL=... pnpm migrate`. Migrations are forward-only, run in order, each in a transaction, under an advisory lock, so two deploys cannot collide.
- Before the first release, run `pnpm db:smoke` against a copy to confirm numbering, immutability, totals, webhook idempotency and tenant isolation behave.
- Enable automated backups and point-in-time recovery. Test a restore before launch, and put a restore drill in the calendar.
- Issued documents and the audit log must never be deleted to save space. They are the legal record.

## Configuration

See the table in the [README](../README.md). In production:

- `NODE_ENV=production`. The mock OTP sender, mock gateway and mock messenger refuse to start. Do not set `KORA_ALLOW_MOCKS` in production.
- `OTP_HMAC_SECRET` and `GATEWAY_WEBHOOK_SECRET` must be long random values, different per environment. Rotating `OTP_HMAC_SECRET` invalidates only codes in flight.
- `DATABASE_URL` uses the `kora_web` role. Use a connection pooler in transaction mode only if it preserves `set_config(..., true)` inside a transaction (PgBouncer in transaction mode does).
- Real provider adapters are new files implementing `OtpSender`, `Messenger`, `PaymentGateway` and `GspClient` in `packages/adapters`. They are selected by the corresponding environment variable.

## Web and worker

Build once, run both:

```bash
pnpm install --frozen-lockfile
pnpm build                         # Next.js production build
pnpm --filter @kora/web start      # web
pnpm --filter @kora/worker start   # worker (uses tsx; bundle with esbuild if you prefer)
```

- PDF output needs Chromium. Use an image that includes it (the Playwright base image does), or run `playwright install --with-deps chromium` in the image build.
- The web process serves `/api/health` (200 when the database answers). The worker serves `/healthz` on `WORKER_HEALTH_PORT` and returns 503 if its loop has stalled for a minute. Use these for load balancer and restart checks.
- Terminate TLS at the load balancer. The app sets secure cookies and HSTS when `NODE_ENV=production`.
- The service worker is served from `/sw.js` at the site root and must not be cached by a CDN for more than a few minutes.

## Webhooks

- Payment gateway webhook URL: `https://<your-domain>/api/webhooks/<gateway>`, for example `/api/webhooks/razorpay` once that adapter exists. Configure the signing secret in the gateway dashboard and in `GATEWAY_WEBHOOK_SECRET`.
- The handler returns 200 for valid events, including duplicates, 400 for a bad signature, and 500 if it could not apply the event, so the gateway retries.
- Allow-list the gateway's IP ranges at the edge if the gateway publishes them.

## API, webhooks and exports

- Webhooks are sent by the **worker**, from the same job queue as messages, so the worker must be running. Every request goes through a check that the address connected to is public; do not set `KORA_WEBHOOK_ALLOW_PRIVATE` in production.
- The API rate limit is counted per server process. With several web instances the effective limit is the limit times the number of instances. Put a rate limit at the edge as well if the API is exposed widely.
- API keys are stored as hashes and webhook signing secrets in the `webhook_endpoint` table (they must be readable to sign). That table is excluded from the activity log. Treat database backups as sensitive.
- Excel, backup and Tally exports are built in memory and limited to 200,000 rows a data set. Each one writes a row in `data_export`.
- The Tally file has not been tried against a live Tally. Have an accountant import it into a test company before anyone relies on it.

## Monitoring

Alert on:

| Signal | Why |
|---|---|
| `job` rows with `status = 'failed'`, and queued jobs older than 10 minutes | Messages or e-invoices are not going out. |
| `einvoice` rows with `status in ('rejected', 'failed')` older than a day | An invoice is not legally complete. Contact the owner. |
| `webhook_event` rows with `processed_at is null` | A payment was received but not applied. |
| `webhook_delivery` rows with `status = 'failed'`, or `webhook_endpoint` rows with `active = false` and `consecutive_failures >= 20` | A customer's system is not getting events. Tell the owner; they fix the address and switch it back on. |
| `recurring_run` rows with `status = 'failed'`, or `recurring_profile` rows active with `next_run_date` more than a day in the past | A scheduled invoice was not made. The note on the run says why. |
| Worker `/healthz` returns 503 | The loop has stalled. |
| 5xx rate on `/api/*` | Application errors. |
| Database connections, replication lag, disk | Basics. |

Useful queries:

```sql
-- stuck work
select queue, status, count(*), min(created_at) from job where status <> 'done' group by 1, 2;
-- invoices waiting on the portal
select d.number, e.status, e.error_code, e.attempts from einvoice e join document d on d.id = e.document_id
 where e.status in ('pending', 'registering', 'rejected', 'failed') order by e.created_at;
```

## Runbooks

**The GST portal or partner is down.** Registrations retry with delays up to an hour, and invoices show as not yet legally complete. After about 8 attempts they are marked failed and the owner can press Resubmit. When the partner recovers, run `update job set run_at = now() where queue = 'einvoice.register' and status = 'queued'` to retry sooner. Tell affected owners in plain words.

**A payment arrived but the invoice is not marked paid.** Look in `webhook_event` for the event id. If `processed_at` is null, the handler failed; the gateway will retry. If the payment is in `payment` with no allocation, it is unapplied money (an overpayment, or a payment for an invoice already paid) and shows under unallocated payments.

**A message was not delivered.** `delivery.status = 'failed'` with `error_message`. Fix the cause (number, template approval) and press Send again from the invoice.

**A migration failed.** It rolled back as a unit. Fix forward with a new migration; do not edit one that has been applied.

**Rotating the gateway webhook secret.** Change it in the gateway, then in the environment, and restart the web processes. Events signed with the old secret are rejected with 400 during the gap and are retried by the gateway.

## Before the first real invoice

- [ ] CA has reviewed `replica/tax-cases.md`, the rate seed, and the GSTR-1 output.
- [ ] Partner sandbox: 50 or more sample invoices registered, including rejections, with no rejection caused by Kora's totals.
- [ ] Payment gateway test mode: payments, partial payments, duplicate webhooks, refunds handled outside Kora.
- [ ] WhatsApp templates approved; DLT templates approved.
- [ ] Backups restored once into a clean database.
- [ ] Row-level security verified with the production role.
- [ ] Privacy notice, terms, and data processing terms reviewed by a lawyer.
- [ ] A person answers support, in Hindi and English.


## Running with no always-on worker (Vercel and similar)

The worker is a long-running process, and Vercel does not run one. `GET /api/cron/tick` does one pass of the same work: it queues due
reminders and recurring invoices, then runs ready jobs (messages, e-invoices, webhooks) for up to 40 seconds.

- Set `CRON_SECRET` (16 or more characters). Without it the route answers 503 to everyone, so it is never open by accident.
- `apps/web/vercel.json` runs it once a day at 10:00 IST. That is enough for daily reminders and recurring invoices, because the free
  Vercel plan allows nothing more often. Queued messages, e-invoices and webhooks then wait until the next pass.
- For near-real-time sending, call it every minute or two from any scheduler with `Authorization: Bearer <CRON_SECRET>`: a paid Vercel
  plan, an external cron service, or a GitHub Actions schedule. Overlapping calls and a running worker are safe (jobs use `SKIP LOCKED`).
- The better answer is a real worker. `Dockerfile` builds an image for both: run the web command and, as a second service, the worker command
  (`pnpm --filter @kora/worker start`) on Fly.io, Render, Railway or any container host.

## PDFs on Vercel

Vercel has no browser installed. When `VERCEL` is set (or `PDF_CHROMIUM=sparticuz`), PDFs use a Chromium built for serverless
functions (`@sparticuz/chromium`), shipped with the two PDF routes. The first PDF after a quiet period takes a few seconds to start.
Everywhere else, Playwright's own Chromium is used. The container image includes it.

## Backups

`infra/backup.sh` writes a `pg_dump` (custom format), checks it can be read back, encrypts it if `BACKUP_PASSPHRASE` is set, copies it to
`BACKUP_S3_URI` if set, and deletes local files older than `BACKUP_KEEP_DAYS`. `infra/restore-check.sh` loads a backup into a scratch
database, compares row counts with the live database, and drops the scratch database. A mismatch, a wrong passphrase or an unreadable file
exits non-zero.

- `.github/workflows/backup.yml` runs the backup daily to object storage you own. It stays off until you set the repository variable
  `BACKUPS_ENABLED=true` and add the secrets listed at the top of that file. It never keeps data on GitHub.
- Run `restore-check.sh` against a scratch server at least monthly. A backup that has never been restored is not yet a backup.
- Supabase keeps its own daily backups on paid plans only. On the free plan this script is the only copy.
- Keep the passphrase somewhere other than the backup bucket. Without it the files cannot be opened.
