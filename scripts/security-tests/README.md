# Security tests

Attack scripts used for `docs/security-test-2026-10.md`. Each one signs up its own throw-away users and tries to break something: other businesses' data, roles, sign-in, injection, uploads, web-hook addresses, money and races, the CA module.

**Local only.** `lib.mjs` throws if `BASE` is anything but `http://localhost:` or `http://127.0.0.1:`. Never point these at production; some scripts create thousands of records and send hostile input.

```bash
pnpm db:up && pnpm migrate
cd apps/web && KORA_ALLOW_MOCKS=1 DEMO_FIXED_OTP=123456 pnpm build && KORA_ALLOW_MOCKS=1 DEMO_FIXED_OTP=123456 pnpm start -p 3320
cd scripts/security-tests && node t1-unauth.mjs        # BASE=http://localhost:3320 by default
```

The scripts sign in with the fixed demo code, so the server needs `KORA_ALLOW_MOCKS=1` and `DEMO_FIXED_OTP=123456`. Sign-ins from one address are limited (by design); each script gives every user its own `x-forwarded-for`, and if a run still starts failing, clear the limiter on the **local** database: `truncate rate_event`.

Output lines: `ok` = the defence held, `VULN` = exploitable, `weak` = partial or defence in depth, `info` = for the reader. A few lines say `ok` for an attack whose title reads like a success (for example "25 wrong passwords in a row"); the evidence text after `->` is what happened.

| Script | Area |
|---|---|
| `t1-unauth` | every route and method with no session |
| `t2-idor`, `t2b-verify` | cross-business access, headers, cookies, mass assignment |
| `t3-auth`, `t3a-otp`, `t3b-roles`, `t3c` | sign-in, sessions, enumeration, passwords, roles |
| `t4a-inject` | XSS, SQL injection, CSV formulas, headers, exposed files |
| `t4b-upload` | file uploads and the public client link |
| `t4c-ssrf`, `t4c2-ssrf-https` | web-hook addresses, CSRF, host header |
| `t5-fuzz` | 2,660 hostile bodies to every write route |
| `t6-logic`, `t6b-races` | money, invoice states, concurrent payments and refunds |
| `t7-misc` | forged payment web-hooks, API keys, portal, rate limits, CA module |
| `t8-more` | admin routes, huge bodies, imports, privacy |
| `t9-reflect` | reflected XSS and redirects on public pages |
