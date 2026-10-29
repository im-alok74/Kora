# Kora: attack test and fix plan (29 October 2026)

An attempt to break Kora the way a user, a customer, a rival firm or an attacker would. Every test below was run for real against a local copy of the production build (commit `27c9581`, main after PRs 50 to 62, database migrated to 0210). The attack scripts are in `scripts/security-tests/` and can be run again (see section 7).

**Nothing was attacked on the live site.** The harness refuses any address except localhost. The live deployment could only be reasoned about from the code and from its public `/api/health` answer.

## 1. Result in one page

| | Count |
|---|---|
| Attack checks run | about 4,500 requests across 18 scripts (232 API routes, 334 route and method pairs) |
| Held (the attack failed) | the large majority: see section 3 |
| Real weaknesses found | 13 (1 critical for operations, 2 high, 4 medium, 6 low) |
| Not testable here | 9 areas (section 6) |

The core is sound. Nobody could read or change another business's data, forge a payment, edit an issued invoice, overpay an invoice, refund one payment twice, or issue duplicate invoice numbers, even with many requests at the same instant. What is weak is mostly around the edges: how the live site is configured, one gap in the web-hook address check, missing request limits, and some defence-in-depth that is not there yet.

### The weaknesses, worst first

| # | Severity | Weakness | Phase |
|---|---|---|---|
| F1 | **Critical (operations)** | The live health check says a "mock" switch is on in Production. If the demo OTP code or the mock payment gateway is on there, anyone can sign in as any person and mark any payment link as paid. | 1 |
| F2 | **High** | The web-hook address check can be bypassed with an IPv4-mapped IPv6 address (`https://[::ffff:127.0.0.1]/`). The server then connects to its own internal network. | 1 |
| F3 | High | Request bodies have no size limit in the app. A 30 MB or 120 MB body is read into memory. Vercel's own 4.5 MB limit hides this in production but nothing else does. | 1 |
| F4 | Medium | The signed-in app and the CA pages have a content-security policy with no `script-src`, so a single missed escape would run attacker script. | 2 |
| F5 | Medium | No request limit on signed-in endpoints unless Upstash is configured (150 requests in one burst: none limited). | 2 |
| F6 | Medium | The public client upload link has no cap on how many files or how many bytes one link can store. | 2 |
| F7 | Medium | Passwords such as `password`, `12345678` and `aaaaaaaaaaaa` are accepted. Only the length is checked. | 2 |
| F8 | Low | Many routes answer 500 instead of 400 for bad input: broken JSON (25 routes), a NUL character in text, a negative `limit`, wrong types in the new CA routes. No stack trace is ever shown. | 1 |
| F9 | Low | Adding a team member (business or firm) creates an account for any email or phone without that person agreeing. | 3 |
| F10 | Low | An invalid `x-firm-id` header or `kora_firm` cookie silently falls back to the person's first firm. | 3 |
| F11 | Low | Sign-up says "an account with this number or email already exists", which tells a stranger who has an account. | 3 |
| F12 | Low | No limit on guessing API keys (`/api/v1`) or customer-portal tokens. Both are long random values, so this is very hard in practice. | 3 |
| F13 | Low | The public health check names the reason ("config") when it is down, which tells an attacker mocks are on. | 3 |

## 2. How the testing was done

Environment: production build of main (`next start`), local Postgres with all 77 migrations, mock OTP with a fixed code so that sign-in could be scripted, mock payment gateway. Every script creates its own throw-away users and businesses.

| Script | What it attacks |
|---|---|
| `t1-unauth` | Every route and method with no session |
| `t2-idor`, `t2b-verify` | Business B against business A's ids on every `[id]` route; header and cookie tricks; mass assignment; proof that "ok" answers changed nothing |
| `t3-auth`, `t3a-otp`, `t3b-roles`, `t3c` | OTP spam and guessing, enumeration, password rules, brute force, sessions, cookie flags, fixation, case tricks, staff and accountant privilege escalation |
| `t4a-inject` | Stored XSS, SQL injection, CSV formula injection, CORS, clickjacking, exposed files, security headers |
| `t4b-upload` | Disguised files, SVG and HTML, polyglots, traversal and CRLF in names, oversize, quotas, public upload link |
| `t4c-ssrf`, `t4c2-ssrf-https` | Web-hook addresses (30 forms), CSRF, host-header poisoning |
| `t5-fuzz` | 2,660 hostile bodies to every write route |
| `t6-logic`, `t6b-races` | Money, invoice states, numbering, concurrent payments and refunds |
| `t7-misc` | Forged payment web-hooks, mock payment page, API keys, customer portal, rate limits, the CA module across two firms |
| `t8-more` | Admin routes, secrets in responses, huge bodies, slow patterns, imports, privacy requests |
| `t9-reflect` | 672 reflected-XSS and redirect probes on 56 public pages |

## 3. What held

These attacks were tried and failed. They are listed so nobody has to guess what is already safe.

**Access**
- All 334 route and method pairs refuse a request with no session (the public ones answer only what they are meant to).
- Business B, with its own valid session, could not read, change or delete anything of business A on 146 cross-tenant calls. Every "ok" answer was a no-op, proven by A checking its data afterwards.
- Naming A's business in the `x-business-id` header, the `kora_business` cookie, `x-kora-business` or `x-kora-user` was refused. Putting `business_id` in a request body had no effect.
- Firm B could not see or change firm A's clients, engagements, files, requests or team, and could not use A's firm id in a header or cookie.
- Staff and accountants could not invite owners, promote themselves, remove the owner, create API keys, rename the business, export all data, read the audit log, cancel invoices, or commit imports. An ordinary user gets 404 or 401 on the admin routes.

**Sign-in**
- Sending 15 codes to one address was limited. Wrong codes kill the code after a few tries (the right code failed after 12 wrong ones). 25 wrong passwords were limited and the account stayed locked.
- A real and an unknown account give the same sign-in error. A session cookie stops working after sign-out. Login replaces a session value chosen by the attacker (no fixation). The cookie is `HttpOnly; SameSite=Lax; Secure`. The same address in another case, or with spaces, is the same account.

**Injection and content**
- A script payload typed into customer name, notes, item name, terms and business name came out escaped on the public invoice page, the invoice HTML and the preview. 672 reflected-XSS probes found nothing.
- SQL metacharacters in search and filter fields caused no data change and no table damage.
- A customer name `=HYPERLINK(...)` is exported as `'=HYPERLINK(...)`; imported formulas also come back out neutralised.
- Uploads: HTML or script disguised as PNG or PDF, SVG, `text/html`, a 3 MB file, an empty file, bad base64 and a 10,000-character name were all refused. Path traversal in a name became `.._.._etc_passwd.pdf`, and a polyglot that starts like a PNG is served as `image/png` with `nosniff`, so it cannot run.
- CSRF: a form post, a `text/plain` post and a multipart post to a write route all get 415. A delete without the cookie does nothing.
- No CORS grant to another origin. Pages cannot be framed by other sites. No `X-Powered-By`. `.env`, `.git`, source maps, `package.json` and path traversal all 404.
- Web-hook addresses: 22 of 23 private, loopback, link-local, metadata and odd-notation forms were refused (all `http://`, decimal and hex IPs, `127.1`, user-info tricks, `file:`, `gopher:`, `ftp:`). One form got through: see F2.

**Money and state**
- Negative, zero, huge, exponent, hex, `NaN`, `Infinity` and 12-decimal amounts, tax rates outside the slab list, discounts over 100% and 10,000 lines were all refused. Totals the client sends are ignored.
- An issued invoice cannot be issued again, edited, deleted or, after cancelling, paid. Negative, zero, over-due and 10^30 payments were refused.
- 12 invoices issued at the same instant got unique, gap-free numbers. 8 simultaneous payments of the full amount: exactly one accepted. 6 simultaneous refunds of one advance: exactly one. One advance applied to two invoices at once: only one succeeded.
- Forged payment web-hooks (no, empty or wrong signature) were refused. A 200 KB body is refused before parsing.
- API keys: a read key cannot write, a tampered key is refused, a revoked key stops at once, and one business's key cannot read another's invoice. A customer-portal link cannot open another business's invoice.

**Robustness**
- 2,660 hostile bodies (nulls, arrays, huge numbers, NUL bytes, 3,000-deep JSON, 200 KB strings) never hung the server and never showed a stack trace, a table name or a SQL error.

## 4. The weaknesses in detail

### F1. Mock switches in the live deployment (critical for operations)

**What was seen.** The live `/api/health` answers `503 {"status":"down","reason":"config"}`. By the code (`mockFlagsInProduction`) that means at least one of `KORA_ALLOW_MOCKS`, `DEMO_FIXED_OTP` or `KORA_WEBHOOK_ALLOW_PRIVATE` is set in Production.

**What each one allows, demonstrated locally:**
- `KORA_ALLOW_MOCKS=1` with `DEMO_FIXED_OTP` set: the one-time code for **every** phone number and email is that fixed value. Anyone who knows it can sign in as any user, including an owner or an admin. This is full account takeover. Every sign-in in this test used it.
- `KORA_ALLOW_MOCKS=1`: the mock payment page and its pay button are open to anyone with a payment-link id (`POST /api/mock-gateway/<id>/pay` answered 200 with no sign-in). A customer could mark their own invoice paid.
- `KORA_WEBHOOK_ALLOW_PRIVATE=1`: web-hooks may point at private addresses (internal network).

**Fix (owner, now):** in Vercel, Project, Settings, Environment Variables, remove `DEMO_FIXED_OTP`, `KORA_ALLOW_MOCKS` and `KORA_WEBHOOK_ALLOW_PRIVATE` from **Production** only, redeploy, and check that `/api/health` answers `{"status":"ok"}`. If real payments or messages are not set up yet, the app will refuse to start without the mock switch; set `GATEWAY=razorpay` and the messenger first, or accept that those features are off.

**Fix (code, Phase 1):** make the two dangerous behaviours impossible on a production deployment even if someone sets the switch again: ignore `DEMO_FIXED_OTP`, close the mock payment page and pay route, and ignore `KORA_WEBHOOK_ALLOW_PRIVATE` whenever `VERCEL_ENV=production`. The other mock adapters keep booting, so nothing that works today is switched off.

### F2. Web-hook SSRF bypass with an IPv4-mapped IPv6 address (high)

**Attack.** Save a web-hook to `https://[::ffff:127.0.0.1]/` (or `[::ffff:a9fe:a9fe]`, the cloud metadata address). Node turns the host into `::ffff:7f00:1`. `isPrivateAddress` only recognises the dotted form `::ffff:127.0.0.1`, so the saved-address check and the connect-time check both let it through. The test button then really connected: `connect ECONNREFUSED ::ffff:7f00:1:443`.

**Impact.** Kora's server can be made to open connections to its own loopback and internal addresses (port probing; blind requests). The https-only rule limits what can be read back, but the protection the code claims to give does not hold.

**Fix.** Parse IPv6 properly. Treat these as private: `::ffff:0:0/96` (IPv4-mapped, any notation) by testing the embedded IPv4, `::/96` (compatible), `64:ff9b::/96`, `2002::/16` (6to4 with a private IPv4 inside), `2001::/32` (Teredo), `fc00::/7`, `fe80::/10`, loopback and unspecified. Add unit tests for every notation.

### F3. No request body limit (high on any host except Vercel)

`POST /api/parties` with 30 MB and 120 MB bodies was read into memory and answered 500 after 273 ms and 881 ms. Vercel stops bodies above 4.5 MB before they reach the app, so production is covered today; a different host, a future move, or the e2e/dev server is not.

**Fix.** One check in the shared body reader: refuse above 6 MB (the largest legitimate body is a 2 MB file sent as base64, about 2.8 MB) with 413 before reading, using `content-length` and a streaming cap when it is missing.

### F4. No `script-src` (medium)

The app's policy is `frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'`. Escaping held in every test, so this is defence in depth, not an open hole. **Fix:** a nonce-based `script-src`, first in report-only mode and then enforced. Next.js needs nonces for its inline scripts, so this needs a staged rollout.

### F5. No limit on signed-in endpoints (medium)

150 dashboard requests in one burst: none limited. The middleware limiter only works with Upstash; without it only sign-in and the public routes are limited. **Fix:** a per-user limit through the existing Postgres limiter on `tenantRoute`, `userRoute` and `firmRoute`, generous (for example 600 a minute) so normal use never feels it, with a lower limit for expensive routes (reports, exports, imports).

### F6. Public upload link has no storage cap (medium)

One link accepted 28 files in a burst of 40 until the per-minute limit (30) stopped it, and nothing limits the total. At 2 MB each that is about 60 MB a minute from one address, held in the database or object storage, with no cap per item, per link or per firm. **Fix:** at most 10 versions per item, at most 40 files and 50 MB per engagement through the link, and a per-firm total (counted from `document_version`) that the partner can see.

### F7. Weak passwords accepted (medium)

`12345678`, `password`, `Passw0rd` and `aaaaaaaaaaaa` all created an account. **Fix:** refuse the 10,000 most common passwords, passwords equal to the email or phone, and passwords with fewer than 4 distinct characters. Keep the length rule. Sign-in by one-time code remains available for people who do not want a password.

### F8. 500 where 400 belongs (low)

53 server errors on 25 routes: invalid JSON (`PUT /api/business`, `POST /api/parties`, `POST /api/documents`, and others), NUL characters (`\u0000` in a search, in a reason, in a firm name), `limit=-1`, and non-text values in the CA routes `PATCH /api/ca/requests/[id]` and `/submissions/[id]`. Only the friendly generic message was shown, never an internal detail, so this is a robustness problem. **Fix:** central handling in `errorResponse` (JSON syntax errors and Postgres invalid-text errors become 400) and type checks in my own CA routes.

### F9 to F13 (low)

- **F9** Invite creates the account at once. **Fix:** keep it, but mark the membership "invited" until the person signs in once, and let them decline.
- **F10** Invalid firm header silently becomes the first firm. **Fix:** a header or cookie that is present but not the person's firm answers 403.
- **F11** Sign-up names existing accounts. **Fix:** answer the same for new and existing addresses and send the code, as the one-time-code flow already does; keep the clear message for the password sign-in form only after a code is verified.
- **F12** No limit on `/api/v1` and portal token guesses. **Fix:** `publicLimit` on both.
- **F13** Public health names the reason. **Fix:** public answer `{"status":"down"}`; keep the reason in the log (it already is) and behind the cron secret.

## 5. Phases

| Phase | Goal | Items | Verification |
|---|---|---|---|
| **0 (owner, today, no code)** | Close the live exposure | F1 environment: unset the three switches in Production, redeploy, `/api/health` must say `ok` | health check; a second look at who signed in recently |
| **1 (this PR)** | Close the exploitable gaps | F1 code, F2, F3, F8 | new unit tests (every IPv6 notation, flags in a production deployment, body limit); re-run `t4c2`, `t5`, `t8`; full suites |
| **2** | Defence in depth and abuse limits | F4 (report-only first), F5, F6, F7 | re-run `t3`, `t4b`, `t7`; watch CSP reports for a week before enforcing |
| **3** | Hygiene | F9 to F13 | re-run `t3`, `t7`, `t9` |
| **4 (process)** | Keep it safe | run `scripts/security-tests` in CI against the built app; scheduled dependency audit; pen test by a person on the live site before wide launch | CI job green; report |

## 6. Not tested, and why

- Real one-time-code delivery and brute force against a real SMS or email provider (only the mock was available).
- Real Razorpay web-hook signatures and plan purchase (not configured; the code path for a bad signature was tested through the mock).
- Plan limits (`KORA_PLANS` is off locally, so limit bypass could not be tried). A starter business can create unlimited invoices until the flag is set to `enforce`.
- Object storage (S3-compatible) access control and signed URLs.
- PDF generation with hostile content (fonts, images, very long lines) for crashes or slowness.
- The GST portal / GSP integration and e-invoicing calls.
- Email and WhatsApp content injection (nothing is sent by the mock).
- The live site itself: headers behind Vercel, the real Upstash limiter, the real Postgres pooler. Run `scripts/security-tests` with `BASE` set to a **staging** copy (not production) to cover these.
- The heavy-report test sent invalid dates and got 400; a proper heavy-report timing test remains.

## 7. Running the tests again

```bash
# a local, production-built copy with its own database (never production)
pnpm db:up && pnpm migrate
cd apps/web && KORA_ALLOW_MOCKS=1 DEMO_FIXED_OTP=123456 pnpm build && pnpm start -p 3320
# in another terminal
cd scripts/security-tests && node t1-unauth.mjs && node t2-idor.mjs   # and the rest
```

Clear the local limiter table between scripts if sign-ins start failing (`truncate rate_event` on the local database). The harness throws if `BASE` is anything but localhost.

## 8. Status

| Item | Status | Evidence |
|---|---|---|
| F1 owner action (unset the three switches in Production) | **Open: needs the owner** | live `/api/health` must answer `{"status":"ok"}` |
| F1 code: demo code, fake payment page and private web-hooks off on a live deployment | **Fixed (Phase 1)** | a second copy of the build run with `VERCEL_ENV=production` and the mock switches set rejected the demo code (400) and answered 404 on the mock payment routes; unit tests for `isLiveDeployment` and for the web-hook switch |
| F2 IPv4-mapped IPv6 bypass | **Fixed (Phase 1)** | `https://[::ffff:127.0.0.1]/` is now refused when saved; unit tests cover 12 more notations (hex, expanded, 6to4, Teredo, NAT64, zone ids) and three public ones that must stay allowed |
| F3 request body limit | **Fixed (Phase 1)** | 30 MB and 120 MB bodies now get 413 in under a second (middleware, 8 MB cap, web-hook route excluded) |
| F8 500 instead of 400 | **Fixed (Phase 1)** | the hostile-body run went from 53 server errors on 25 routes to 0 on 0 (JSON syntax errors, Postgres data exceptions, negative limit, non-text values in CA and statement routes, firm name length) |
| F4 to F7 | Open: Phase 2 | |
| F9 to F13 | Open: Phase 3 | |

### What Phase 1 changed in the code

- `packages/core/src/webhooks.ts`: `isPrivateAddress` reads the IPv6 bytes (`ipv6Bytes`) and checks the IPv4 inside mapped, compatible and 6to4 addresses; anything it cannot parse counts as unsafe. `allowPrivate` is off on a live deployment.
- `packages/db/src/health.ts`: `isLiveDeployment()` (true only when `VERCEL_ENV=production`).
- `apps/web/lib/server.ts`, `lib/portal.ts`, `app/mock-gateway/[id]/route.ts`, `app/api/mock-gateway/[id]/pay/route.ts`: the demo code and the fake gateway are ignored on a live deployment.
- `apps/web/middleware.ts` and `lib/badInput.ts`: body cap; `errorResponse` maps JSON syntax errors and Postgres class-22 errors to 400; `readJson` treats a non-object body as empty.
- `packages/core/src/documents.ts`: `limit` and `offset` are clamped.
- CA routes and `firmreview` / `firmsubmission`: reasons and notes must be text.
