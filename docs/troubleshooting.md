# Troubleshooting

Problems that were met while building and deploying Kora, with the cause and the fix. Each entry says how to recognise it. Commands are for a terminal in the repository root. Where a command differs on Windows PowerShell, both are given.

## Contents

1. [Cannot reach the Supabase database (IPv6-only direct host)](#1-cannot-reach-the-supabase-database-ipv6-only-direct-host)
2. [`function digest(...) does not exist` on hosted Postgres (pgcrypto schema)](#2-function-digest-does-not-exist-on-hosted-postgres-pgcrypto-schema)
3. [Next.js dev and build share `.next`](#3-nextjs-dev-and-build-share-next)
4. [Port clashes and leftovers in the browser tests](#4-port-clashes-and-leftovers-in-the-browser-tests)
5. [`pnpm migrate` says `MIGRATE_DATABASE_URL is not set`](#5-pnpm-migrate-says-migrate_database_url-is-not-set)
6. [Tests say `Cannot reach test Postgres`](#6-tests-say-cannot-reach-test-postgres)
7. [Sign-in code never arrives](#7-sign-in-code-never-arrives)
8. [The app throws at start-up about a missing setting](#8-the-app-throws-at-start-up-about-a-missing-setting)
9. [PDFs fail](#9-pdfs-fail)
10. [Messages, e-invoices or webhooks stay queued](#10-messages-e-invoices-or-webhooks-stay-queued)
11. [Webhooks to localhost are refused](#11-webhooks-to-localhost-are-refused)
12. [Windows habits that bite](#12-windows-habits-that-bite)

## 1. Cannot reach the Supabase database (IPv6-only direct host)

**You see:** `getaddrinfo ENOTFOUND db.<project-ref>.supabase.co`, `ENETUNREACH`, or a connection that hangs, from `pnpm migrate`, `pg_dump`, `psql`, or a GitHub Actions run. The same URL may work from another network.

**Cause:** the direct database host (`db.<project-ref>.supabase.co`, port 5432) has only an IPv6 address. Many home and office networks, and GitHub-hosted runners, are IPv4 only. Vercel's runtime also cannot rely on it.

**Fix:** use Supabase's pooler (Supavisor), which has IPv4 addresses. There are two modes on the pooler host, and the user name carries the project reference after a dot:

| Use | Mode | Port | User |
|---|---|---|---|
| Migrations, `pg_dump`, backups, `restore-check`, any long session | Session | 5432 | `kora_owner.<project-ref>` |
| The web app on Vercel (many short-lived functions) | Transaction | 6543 | `kora_web.<project-ref>` |

```bash
# migrations from a laptop (placeholders only; take the host and password from the Supabase dashboard)
MIGRATE_DATABASE_URL='postgres://kora_owner.<project-ref>:<password>@<pooler-host>:5432/postgres' pnpm migrate
```

Notes:

- Transaction mode does not support prepared statements. `createSql()` in `packages/db/src/index.ts` turns them off when the URL contains `:6543/`, so nothing else is needed.
- Transaction mode is fine for Kora's tenant settings because they are set with `set_config(..., true)` inside a transaction.
- Do not run `pnpm migrate` through transaction mode: it holds an advisory lock and a long transaction. Use session mode.
- The backup workflow already says this: `BACKUP_DATABASE_URL` is the pooler in session mode.
- Never paste the full connection string into a chat, a commit, or a document.

## 2. `function digest(...) does not exist` on hosted Postgres (pgcrypto schema)

**You see:** on the live site, share links, the public invoice page or the quote page fail with `function digest(text, unknown) does not exist` (or `digest(bytea, ...)`) in the logs. Everything works on a local Docker database.

**Cause:** Supabase installs the `pgcrypto` extension in the `extensions` schema. Kora's database functions run with `search_path = public`, so `digest()` is not found. A plain Postgres puts it in `public`.

**Fix:** migration `0109_pgcrypto_on_hosted.sql`. It creates `public.digest(text, text)` and `public.digest(bytea, text)` that call `extensions.digest`, and only when `public.digest` is missing and `extensions.digest` exists. On a plain Postgres it does nothing, so it is safe everywhere. Production has it applied.

**To check:**

```sql
select to_regprocedure('public.digest(text,text)'), to_regprocedure('extensions.digest(text,text)');
```

On Supabase both should be non-null. On local Docker only the first is.

**When writing a new migration** that calls any pgcrypto function inside a function body, call it unqualified only if a wrapper like this exists, and test the migration against a Supabase database as well as the local one.

## 3. Next.js dev and build share `.next`

**You see:** after running `pnpm build` (or an end-to-end run) while `next dev` is running, or the other way round, the dev server shows blank pages or 500 errors, or the build stops with `no direct app page entry found for /_not-found`, or pages that you changed do not update.

**Cause:** `next dev` and `next build` both write to `apps/web/.next`. Two processes writing one folder corrupt each other's output.

**Fix and habits:**

- The browser tests already avoid this: they build into `apps/web/.next-e2e` (`NEXT_DIST_DIR=.next-e2e` in `e2e/playwright.config.ts`).
- For anything else that runs next to a dev server, give it its own folder: `NEXT_DIST_DIR=.next-mine pnpm --filter @kora/web build`. The setting is read in `apps/web/next.config.mjs`. Check that the new folder name is ignored by Git (`git check-ignore -v apps/web/<folder>`), and add it to `.gitignore` if it is not.
- If it is already broken: stop the dev server, delete the folder (`rm -rf apps/web/.next`, or in PowerShell `Remove-Item -Recurse -Force apps\web\.next`), start again.
- Run only one `next dev` per folder, and two dev servers need two ports (`next dev -p 3430`).

## 4. Port clashes and leftovers in the browser tests

**You see:** `pnpm e2e` fails at once with `port 3202 is already used` or `http://127.0.0.1:3202/healthz is already used`, or runs and then fails in odd ways, or hangs waiting for a server.

**Cause:** the Playwright setup (`e2e/playwright.config.ts`) starts the mock partner on **3202**, the worker health page on **3201** and the web app on **3200**, and uses one fixed database called `kora_e2e`. `pnpm dev:all` also starts the mock partner on 3202. A previous run that was killed can leave a server behind. Two e2e runs at the same time share the same ports and the same database and will break each other.

**Fix:**

```bash
# see who holds the ports (Git Bash, Windows)
netstat -ano | grep -E ":320[0-2] "
```

```powershell
# PowerShell: list, then stop by process id
Get-NetTCPConnection -LocalPort 3200,3201,3202 -State Listen | Select-Object LocalPort, OwningProcess
Stop-Process -Id <OwningProcess>
```

- Stop `pnpm dev:all` before `pnpm e2e`, or set `KORA_E2E_REUSE=1` so the run reuses servers that are already listening.
- Run only one e2e at a time on a machine. If several people or agents share one machine, take a lock file before running and remove it afterwards.
- `pnpm e2e` starts with `tsx scripts/prepare-db.ts`, which drops and recreates `kora_e2e`. To run a single file after that: `pnpm --filter @kora/e2e exec playwright test tests/first-invoice.spec.ts`.
- The suite is a production build, so the first start takes minutes. A slow start is not a hang; read the log.
- Use other ports for a dev server of your own (for example 3430) so that you never sit on 3200 to 3202.

## 5. `pnpm migrate` says `MIGRATE_DATABASE_URL is not set`

**Cause:** pnpm does not read `.env`. Before this was fixed, the migrate command only worked if you had exported the variable yourself.

**Fix:** `pnpm migrate` now loads the repository's `.env` when the variable is not already in the environment (`packages/db/src/migrate-cli.ts`). Check that you ran `cp .env.example .env` in the repository root. Variables already set in your shell always win, so production commands that pass the URL on the command line are unchanged.

## 6. Tests say `Cannot reach test Postgres`

**Cause:** the Docker database is not running, or its port 54329 is taken.

**Fix:** `pnpm db:up` (waits until the database is healthy). Check with `docker ps`; the container is called `kora-db-1`. If port 54329 is in use by something else, stop that program. `pnpm db:down` deletes the local data volume; use it only when you want a clean start.

Each test file creates its own database named `kora_t_` plus random letters and drops it afterwards. A crashed run can leave a few behind; remove them with `drop database kora_t_...` as the `postgres` user.

## 7. Sign-in code never arrives

- **Local development:** nothing is sent. The code is printed in the terminal that runs the web app, on a line starting `[mock-otp]`.
- **Too many requests:** after 20 code requests from one address in 15 minutes the app answers "Too many requests from this network". Wait, or on a local database run `delete from rate_event;`.
- **Production:** `OTP_PROVIDER=mock is not allowed in production` means `OTP_PROVIDER=live` and the provider keys are missing. Set them ([launch-checklist.md](launch-checklist.md), section 8). `MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID are not set` or `RESEND_API_KEY and EMAIL_FROM are not set` name exactly what is missing. A provider's own message (for example an unapproved DLT template) appears in the error.

## 8. The app throws at start-up about a missing setting

| Message | Fix |
|---|---|
| `DATABASE_URL is not set (see .env.example)` | Set it. Locally, check `.env` in the repository root |
| `GSP_URL is not set` | Required by the web app and the worker even if e-invoicing is off. Locally it is `http://127.0.0.1:3202` |
| `OTP_HMAC_SECRET must be at least 32 characters` | Use a longer random value |
| `The mock payment gateway is not allowed in production` | Set `GATEWAY=razorpay` and its keys. Do not set `KORA_ALLOW_MOCKS` in production |
| `The mock messenger is not allowed in production` | Set `MESSENGER=live` and the provider keys |
| `Unknown GATEWAY "x"`, `Unknown MESSENGER "x"` | The values are `mock` or `razorpay` (gateway), `mock` or `live` (messenger and sign-in codes) |

## 9. PDFs fail

- **Locally:** Chromium is not installed for Playwright. Run `pnpm --filter @kora/pdf exec playwright install chromium`.
- **On Vercel:** there is no browser. When `VERCEL` is set (or `PDF_CHROMIUM=sparticuz`), PDFs use `@sparticuz/chromium`, which is shipped with the two PDF routes through `outputFileTracingIncludes` in `apps/web/next.config.mjs`. The first PDF after a quiet period takes a few seconds.
- **Vercel says `invalid deployment package for a Serverless Function`:** a symlinked folder was included. The config points at the real folder in the workspace store (`node_modules/.pnpm/@sparticuz+chromium@*/...`) for that reason; keep it that way when you upgrade the package.

## 10. Messages, e-invoices or webhooks stay queued

**Cause:** nothing is running the job queue. Web requests only add jobs.

**Check:** `GET /api/admin/jobs` with `Authorization: Bearer <CRON_SECRET>` shows counts by queue and status and the latest failures. Locally, `select queue, status, count(*), min(created_at) from job where status <> 'done' group by 1, 2;`.

**Fix:** run the worker (`pnpm --filter @kora/worker start`, included in `pnpm dev:all`), or call `GET /api/cron/tick` with the same bearer secret. In production the tick runs once a day unless you changed `apps/web/vercel.json`; see [launch-checklist.md](launch-checklist.md), section 11. Failed jobs can be put back with `POST /api/admin/jobs` and body `{ "queue": "einvoice.register" }`, or an empty body for every queue. Retries use 30 seconds, doubling to an hour, up to 8 tries.

## 11. Webhooks to localhost are refused

Outgoing webhooks go only to public `https` addresses, checked again when connecting. For local testing set `KORA_WEBHOOK_ALLOW_PRIVATE=1` in `.env`, restart web and worker, and use an `http://localhost` receiver. The end-to-end suite sets it for itself. Never set it in production.

## 12. Windows habits that bite

- **Git Bash rewrites paths.** An argument that starts with `/` (such as `/app/invoices`) is turned into a Windows path. Put `MSYS_NO_PATHCONV=1` in front of the command.
- **Line endings.** Git warns that `LF will be replaced by CRLF`. That is `core.autocrlf=true` and is harmless. Do not convert whole files by hand; it makes the diff huge.
- **Regular expressions with backslashes** pasted through a shell here-document can lose their backslashes. Put code with backslashes in a file with your editor instead.
- **Copying `.env`:** `cp .env.example .env` in Git Bash, `Copy-Item .env.example .env` in PowerShell.
- **Docker Desktop must be running** before `pnpm db:up`.
- **Long paths:** if `pnpm install` fails with path errors, enable long paths in Windows and Git (`git config --global core.longpaths true`).
