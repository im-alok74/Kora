# Launch checklist

Written on 23 October 2026 from the repository only. Nobody looked at Vercel, Supabase, Razorpay, MSG91, Meta, Resend or any other account while writing it, so anything that lives in an account is marked **Unknown** until the owner checks it. Names of settings are listed here, never values.

**Status key:** **Done** means the repository or the owner's own statement shows it. **Not done** means the repository shows it is missing or still a placeholder. **Unknown** means it lives in an account that this document could not see; the "Check" column says how to find out.

## 1. The short list: what stops a public launch

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Background work only runs once a day. Sending an invoice, e-invoice registration and webhooks wait for the next pass | **Not done** | `apps/web/vercel.json` has one cron, `30 4 * * *` (10:00 IST). Nothing runs jobs inside a web request (`runTick` is called only from `apps/web/app/api/cron/tick/route.ts`). The worker service is the chosen fix, see section 11 |
| 2 | Legal pages still carry placeholder text | **Not done** | `support@kora.example` in `apps/web/app/terms/page.tsx` and `refunds/page.tsx`, `privacy@kora.example` in `privacy/page.tsx`, "[number of days to be decided]" twice in `refunds/page.tsx`. Pricing says "Placeholder price" in `pricing/page.tsx` |
| 3 | Real sign-in codes (SMS and email) | **Unknown** | Code is ready (`packages/adapters/src/live.ts`). Needs `OTP_PROVIDER=live` and provider keys in Vercel. Production refuses the mock sender unless `KORA_ALLOW_MOCKS=1` |
| 4 | Real WhatsApp, SMS and email for invoices | **Unknown** | Code is ready. Needs `MESSENGER=live`, an approved WhatsApp template and an approved SMS template |
| 5 | Payments through Razorpay | **Unknown** | Code is ready (`packages/adapters/src/razorpay.ts`). Needs live keys and a live webhook |
| 6 | A backup that is scheduled and has been restored once | **Not done** | Scripts exist (`infra/backup.sh`, `infra/restore-check.sh`) and the workflow is off until `BACKUPS_ENABLED=true`. No record of a restore drill in the repository |
| 7 | A real GST partner | **Not done** | `GSP_URL` is a generic JSON client; no partner is chosen in the repository. E-invoice and e-way bill are off unless the business turns them on. See section 10 |
| 8 | Alerts | **Not done** | Nothing in the repository sends an alert. There are health routes and a queue route to poll (section 5) |

## 2. Environment variables for production

Names only. Set them in the host (Vercel: Project, Settings, Environment Variables, Production). `.env.example` lists every variable the code reads, and a test (`apps/web/test/envDocs.test.ts`) keeps it complete.

**Check:** the owner can list the names (not values) with `vercel env ls production`. Compare against the tables below. Status of every row is **Unknown** until that is done, except where noted.

### Required for the web app to start and be safe

| Name | Why | Notes |
|---|---|---|
| `DATABASE_URL` | Database connection as the `kora_web` role | Use the Supabase pooler in transaction mode (port 6543). The user name on the pooler has the project reference after a dot: `kora_web.<project-ref>`. `createSql` turns off prepared statements for port 6543 automatically |
| `OTP_HMAC_SECRET` | Signs stored sign-in codes | 32 or more characters, random, different from every other environment. The web app refuses to start with a shorter one |
| `GSP_URL` | GST partner base address | Optional until a partner is chosen. The client is built on first use (`createLazyGsp` in `packages/adapters/src/gsp-lazy.ts`), so an empty value only makes e-invoice and e-way bill calls fail with "The GST partner is not connected yet". Do not point production at the mock partner |
| `APP_URL` | Public address used in messages, payment links and share links | Falls back to Vercel's production host name. Set it once a custom domain is attached |
| `CRON_SECRET` | Lets the scheduler call `/api/cron/tick`, and the operator call `/api/admin/jobs` | 16 or more characters. Without it both routes answer 503 |

### Required for each live service

| Service | Names | Notes |
|---|---|---|
| Sign-in codes and SMS (MSG91) | `OTP_PROVIDER=live`, `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`, `MSG91_SMS_TEMPLATE_ID`; optional `MSG91_OTP_VAR`, `MSG91_SMS_VAR` | Templates need DLT approval. Each template has exactly one variable; the optional names tell Kora what you called it (defaults `OTP` and `MESSAGE`) |
| Email (Resend) | `RESEND_API_KEY`, `EMAIL_FROM` | The sending domain must be verified at Resend (section 7) |
| WhatsApp (Meta Cloud API) | `MESSENGER=live`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG` | The template must have one body variable. `WHATSAPP_TEMPLATE_LANG` defaults to `en` |
| Payments (Razorpay) | `GATEWAY=razorpay`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | `GATEWAY_WEBHOOK_SECRET` is only for the mock gateway and is not needed |

### Strongly recommended

| Name | Why |
|---|---|
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Request limits shared by every server instance. Without them the sign-in limits use Postgres and the per-address limit across `/api` is off |
| `BLOB_S3_ENDPOINT`, `BLOB_S3_BUCKET`, `BLOB_S3_ACCESS_KEY_ID`, `BLOB_S3_SECRET_ACCESS_KEY`, `BLOB_S3_REGION` | Receipts, attachments and logos in object storage. Without them files go in the database and grow every backup |
| `SENTRY_DSN` | Errors go to Sentry as well as the log |
| `NEXT_PUBLIC_SITE_URL` | The address used in the sitemap, page metadata and share previews. Falls back to `APP_URL`, then to `https://kora-invoice.vercel.app` |
| `LOG_LEVEL` | `info` by default |

### Must NOT be set in production

| Name | Why |
|---|---|
| `KORA_ALLOW_MOCKS` | Lets the mock sign-in sender, mock gateway and mock messenger run in production. If it is `1` today, real customers get fake services. **Check this first** |
| `DEMO_FIXED_OTP` | Makes every sign-in code one fixed value |
| `KORA_WEBHOOK_ALLOW_PRIVATE` | Lets outgoing webhooks reach private addresses |
| `TEST_ADMIN_URL`, `KORA_E2E_REUSE` | Test only |

### Optional tuning

`API_RATE_LIMIT` (default 120 a minute for each API key), `API_RATE_PER_MINUTE` (default 300 a minute for each address, only with Upstash), `DB_POOL_MAX` (default 10), `GSP_TIMEOUT_MS` (default 15000), `SESSION_TTL_DAYS` (default 30), `PDF_CHROMIUM` (set automatically on Vercel), `KORA_RELEASE_REPO`.

### Only for a separate worker process

`WORKER_HEALTH_PORT`, `REMINDER_TICK_MS`, `RECURRING_TICK_MS`. The worker needs the same `DATABASE_URL`, `GSP_URL`, `APP_URL`, messaging and `BLOB_S3_*` names as the web app.

### Only for backups

`BACKUP_DATABASE_URL`, `BACKUP_PASSPHRASE`, `BACKUP_S3_URI`, `BACKUP_S3_ENDPOINT`, `BACKUP_DIR`, `BACKUP_KEEP_DAYS`, `RESTORE_FILE`, `RESTORE_ADMIN_URL`, `SOURCE_DATABASE_URL`. In GitHub Actions the workflow also needs `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (keys for the backup bucket only).

## 3. Database roles and migrations

### Where production stands

| Item | Status | Evidence |
|---|---|---|
| Production database is at all 51 migrations, including `0109_pgcrypto_on_hosted.sql` | **Done** (owner's statement, 23 October 2026) | `packages/db/migrations` holds exactly 51 files. A local database migrated from empty holds 51 rows in `schema_migration` (checked while writing this) |
| Application connects as `kora_web`, which is not a superuser and has no `BYPASSRLS` | **Unknown** | Check with the query below |
| Migrations run as `kora_owner` | **Unknown** | `docs/deploy.md` describes the roles |

Check from the Supabase SQL editor (read only):

```sql
select count(*) from schema_migration;                       -- 51 today
select max(name) from schema_migration;                      -- 0141_demo_business.sql today
select rolname, rolsuper, rolbypassrls from pg_roles where rolname in ('kora_web', 'kora_owner');
                                                             -- kora_web must be false, false
select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity;
                                                             -- 58 today
```

### The numbering has gaps on purpose

Files are `0001` to `0036`, then `0109` to `0115`, `0120` to `0125`, `0140` and `0141`. The gaps come from the overnight build, where each working session had its own range. Migrations run in **file name order**, and anything not yet recorded in `schema_migration` is applied. Always give a new file a number higher than the highest one (today `0142` or more). A file numbered below an applied one still runs, but it runs after files that were written to come later, which is how surprises happen.

### Applying migrations safely

`pnpm migrate` (`packages/db/src/migrate-cli.ts`, `runMigrations`) takes an advisory lock, then applies every pending file in name order **inside a single transaction**. If any file fails, nothing from that run is kept and `schema_migration` is unchanged. That is safe, and it also means a long migration holds its locks until the last file is done.

Procedure for every release that contains a migration:

1. **Write it additive.** New tables, new nullable columns, new indexes, new functions. Never edit a file that has been applied anywhere. Never drop or rename a column the running code still reads. A destructive change is two releases: first stop using the column, later drop it.
2. **Run it on a copy first.** Locally: `pnpm db:up`, `pnpm migrate`, `pnpm test`. For anything touching existing rows, restore the latest backup into a scratch database (section 4) and run the migration there.
3. **Take a backup just before.** Run `infra/backup.sh` against production (section 4). Supabase's own daily backup is on paid plans only.
4. **Apply the migration before the code that needs it.** Because migrations are additive, the old code keeps working against the new schema. Run, from a trusted machine:

   ```bash
   MIGRATE_DATABASE_URL='postgres://kora_owner.<project-ref>:<password>@<pooler-host>:5432/postgres' pnpm migrate
   ```

   Use the pooler in **session mode** (port 5432 on the pooler host) because the direct database host is IPv6 only and many networks cannot reach it (see [troubleshooting.md](troubleshooting.md)). Do not paste the real connection string into a chat, a commit or a file in the repository.
5. **Verify.** `select count(*), max(name) from schema_migration;`, then `GET /api/health` on the live site, then open the dashboard and issue a test invoice in a test business.
6. **Then merge to `main`**, which deploys to Vercel.

Never merge code that needs a migration to `main` before the migration is applied. This is what the push policy was protecting: the hosted database was behind the code once and creating invoices would have failed.

### Hosted Postgres detail: pgcrypto lives in the `extensions` schema

On Supabase the `pgcrypto` extension is installed in the `extensions` schema, so `digest()` is not on the `search_path` that Kora's functions use (`public`). `0109_pgcrypto_on_hosted.sql` creates `public.digest(text, text)` and `public.digest(bytea, text)` wrappers when, and only when, `digest` is missing from `public` and present in `extensions`. On a plain Postgres (local Docker) it does nothing. Rules for new migrations: if you need `digest()`, `gen_random_bytes()` or another pgcrypto function inside a function body, test it against a Supabase database, not only the local one.

| Item | Status | Evidence |
|---|---|---|
| The 51 migrations have been run in order from an **empty** hosted database | **Unknown** | Production was built up over time. Only a plain Postgres has been migrated from empty (checked while writing this). To prove it, create a throwaway Supabase project or branch and run `pnpm migrate` against it |

## 4. Backups and the restore drill

| Item | Status | Evidence |
|---|---|---|
| Backup script: custom-format `pg_dump`, read-back check, AES-256 encryption, copy to S3-compatible storage, local pruning | **Done** | `infra/backup.sh` |
| Restore check script: loads a backup into a scratch database and compares row counts | **Done** | `infra/restore-check.sh` |
| Scheduled daily backup | **Not done** | `.github/workflows/backup.yml` runs at 02:30 IST only when the repository variable `BACKUPS_ENABLED` is `true` and the secrets exist. **Check:** GitHub, Settings, Secrets and variables, Actions |
| A bucket you own, with keys that can write to it only | **Unknown** | |
| The passphrase is stored somewhere other than the backup bucket | **Unknown** | Without it the files cannot be opened |
| Supabase's own daily backups | **Unknown** | Paid plans only, according to `docs/deploy.md` |
| A restore drill, done once, with the date written down | **Not done** | No record in the repository |

### Restore drill (do this once before launch, then monthly)

1. Download the newest backup file from the bucket.
2. On a machine with Postgres 16 tools and a scratch server (the local Docker one is fine):

   ```bash
   RESTORE_FILE=./kora-20261023T210000Z.dump.enc \
   BACKUP_PASSPHRASE='<from your password manager>' \
   RESTORE_ADMIN_URL='postgres://postgres:<password>@localhost:54329/postgres' \
   bash infra/restore-check.sh
   ```

   It restores into a throwaway database, compares row counts, and drops it. Non-zero exit means the backup is not good.
3. Do a second, human check: restore into a scratch database, point a local copy of the app at it (`DATABASE_URL`), sign in, open an invoice and download its PDF.
4. Write the date, the file name and the result in a log the team can see.

A backup holds the database only. It does not hold the code (Git), the environment variables (keep a copy of the **names** and where each value came from in a password manager), or files in object storage (turn on versioning on that bucket).

## 5. Monitoring and alerts

| Signal | How to read it | Status |
|---|---|---|
| Web is up and the database answers | `GET /api/health` returns `{"status":"ok"}` or 503 | **Not done**: no uptime monitor is configured in the repository. Point any uptime service at it |
| Worker is alive (if a worker is used) | `GET /healthz` on `WORKER_HEALTH_PORT`, 503 when stalled for a minute | **Not done** (no worker deployed, see section 11) |
| Application errors | One JSON log line per event on stdout; plus Sentry when `SENTRY_DSN` is set (`packages/core/src/observe.ts`, `apps/web/instrumentation.ts`) | **Unknown** (DSN) |
| Queue health | `GET /api/admin/jobs` with `Authorization: Bearer <CRON_SECRET>`: counts by queue and status, the oldest waiting job, the 25 latest failures | **Done** (route exists, and `.github/workflows/watch.yml` polls it every 15 minutes). **Not done** until the two repository secrets are added (section 11) |
| Failed work | The SQL list in [deploy.md](deploy.md) under Monitoring (jobs, e-invoices, unprocessed payment webhooks, failed webhook deliveries, failed recurring runs) | **Done** as queries (checked against a migrated database). **Not done** as alerts |

Minimum alerts to set up before launch: uptime of `/api/health`; Sentry alert on new issues; a daily check that `/api/admin/jobs` shows no job older than a day; Razorpay's own email for failed webhooks; Supabase's disk and connection alerts.

## 6. Rate limits

| Limit | Where | Value | Notes |
|---|---|---|---|
| API key | `apps/web/lib/apiV1.ts` | 120 a minute for each key (`API_RATE_LIMIT`) | Counted in each server process, so it is a runaway-loop guard. On Vercel each function instance counts separately |
| Address across `/api` | `apps/web/middleware.ts` | 300 a minute for each address (`API_RATE_PER_MINUTE`) | **Only when Upstash is configured.** Webhooks, `/api/cron/*` and `/api/health` are exempt. If Upstash is down the request goes through |
| Sign-in codes and attempts | `packages/core/src/auth.ts` with `ratelimit.ts` | 20 code requests from one network address in 15 minutes, and per-address limits on wrong guesses, plus limits kept with each code | Uses Upstash when set, and falls back to Postgres (`rate_event` table) if Upstash errors or is not set |
| Outgoing webhooks | `packages/core/src/webhooks.ts` | 10 second timeout, retries with growing delay, switched off after 20 failures in a row | |

Status: **Done** in code. **Unknown** whether Upstash is configured in production. Put a rate limit at the edge (Vercel Firewall) as well if the API is exposed widely.

## 7. Domain and email sender

| Item | Status | Evidence / check |
|---|---|---|
| A domain you own, attached to the Vercel project, with HTTPS | **Unknown** | The code falls back to `https://kora-invoice.vercel.app` (`apps/web/lib/site.ts`). Set `APP_URL` and `NEXT_PUBLIC_SITE_URL` to the final address |
| Desktop and Android shells point at the final address | **Not done** | `apps/desktop/src/app-config.json` and `apps/mobile/capacitor.config.json` both open `https://kora-git-main-platter2.vercel.app/login`, the alias of the latest `main` deployment, not a permanent production domain (`docs/apps.md`). A new app version must be published after the address changes |
| Email sender domain verified at Resend (SPF and DKIM records in DNS) | **Unknown** | `EMAIL_FROM` must use that domain. Add a DMARC record too |
| A real support address and a grievance officer address | **Not done** | Placeholders listed in section 1, item 2 |
| `robots.txt` and sitemap | **Done** | `apps/web/app/robots.ts`, `sitemap.ts` |
| Security headers (HSTS in production, no framing, no sniffing) | **Done** | `apps/web/next.config.mjs` |

### Where the final address has to be written

When the domain exists, the same address appears in several places. Missing one gives a quiet fault, not an error.

| Where | Name or file | What goes wrong if it is missed |
|---|---|---|
| Vercel environment | `APP_URL` | Message links, payment links and share links point at the old host |
| Vercel environment | `NEXT_PUBLIC_SITE_URL` | Sitemap, canonical links and structured data name the old host (falls back to `APP_URL`, then `https://kora-invoice.vercel.app`) |
| GitHub repository secret | `KORA_SITE_URL` | The 5 minute tick and the queue watch call the old host |
| Razorpay dashboard (live) | Webhook URL `<address>/api/webhooks/razorpay` | Payments are not matched |
| Resend | Verified sending domain, `EMAIL_FROM` | Email lands in spam or is refused |
| `apps/desktop/src/app-config.json`, `apps/mobile/capacitor.config.json` | `url` | Installed apps open a deployment alias. Publish a new app version afterwards |
| Privacy, terms and refunds pages | Support and grievance addresses | Placeholders stay public (section 12) |

## 8. Sign-in codes (MSG91, Resend) and WhatsApp

### SMS and sign-in codes: MSG91

1. Register the business entity, header (sender id) and templates for DLT. This takes days to weeks.
2. Create two Flow templates, each with exactly one variable: one for sign-in codes, one for general messages. Note both template ids.
3. Set `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`, `MSG91_SMS_TEMPLATE_ID`, and the variable names if you did not use `OTP` and `MESSAGE`.
4. Set `OTP_PROVIDER=live`.
5. Test with your own number from the live site. Check that the SMS arrives, the code works once, and a second use is refused.

Status: **Unknown**. Code: `packages/adapters/src/live.ts` (`createMsg91`). The sign-in SMS goes through MSG91's Flow API with `template_id` and one variable.

### Email: Resend

Verify the domain, create an API key that can only send, set `RESEND_API_KEY` and `EMAIL_FROM`. Status: **Unknown**. The sign-in email says the code works once and expires in 10 minutes.

### WhatsApp: Meta WhatsApp Cloud API

1. Business verification at Meta and a WhatsApp Business number.
2. Create a message template with **one body variable** (Kora puts the whole message and the link in it) and get it approved. Business-started messages to customers must use an approved template.
3. Set `MESSENGER=live`, `WHATSAPP_TOKEN` (a permanent system user token, not the 24 hour test token), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`, and `WHATSAPP_TEMPLATE_LANG` if not `en`. Messages also need `RESEND_API_KEY` and `MSG91_SMS_TEMPLATE_ID` for the email and SMS channels.
4. Send an invoice to your own number from a test business and check the Send history shows delivered.

Status: **Unknown**. Note that the Graph API version is fixed in code (`v20.0` in `createWhatsApp`); Meta retires old versions, so look at this at least once a year.

## 9. Payment gateway: test mode to live

Code: `packages/adapters/src/razorpay.ts` (Payment Links, signature check on the raw body, one event handled: `payment_link.paid`). Status of the live switch: **Unknown**.

1. **In test mode first.** Set `GATEWAY=razorpay` with Razorpay's **test** key id and secret (`rzp_test_...`). Add a webhook in the Razorpay dashboard (test mode) to `https://<your-domain>/api/webhooks/razorpay`, tick `payment_link.paid`, choose a secret, and put that secret in `RAZORPAY_WEBHOOK_SECRET`. Redeploy (settings are read when a server process starts).
2. Issue an invoice, create a payment link, pay it with Razorpay's test card or UPI. Check: the invoice becomes paid, one payment row exists, and sending the same webhook again (Razorpay dashboard, replay) adds nothing.
3. Test a part payment and a payment for an invoice that is already paid (it shows as unapplied money).
4. **Switch to live.** Complete Razorpay's KYC. Replace the key id and secret with the **live** ones (`rzp_live_...`). Create a **live** webhook (webhooks are separate for test and live) with a new secret and put it in `RAZORPAY_WEBHOOK_SECRET`. Redeploy.
5. Make a real payment of Rs 1 or Rs 10 on a real invoice from your own business, then refund it at Razorpay. A payment taken through the gateway is refunded at the gateway; Kora refuses to delete it (`packages/core/src/payments.ts`).
6. Confirm `KORA_ALLOW_MOCKS` is not set. With it unset, `GATEWAY=mock` makes the web app throw in production.

Money is not auto-reconciled for QR scans that go straight to a bank account. The business records those by hand or from a bank statement (the Bank screen).

## 10. GST partner (e-invoice and e-way bill)

| Item | Status | Evidence |
|---|---|---|
| Choose a GST Suvidha Provider and get sandbox access | **Not done** | `docs/deploy.md` says accounts take weeks; none is named in the repository |
| Map the partner's field names and error codes | **Not done** | `docs/compliance.md` point 6: messages are keyed to the mock's codes |
| Register 50 or more sandbox invoices, including rejections | **Not done** | Checklist in `docs/deploy.md` |
| E-way bill payload checked against the live portal | **Not done** | Stated in the header of `packages/adapters/src/eway.ts` |
| Until then, tell users plainly | **Done** | Help articles `e-invoice` and `e-way-bills` say the live connection is not switched on |

Until a partner is chosen, keep `einvoice_enabled` off for real businesses. If it is on and the partner address is wrong, invoices show as failed and the owner can press Resubmit later.

## 11. Background work: the worker (chosen path)

Decision (owner, 23 October 2026): run the worker as a second service built from the `Dockerfile`. Status: **Not done** until the service is deployed and a test invoice is delivered within minutes. This is the item most likely to surprise a first customer.

What runs in the background: sending an invoice or reminder (`delivery.send`), statements (`statement.send`), e-invoice registration (`einvoice.register`) and webhook delivery (`webhook.deliver`), plus due reminders and recurring invoices. Web requests only put a job in the queue. Today `apps/web/vercel.json` calls `/api/cron/tick` once a day at 10:00 IST, so without a worker a WhatsApp send can wait until the next morning.

Steps:

1. Pick a container host that can run an always-on service from a Dockerfile (Fly.io, Render, Railway or similar). The web app stays on Vercel.
2. Build from the repository `Dockerfile`. The image default is the web command, so set the service command to `pnpm --filter @kora/worker start`.
3. Give it the same environment names as the web app (section 2): `DATABASE_URL` (the `kora_web` role), `GSP_URL`, `APP_URL`, `MESSENGER=live` with the `WHATSAPP_*`, `MSG91_SMS_TEMPLATE_ID`, `RESEND_API_KEY` and `EMAIL_FROM` names, `BLOB_S3_*`, `SENTRY_DSN`. Do not set `KORA_ALLOW_MOCKS`. For the worker, `DATABASE_URL` may use the session pooler (port 5432) or the transaction pooler (6543).
4. Set `WORKER_HEALTH_PORT` (for example `8081`) and point the host's health check at `/healthz`. The image's own `HEALTHCHECK` already uses it when set. It answers 503 when the loop has stalled for a minute.
5. Run two instances for availability. Jobs use `SKIP LOCKED`, so they never double-run work.
6. **Until the worker runs, use the interim scheduler in this repository.** `.github/workflows/tick.yml` calls `/api/cron/tick` every 5 minutes, and `.github/workflows/watch.yml` checks `/api/health` and the age of the oldest queued job every 15 minutes and fails (GitHub emails the repository owner) when something is stuck or has failed for good. Both stay idle until the owner adds two repository secrets (Settings, Secrets and variables, Actions): `KORA_SITE_URL` (the public address, starting with `https://`) and `CRON_SECRET` (the same value as the site's `CRON_SECRET`). GitHub can start a run a few minutes late, so this gives delivery within minutes, not seconds. Status: **Not done** until the secrets are added; check that the Actions tab shows green runs.
7. Keep the daily Vercel cron as a safety net. It is harmless alongside a worker.
8. Test: issue an invoice in a test business, press Send to your own number, and check Send history shows delivered within a couple of minutes. Check `GET /api/admin/jobs` shows nothing waiting.
9. Decide who watches `/api/admin/jobs` and the worker health check (section 5).

Alternatives that were considered and not chosen: calling `/api/cron/tick` every minute or two from an external scheduler, or per-minute cron on a paid Vercel plan.

## 12. Legal pages

| Page | Status | What is missing |
|---|---|---|
| Terms (`/terms`) | **Not done** | "Written to match ... a lawyer should review" (comment in the file). `support@kora.example` placeholder |
| Privacy (`/privacy`) | **Not done** | Same. `privacy@kora.example` placeholder for the grievance officer |
| Refunds (`/refunds`) | **Not done** | Two "[... to be decided]" values and a placeholder address |
| Pricing (`/pricing`) | **Not done** | Marked "Placeholder price" on purpose |
| Where the data lives is stated in the privacy page | **Unknown** | `docs/deploy.md` says the database is in Sydney (ap-southeast-2). Say so in the privacy page, or move it to an Indian region |
| Data protection review (consent, retention, breach notice, residency) | **Not done** | `docs/compliance.md`, "Data protection" |
| CA has reviewed the tax rules and returns data | **Not done** | `docs/compliance.md`, "What a CA must confirm before beta" |

These are the owner's and a lawyer's decisions. Nothing in this repository changed them.

## 13. Rollback plan

| Situation | What to do |
|---|---|
| A bad web deploy | Vercel, Deployments, find the last good one, **Promote to Production** (instant, no rebuild). Do not revert Git first; stop the bleeding, then fix forward. Because migrations are additive, the previous code runs on the newer schema |
| A migration failed | It rolled back as a unit. Fix forward with a new numbered file. Do not edit a file that was applied |
| A migration succeeded but is wrong | Write a new migration that corrects it. Never run `drop` by hand on production without a fresh backup |
| Data was damaged | Stop writes if needed (pause the project or put up a maintenance page), restore the last good backup into a **new** database, compare, then switch `DATABASE_URL` or copy the rows back. Practise this in the restore drill |
| A bad environment value | Fix it in Vercel and redeploy; settings are read at process start |
| Messages going to real customers by mistake | Unset `MESSENGER` live settings or pause the cron; failed work can be put back with `POST /api/admin/jobs` |
| Payment webhook wrongly rejected | Razorpay retries. Fix the secret, then replay events from the Razorpay dashboard. Duplicates are ignored by event id |

The database is forward-only on purpose. The rollback for data is a restore, so the backup and the drill are part of the rollback plan, not a separate topic.

## 14. Who to call

Not in the repository. The owner fills this in before launch and keeps it where the team can find it.

| Need | Who | How to reach them |
|---|---|---|
| Owner and decision maker | | |
| Whoever deploys and rolls back | | |
| Database (Supabase support, plan, project) | | |
| Hosting (Vercel team and plan) | | |
| Payments (Razorpay account manager) | | |
| SMS and DLT (MSG91) | | |
| WhatsApp (Meta Business support) | | |
| Email (Resend) and DNS | | |
| GST partner | | |
| CA who reviews the tax rules | | |
| Lawyer for terms, privacy and refunds | | |
| Customer support in Hindi and English | | |

## 15. Final pass before telling the first customer

- [ ] `KORA_ALLOW_MOCKS`, `DEMO_FIXED_OTP` and `KORA_WEBHOOK_ALLOW_PRIVATE` are not set in production.
- [ ] `OTP_PROVIDER=live` and a real sign-in works from a phone that is not yours.
- [ ] A background runner is in place (section 11) and a test invoice is delivered within minutes.
- [ ] Razorpay is in live mode and a Rs 1 payment was matched and refunded.
- [ ] A backup ran last night and a restore drill was done.
- [ ] `/api/health` is monitored and Sentry shows a test error.
- [ ] Legal pages and pricing carry real text.
- [ ] The row-level security check in section 3 shows `kora_web` as neither superuser nor `BYPASSRLS`.
- [ ] The "who to call" table is filled in.
