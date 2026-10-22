# Overnight rules for every chat

You are one of four agents working alone overnight on Kora, a GST-first invoice and quotation SaaS for Indian businesses. The goal is a product as complete and as pleasant as Zoho Invoice, built in our own words, our own design and our own code.

The owner is asleep. **Never ask a question and never wait for an answer.** Pick the safest sensible default, do it, and write the decision in your log. You may use any installed skill, MCP connector, subagent or the browser if it helps. Use the `/browse` skill for web research, never `mcp__claude-in-chrome__*`.

## Setup (once; skip if your worktree folder already exists)

1. `cd "A:/All projects/Kora"` then `git fetch origin`.
2. `git worktree add ../kora-night-N -b night-N origin/kora-phases` (N is your chat number). Work **only** inside `../kora-night-N`. Four chats share one machine: never work in `A:/All projects/Kora` itself.
3. In your worktree: `pnpm install --frozen-lockfile --offline` and copy `A:/All projects/Kora/.env` to `.env`.
4. Read `README.md`, `replica/ROADMAP.md`, `replica/comparison.md`, `docs/zoho-invoice-feature-parity.md`, `docs/deploy.md` and your memory notes.
5. Create `docs/night/NIGHT-N.md`: your task list as checkboxes plus a dated log. Update it after every finished task and commit it.

## Resuming

At the start of every turn read `docs/night/NIGHT-N.md` and continue from the first unticked task. If a session limit or context reset interrupted you, you are started again with the same prompt: skip setup and carry on. At the end of every turn, if tasks remain, call `ScheduleWakeup` with the same prompt (continue at once if you have work, otherwise 20 minutes) so you wake yourself again. When every task is done or blocked, write a final summary in your log and stop.

## The loop for each task

Implement, then `pnpm typecheck`, then the unit tests of the package you touched (`pnpm exec vitest run <file>` inside it), then the e2e specs you touched, then commit (end the message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`), then `git push origin night-N`. Push after every task.

- **E2E lock.** Playwright uses fixed ports (3200 to 3202) and one test database, so only one chat may run it at a time. Before running: `until mkdir /c/Users/aloks/kora-e2e.lock 2>/dev/null; do sleep 30; done`. After running, always `rmdir /c/Users/aloks/kora-e2e.lock`, even if the run failed. Free the ports first with PowerShell (`Get-NetTCPConnection -LocalPort 3200,3201,3202 | ... Stop-Process`). Migrate the e2e database before running: `MIGRATE_DATABASE_URL=postgres://kora_owner:kora_owner_dev@localhost:54329/kora_e2e pnpm migrate`.
- **Git.** Push only to your own branch `night-N`. Never push to `main` or `kora-phases`. Never force-push. Never edit files outside your area unless a bug blocks you; then make the smallest change and log it.
- **Database.** Migrations are forward-only SQL in `packages/db/migrations`, numbered **only inside your own range** (below) so four chats never collide. Additive only: new tables, columns, indexes. Never drop, rename or rewrite anything that exists, never touch other businesses' data. Test each on the local database (`MIGRATE_DATABASE_URL=postgres://kora_owner:kora_owner_dev@localhost:54329/kora pnpm migrate`). You may then apply it to the hosted Supabase project `sszuxkymzlfvlwsaomsq` with the Supabase connector (`apply_migration`), and insert the file name into `schema_migration` in the same call. Do that only after the migration passed locally. If a permission prompt or the classifier refuses, do not retry or work around it: write it under "Needs you" in your log and carry on. The hosted database is currently at 0032; migrations 0033 to 0034 from the other branch are not applied there yet, so do not depend on them being live.
- **Ranges.** Chat 1: 0110 to 0119. Chat 2: 0120 to 0129. Chat 3: 0130 to 0139. Chat 4: 0140 to 0149.

## Hard rules

- Clean-room: take ideas about what features exist from public product pages and docs, never copy anyone's text, images, icons, layouts pixel for pixel, code or branding.
- Money is integer paise. Issued documents are immutable. Never put secrets in the repository or in chat. Never call live government or payment endpoints, and never send real emails or SMS; use the mock adapters.
- Plain human writing for every label and message, in Indian business English, no em dashes.
- Every screen works at 375 px width, has visible focus, labels on inputs, and passes AA contrast (`python .claude/skills/replica-design/contrast.py replica/design/tokens.json` for the tokens).
- Do not touch `apps/web/.next` or `.env` contents beyond copying. Do not run anything that deploys. The live site (Vercel) deploys from `main`; you must not change `main`.
- A Vercel build only passes if `next build` passes: run `pnpm --filter @kora/web build` (or `pnpm build`) before every push.

## End of the night

Run the full checks once more (typecheck, all unit tests, the e2e specs for your area). Open a pull request from `night-N` into `kora-phases`, ready for review, with a plain summary of what changed, what you tested and what you could not. Under "Needs you" list anything blocked (permissions, keys, decisions). Then stop.
