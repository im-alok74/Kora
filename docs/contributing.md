# Contributing

This page collects the habits that are already visible in the code, so a new person can follow them without guessing. If this page and the code disagree, the code wins; please fix the page.

Start with the [README](../README.md) to get the app running and the tests passing, then read [architecture.md](architecture.md) for the map.

## Before you start

- Node 22, pnpm 10, Docker. `pnpm install`, `cp .env.example .env`, `pnpm db:up`, `pnpm migrate`, `pnpm dev:all`.
- Never put a real secret, token, password, key or connection string in the repository, in a test, in a document or in a commit message. `.env` is ignored by Git. `.env.example` holds placeholders and local development values only, and a test checks that.
- Work on your own branch. Do not push to `main`. Merging to `main` deploys the live site on Vercel, so a change that needs a database migration is merged only after that migration has been applied to the production database ([launch-checklist.md](launch-checklist.md), section 3).

## Rules that are never broken

1. **No floating point for money.** Money is whole paise. In SQL use `bigint`. In TypeScript use `bigint` (as `packages/tax` does) or a decimal string parsed by `parseRupees()`. Never use `number` arithmetic, `parseFloat`, `toFixed` or `Math.round` on an amount. The API returns paise as strings and takes rupees as text such as `"500.00"`.
2. **Issued documents are immutable.** A change to an issued invoice is a credit note or a debit note. Do not add a way around the database triggers.
3. **The database enforces the rules.** A rule that protects the legal record (numbering, totals, immutability, payment allocation, tenant isolation, audit) lives in a migration as a trigger, constraint or policy. The application also checks it so people get a plain message, but the database is the authority.
4. **Every tenant table is isolated.** A new table with a `business_id` gets row-level security with the standard policy, grants to `kora_app`, and an audit trigger where the data is a record of something that happened. Read `0007_authz.sql` and copy the pattern. Queries on tenant data go through `withTenant()` or `inTenant()`, never straight on the connection.
5. **No em dashes** (the long dash, U+2014) anywhere in project files: code, comments, documents, help articles, page text. The same goes for the en dash used as a pause. Use a full stop, a comma, a colon or brackets. The help-centre test enforces this for help articles.
6. **No secrets, no live calls.** Tests and development use the mock adapters. Nothing in tests calls a real government, payment, SMS, email or WhatsApp service.
7. **Do not copy other products.** Features can be inspired by what public product pages say they do. Copy, templates, icons, code, layout and brand are written from scratch. Names of other products appear only where a user needs them, for example in the import guide. See `replica/brand.json`.

## Writing code

- TypeScript with ES modules. Relative imports of workspace files end in `.js` (the package convention), even though the source is `.ts`.
- Match the file you are in: naming, comment density, quoting, line length. There is no formatter or linter configuration to run; `pnpm typecheck` is the gate.
- Comments say why, not what. Look at `packages/core/src/jobs.ts` or `packages/core/src/portal.ts` for the tone.
- Errors a person can fix are `ValidationError(message, field)` with a plain-words message. Say what is wrong and what to do. Write in simple Indian business English: "Enter the legal name of the business", not "Invalid input".
- New outside services go behind an interface in `packages/adapters` with a mock, selected by an environment variable. In production the mock must refuse to start unless `KORA_ALLOW_MOCKS=1`.
- Any new environment variable is added to `.env.example` with a one-line explanation. `apps/web/test/envDocs.test.ts` fails if you forget.
- Screens: every one works at 375 px width, has visible keyboard focus, labels on inputs, passes AA contrast, and works in the dark theme. Page text is short and plain.

### Locking: read a total, then write against it

Transactions run at READ COMMITTED. Two requests that each read a total, check it, then write can both pass the check. Whenever code reads a number from a row (what is already credited, what is already paid, a balance) and then decides whether to write against it, lock the row that owns the number first with `select ... for update`, in the same transaction. The credit note race (audit finding C-1) was exactly this. Where the rule matters most, `packages/core/test/lock-convention.test.ts` fails if the lock is removed. Add the function there when you add another place like it. Where possible, also let the database refuse the bad state (see migration 0186).

## Migrations

- Files are in `packages/db/migrations`, named `NNNN_what_it_does.sql`. They run in **file name order**, all pending ones in one transaction, under an advisory lock.
- Use a number **higher than the highest existing file** (today the highest is `0141`, so use `0142` or more). There are gaps in the sequence on purpose. A lower number still runs, but out of the order it was written for.
- Forward-only and additive: new tables, new nullable columns, new indexes, new functions. Never edit a file that has been applied anywhere. Never drop or rename something the running code still reads. A removal takes two releases.
- Test on the local database (`pnpm migrate`, then `pnpm test`). If the migration touches functions that use pgcrypto, also test it on hosted Postgres ([troubleshooting.md](troubleshooting.md), entry 2).
- After adding tables, regenerate the schema reference: `MIGRATE_DATABASE_URL=<local owner url> pnpm --filter @kora/db erd`, and commit `docs/database.md`.

## Tests

Tests are expected with every change. Match what exists:

| Kind | Where | How |
|---|---|---|
| Tax and money | `packages/tax/test` | Plain cases, property tests with `fast-check` (10,000 runs), and a cross-check against the database |
| Services | `packages/core/test` | `makeTestDb()` gives a throwaway, fully migrated database. Create a business and a user, call the service as that user, and also test that another business cannot see the data |
| Database rules | `packages/db/test`, `infra/smoke.sh` | SQL level checks as the real roles |
| Adapters | `packages/core/test/live-adapters.test.ts` | Inject `fetch` so the exact request is checked without calling anyone |
| Web helpers and docs | `apps/web/test` | Pure functions, the help articles, and that `docs/api.md`, `openapi.json` and `.env.example` agree with the code |
| Whole flows | `e2e/tests` | Playwright against a production build. Slow; run the files for the area you touched |

Run, in this order, before you open a pull request:

```bash
pnpm typecheck
pnpm test
pnpm --filter @kora/web build     # a Vercel deploy only works if this passes
pnpm e2e                          # or just the spec files for your area; read README first (ports 3200 to 3202)
```

Fix a failing test by fixing the cause. Do not delete a test or loosen an assertion to get green.

## When you change the public API or the docs

- Adding, removing or renaming a route under `apps/web/app/api/v1`: update `apps/web/public/openapi.json` and the endpoint table in `docs/api.md` in the same change. `apps/web/test/apiDocs.test.ts` fails otherwise. A new webhook event goes in `WEBHOOK_EVENTS` and in the table in `docs/api.md`.
- Changing what a screen does: update the help article in `apps/web/lib/help.ts` (steps use the real button names). `apps/web/test/helpLabels.test.ts` lists every button an article quotes and fails when a screen no longer contains it; add a row when you quote a new one. Do not claim something the product does not do yet; say "early access" or "not built yet".
- Changing a limit, a default or a role: search the README, `docs/` and `help.ts` for the old value.
- Docs are plain Markdown, no em dashes, no secrets, links relative. Use placeholders such as `<project-ref>` for anything that would identify an account or a credential.

## Commits, branches and pull requests

- Branch from `main`: `git checkout -b short-name origin/main`. Keep a branch to one purpose.
- Commit often. The first line is a short sentence in the imperative or past tense that says what changed (`Migration 0109: make digest() reachable on hosted Postgres where pgcrypto lives in the extensions schema` is the style). Add a body when the reason is not obvious. Commits made with an AI assistant end with a `Co-Authored-By:` line.
- Rebase on `origin/main` before you open the pull request. Do not force-push to a branch someone else is using. Never force-push `main`.
- Open a pull request into `main` with a plain summary: what changed, what you tested, what you could not test, and a **Needs you** section for anything only the owner can decide (provider choices, prices, legal wording, access to accounts).
- CI (`.github/workflows/ci.yml`) runs the SQL smoke test, typecheck, unit tests, the web build and the browser suite. A pull request is ready when it is green.
- Do not edit production settings, the production database, Vercel or any cloud account as part of a code change. Those steps are written down in [launch-checklist.md](launch-checklist.md) and done by the owner.
