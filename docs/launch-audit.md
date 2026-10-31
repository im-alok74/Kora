# Launch audit (30 October 2026)

One page for the owner: what is done, what only the owner can do, what was never tested, and how to re-check. The detail lives in `docs/security-test-2026-10.md` (attacks and fixes), `docs/launch-checklist.md` (accounts and settings) and `docs/ca-phase1-plan.md` (the accounting-firm product).

## 1. Done and checked

| Area | State | How it was checked |
|---|---|---|
| Security fixes F1 (code), F2, F3, F5–F8, F10, F12, F13 | Fixed | `docs/security-test-2026-10.md` section 8; the attack scripts now run as one suite (`scripts/security-tests/run-all.mjs`) |
| F9 invite consent | Fixed for accounting firms; business team invites still add at once | migration 0212 |
| F4 script policy | Report-only | enforce after a week with no `csp_violation` log lines |
| Accounting-firm product | Firms, clients, assignments, monthly work, requests and upload links, review, filing evidence, close gate, fees, pilot measures, linked client books, scheduled work | unit tests, browser tests on a production build, mobile layout at 375 px |
| Tests | db 33, core ~853, web 201, browser tests per feature | `pnpm test`, `pnpm e2e` |
| Automatic attack run | `.github/workflows/security.yml` on every pull request, weekly, and by hand | the suite passes locally: 15 scripts, no unexpected finding |

## 2. Only the owner can do these

1. **Vercel, Production:** unset `DEMO_FIXED_OTP`, `KORA_ALLOW_MOCKS` and `KORA_WEBHOOK_ALLOW_PRIVATE`. The code already ignores them on a live deployment, but `/api/health` answers 503 until they are gone. Check: `https://<site>/api/health` says `{"status":"ok"}`.
2. **Payments:** create the Razorpay plans and the webhook, then a Rs 1 real payment as the last test. `KORA_PLANS=enforce` and `KORA_ADMIN_EMAILS` once that works.
3. **Script policy:** after a week with no `csp_violation` lines, change the header from report-only to enforcing.
4. **DPDP items and the GST invoice decision:** `docs/dpdp.md`, `docs/gst-decisions.md`.
5. **Merge** the pull request that carries scheduled work, the link screens and the security workflow; the migration in it (0214) is applied to production only after a dry run and a yes.

## 3. Closed in the second hardening round

| Gap | Now |
|---|---|
| Uploads had a heuristic check only | Set `CLAMAV_HOST` (and `CLAMAV_PORT`) and every upload is streamed to a ClamAV daemon as well; `CLAMAV_REQUIRED=1` pauses uploads while it is unreachable. Tested against a stand-in daemon. The daemon itself is a service to run (see `.env.example`). |
| Business team invites added a person at once | Migration `0215`: an owner now sends an invitation, the person accepts or declines (setup page or dashboard), invitations lapse after 14 days, waiting ones count toward the plan's member limit, and a waiting invite opens nothing (attack test `T3b-pending`). |
| Rate limits were per server instance | With `UPSTASH_REDIS_REST_URL` and `_TOKEN` set, the per-person limits are also counted in the shared store, so the cap is global; without them nothing changes. |
| Plan limits not exercised over HTTP | `scripts/security-tests/plans-e2e.mjs` against a copy with `KORA_PLANS=enforce`: 10 invoices a month, one person, no recurring, reminders or messaging, credit notes still allowed, other businesses unaffected. Passes; runs in the workflow. |
| S3 storage not exercised | `packages/core/test/blobs-s3.test.ts` against a real S3 server that checks signatures (put, byte-exact read, delete, wrong credentials refused). Passes; runs in the workflow. |
| PDF under load | 90 PDFs from 6 businesses at once: all 90 good, but 27 s on a laptop (about 3 a second). PDFs are now drawn at most `PDF_CONCURRENCY` (default 4) at a time per process so a burst cannot exhaust memory. Runs in the workflow. |

## 3b. Still not done

- **Real SMS or e-mail codes and real-money Razorpay:** need your provider accounts; the last test before launch is a Rs 1 payment.
- **ClamAV itself:** the code is ready; someone has to run the daemon and set `CLAMAV_HOST`.
- **The suite attacks a copy with the staging switches on.** It cannot prove what the live site's settings are; only the Vercel check in section 2 does.

## 4. How to re-check

```bash
# local copy, same as the workflow does
pnpm db:up && pnpm migrate
cd apps/web && KORA_ALLOW_MOCKS=1 DEMO_FIXED_OTP=123456 pnpm build && KORA_ALLOW_MOCKS=1 DEMO_FIXED_OTP=123456 pnpm exec next start -p 3320
BASE=http://localhost:3320 PT_DATABASE_URL=postgres://kora_owner:kora_owner_dev@localhost:54329/kora node scripts/security-tests/run-all.mjs
```

The runner exits 1 on any `VULN` that is not on its short expected list (the health check says down while a staging switch is on; the fake payment page is open in the staging copy; the violation-report endpoint is public on purpose). `t2-idor` is shown but does not gate, because it also reports harmless no-op answers; `t2b-verify` proves nothing changed and does gate.
