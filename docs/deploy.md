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

## Monitoring

Alert on:

| Signal | Why |
|---|---|
| `job` rows with `status = 'failed'`, and queued jobs older than 10 minutes | Messages or e-invoices are not going out. |
| `einvoice` rows with `status in ('rejected', 'failed')` older than a day | An invoice is not legally complete. Contact the owner. |
| `webhook_event` rows with `processed_at is null` | A payment was received but not applied. |
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
