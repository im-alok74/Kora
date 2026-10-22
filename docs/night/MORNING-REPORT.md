# Morning report (integrator, written 22 Oct 2026, 15:30)

This is an interim report. The four night chats were still pushing at 12:28, so check the branches again before merging anything.

## What each chat has pushed
| Chat | Branch | Pushed so far |
|---|---|---|
| 1 Invoices and quotations | `night-1` | Task list, research notes and a gap list only. No product code yet. |
| 2 Money and customers | `night-2` | MSME 45-day warnings and Udyam flag (0120), TDS payable (0121), automatic reminders per customer (0122), customer portal with code sign-in, bulk pay, statement PDF, quote comments and PO upload (0123). |
| 3 Platform | `night-3` | One commit: fixes for the home sign-in link and bell end-to-end tests, a date-proof bell test, landing contrast fixes. No migrations. |
| 4 Site and onboarding | `night-4` | Public site (header, footer, metadata, sitemap, pricing, 15-guide help centre, legal drafts), onboarding wizard, demo business, import guide, tour, empty and error pages, dark mode (0140, 0141). |

No pull requests were opened by any chat yet. No branch used a migration number outside its range and none touched `main`.

## What I checked
- `night-4` merged into my `integrate` branch: typecheck passes, web build passes, 532 core unit tests pass. The full end-to-end run on that merge showed 95 passing and some failing specs (workspace, team-reports, tds-gstr3b). I could not look at the causes: the e2e lock was taken by another chat and the machine ran out of processes. `night-3` has since pushed fixes for some of these, so recheck.
- I did not push `integrate` to `kora-phases`, because the full e2e did not pass. Nothing has been merged on your behalf.
- GitHub CI on `kora-phases` (b463aea) failed on three e2e tests (accessibility, home sign-in link, notifications bell). `night-3` and `night-4` have fixes pushed on their branches.

## Hosted database (Supabase, project sszuxkymzlfvlwsaomsq)
It is at migration 0032. Still to apply, in this order:
0033, 0034, 0035, 0036 (all on `kora-phases`), then 0120, 0121, 0122, 0123 (night-2), then 0140, 0141 (night-4).
Apply them before merging `kora-phases` into `main`, or the live site breaks on the new pages.

## Needs you
- Review and merge the night branches (or ask for it): nothing is merged yet.
- Apply the migrations above, in that order.
- Live site: `/api/health` returned ok on the last check, but I did not change Vercel. If the site is down, set `DATABASE_URL` to the `kora_web` login from the pooler (user `kora_web.sszuxkymzlfvlwsaomsq`, port 6543) and redeploy.
- Do not merge `kora-phases` into `main` until the migrations are applied and CI is green.
