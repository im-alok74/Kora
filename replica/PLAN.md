# Kora build plan

Status: **draft for your approval.** No application code has been written. Date: 18 Oct 2026.

Inputs: `bible.md` (source of truth), `recon-*.md`, `complaints.md`, `recon-summary.md`. Companion files: `schema.sql`, `tax-cases.md`, `design/tokens.json`, `design/design-note.md`, `brand.md`.

## 1. Decisions I need you to confirm

These come from the corrections listed in `recon-summary.md`, plus what I found while writing the schema. Each says what I will do unless you overrule it.

| # | Decision | Why | Effect on the plan |
|---|---|---|---|
| D1 | **E-invoicing is parity, not a gap.** Kora ships it on the Business tier and competes on flat price and clear rejection handling. | Zoho Invoice has e-invoicing on its Basic, Standard and Professional plans and is itself a GSP (https://www.zoho.com/in/invoice/help/e-invoicing/). Zoho's paid prices were not visible to me. | Pricing stays a hypothesis. Someone must read Zoho's live paid prices before pricing is set. |
| D2 | **UPI and WhatsApp are required parity, not differentiators.** The edge is automatic reconciliation (idempotent webhooks) and delivery status per message. | Zoho's pricing page and MyBillBook both claim WhatsApp and UPI. | Build both in v1 as in the bible. Do not market them as firsts. |
| D3 | **v1 does not file GST returns.** GSTR-1 JSON export and a GSTR-3B summary only. | Filing needs GSP-grade connections and liability Kora does not want in year one. Zoho does offer filing, so CA-led buyers may ask. | Revisit if two or more beta CAs ask for it. |
| D4 | **Do not use SAG's price row in any pricing decision.** | The bible's "Gen GST Rs 5,000 plus Rs 2,000" and "All In One Rs 15,000 plus Rs 7,000" did not match SAG's home page, where Rs 15,000 plus Rs 7,000 is Genius. | Leave the bible row marked unverified. |
| D5 | **MyBillBook pricing is unconfirmed**, so Kora's tier prices remain hypotheses until a cost model exists. | Its pricing page did not render for me. | Phase 3 step 4 ends with a cost model sheet (partner fee, WhatsApp, gateway). |
| D6 | **Review-based gaps are unproven** (list in section 2). We build the features anyway because the bible already scopes them, but we do not market a gap we cannot prove. | One verbatim review, seven summary claims, zero Reddit threads. G2 and Capterra blocked automated access. | Closed beta includes a short interview script to test each unproven gap. Optional: you supply exported reviews and I re-run the ranker. |
| D7 | **Payment fees stay out of plan prices and are passed through.** | A competitor's trade headline says UPI merchant discount rates may be postponed to after Diwali. This is a headline on SAG's site, not an NPCI notice. | Check NPCI directly before the cost model is final. |
| D8 | **Numbering is assigned by a database trigger at issue**, not by app code. | Any code path, including a script or a future service, then gets gapless numbers and cannot skip the lock. Tested with a rolled-back issue. | Schema detail; app only sets `status = 'issued'`. |
| D9 | **A GSTIN or state change after issuing is not allowed; raise a new business.** | Mirrors Zoho's own rule (Zoho tells users to create a new organisation). Prevents history changing under issued documents. | Add "start a new business from this one" copy-over flow in v1.5 (multi-business). |
| D10 | **Reverse charge shows tax but excludes it from the amount due**; **TDS** is a payment method `tds` that settles the part the customer deducts; **credit notes** settle invoices through allocations. | Found while writing `tax-cases.md`. The first schema draft would have rejected reverse-charge invoices. | Already in `schema.sql`. CA to confirm TDS treatment. |
| D11 | **Tax-rate slabs and the HSN-length rule come from CA-approved config, not code from memory.** | I seeded the slab list as a starting point only. | CA sign-off is a gate before beta. |
| D12 | **No ORM.** SQL migrations plus a thin typed query layer. | The logic that matters lives in triggers and row-level security, and each transaction must set `app.business_id`. An ORM hides that and makes it easy to forget. | Deviation from the skill's default; consistent with the bible. |

The bible's stack is otherwise unchanged. I found no reason to disagree with it.

## 2. Gap status after recon

| Gap | Status | Evidence |
|---|---|---|
| Free-plan caps (500 invoices a year, 2 users, 3 projects, branding) | **Proven** | Zoho's own pricing page |
| E-invoice only on paid Zoho tiers | **Proven**, but it is parity on paid tiers (D1) | Zoho e-invoicing help page |
| Template design limits | **Unproven** | G2 summary only |
| Currency not changeable per invoice | **Unproven, contested** | G2 summary versus third-party listings |
| Mobile lag | **Unproven** | G2 summary only |
| Clunky line-item edit, hidden refund path | **Unproven** | one Play Store review |
| Offline or flaky network | **Unproven for Zoho**; a Gen GST complaint exists | G2 summary on Gen GST |
| Slow GST sync | **Unproven** | not found |
| UPI-first collection and WhatsApp reminders | **Not a gap** (D2) | Zoho and MyBillBook pages |
| Regional-language interface | **Hypothesis** | none |

## 3. Stack

| Layer | Choice | Reason |
|---|---|---|
| Language and runtime | TypeScript, Node 22 LTS | one language across web, worker and tax library |
| Web app | Next.js (App Router) | dashboard, marketing and public pay page in one deployable; server rendering for cheap phones |
| Database | PostgreSQL 16 | triggers, constraints and row-level security carry the compliance rules |
| DB access | `postgres` (porsager) driver plus SQL migrations | see D12 |
| Money and tax | `packages/tax`, pure functions on `bigint` paise | exact, deterministic; JS `number` is unsafe past 9e15 and intermediate products reach 4e15 |
| Jobs | pg-boss, enqueued inside the issuing transaction | an issued invoice always has its e-invoice, reminder and send jobs |
| PDF | HTML templates rendered by headless Chromium (Playwright's) | one layout engine for editor and print |
| Files | S3-compatible storage with signed URLs; local disk adapter in dev | |
| Auth | phone or email OTP, then passkeys; provider adapter; mock sender in dev | |
| Payments | `PaymentGateway` adapter; Razorpay first; mock in dev | |
| WhatsApp / SMS / email | `Messenger` adapters; mock in dev; SMS needs DLT registration | |
| GST connector | `GspClient` adapter; mock server that follows the IRP schema | no live calls ever in this build |
| Offline | service worker, IndexedDB drafts, background sync | installable web app |
| UI | Tailwind from `design/tokens.json`, Radix primitives, Lucide icons | accessible base, open licences |
| Tests | Vitest, fast-check, Playwright, real Postgres in Docker | see section 6 |
| Package manager | pnpm workspaces | |

## 4. Repo layout

```
apps/web/            Next.js app: dashboard, public invoice page, API routes
apps/worker/         pg-boss workers: e-invoice, reminders, sends, webhooks, recurring
packages/tax/        pure tax and money library (+ tests from tax-cases.md)
packages/db/         migrations (from schema.sql), query layer, withTenant()
packages/adapters/   interfaces + mock implementations: otp, messenger, payments, gsp, storage
packages/pdf/        template renderer
packages/ui/         tokens, primitives
e2e/                 Playwright specs
replica/             recon, plan, schema (kept as the record)
docs/                compliance.md, deploy.md (written at the end)
```

`withTenant(businessId, userId, fn)` is the only way the app reaches the database. It opens a transaction and sets the two session variables the row-level security policies read. A query without it returns nothing.

## 5. Modules in build order

Each step ends with a gate. No step starts until the previous gate is green.

| # | Module | Content | Gate |
|---|---|---|---|
| 1 | Foundations | repo, CI, Postgres in Docker, migrations from `schema.sql`, `withTenant`, OTP auth with mock sender, tenancy, member roles | schema smoke test passes in CI; cross-tenant read test fails closed |
| 2 | Tax library | everything in `tax-cases.md`, property tests P1 to P6 | all cases pass; CA reviews the open points |
| 3 | Core invoicing | parties with GSTIN validation, items, 7 document types, numbering series, issue flow, template editor with locked fields, PDF, share link, email and WhatsApp (mock) | a new user issues and sends in under 60 seconds in a timed Playwright run; concurrent-issue test is gapless |
| 4 | Collections | UPI QR, payment link, webhook handler, allocation, reminders, ageing report, cost model sheet | duplicate webhook creates one payment; test payments reconcile with no manual step |
| 5 | Compliance | e-invoice adapter against a mock IRP-shaped API, rejection handling, retry with backoff, GSTR-1 JSON export, GST summary | rejected e-invoice shows plain words and resubmits; no rejections caused by our totals across a generated batch |
| 6 | Offline | installable app, IndexedDB drafts, sync on reconnect | offline-then-sync spec passes; conflict case defined |
| 7 | Reports and team | sales and ageing reports, owner / staff / accountant permissions | accountant cannot write; exports work |

After each module: `/replica-test`, fix severity 1 and 2 bugs, update `features.csv`, run `/replica-diff`. Before v1: `/replica-brand` sweep, README, `docs/compliance.md`, `docs/deploy.md`, final report.

## 6. Test strategy

- **Unit and property tests** on `packages/tax`: every case in `tax-cases.md`, plus P1 to P6 on 10,000 generated invoices.
- **Database tests** against real Postgres, run in CI with a container: schema smoke (already written, `schema-smoke.sql`), plus new tests for concurrency. The concurrent-issue test opens N parallel connections issuing from the same series and asserts the numbers are exactly 1..N with none missing and none repeated. A rollback test asserts no gap.
- **Contract tests** for each adapter interface, run against its mock, so a real provider can be dropped in and checked against the same suite.
- **Playwright** end-to-end for the main flows and edge cases named in your brief: gapless numbering under concurrent issue, double submit, duplicate webhook, rejected e-invoice, offline then sync. Plus the 60-second timed run.
- **Accessibility**: axe checks in Playwright on core screens; `contrast.py` on tokens.
- **Compliance review**: a practising CA reviews the tax cases, the rate seed, document wording and the e-invoice payload before beta. This is a human gate.
- **Security**: row-level security negative tests; webhook signature verification tests; no secrets in the repo (`.env.example` only); secret scan in CI.
- Severity 1 and 2 bugs block the module gate.

## 7. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Wrong tax output | A wrong invoice is a legal problem for the customer | one library, cases from `tax-cases.md`, property tests, CA review, in-app wording that the owner stays responsible |
| Partner dependency | The GSP sets e-invoice cost and uptime | adapter interface, retries with backoff, evaluate a second partner before launch |
| Metered cost surprises | partner fee, WhatsApp, gateway scale with use | pass-through pricing, visible counters, cost model before pricing is final |
| Competitor response | Zoho already has e-invoicing and WhatsApp | compete on handling, reconciliation, price clarity, support; avoid claims we cannot prove (D6) |
| Thin review evidence | We may be solving problems nobody has | beta interviews; ask you for exported reviews if you want stronger evidence |
| Idempotency and race conditions | double submit, duplicate webhooks, concurrent issue | handled in the database, each with a named test |
| Offline conflicts | edits on two devices | drafts only are offline; issuing requires a connection; last-write-wins on drafts with a visible warning |
| Data protection | customer GSTINs and addresses are held for others | lawyer review of Indian data-protection rules before launch; data region India; deletion rules respect statutory retention |
| Retention vs deletion | Zoho deletes data after 180 days inactive; Kora cannot delete issued documents early | never auto-delete issued documents; document retention in `docs/compliance.md` |
| Brand and trademark | "Kora" is a common word | search and domain checks listed in `brand.md` need a person |
| Review-site access | G2 and Capterra block automated reads | do not bypass; use exports you supply |

## 8. Things that need real credentials or approvals (not needed to build)

GST partner (GSP) account and sandbox, payment gateway account, WhatsApp provider and template approval, DLT registration for SMS, email provider, object storage, hosting, domain and trademark checks. Nothing in Phase 3 calls a live service.

## 9. Open questions

1. Which buyer comes first: freelancers, shop owners, or businesses led by their CA? This changes onboarding and which unproven gaps matter. MyBillBook owns shops, SAG owns CAs, Zoho owns freelancers.
2. How many builders and over what period? The weeks in the bible assume one to three; I will build sequentially in this session, so calendar time is not a meaningful estimate here.
3. Which GSP partner and its per-invoice fee.
4. Do you want me to ask a CA to review `tax-cases.md` and the rate seed before step 2 starts, or after?

## 10. What I verified

- `schema.sql` loads on PostgreSQL 16 and `schema-smoke.sql` passes: GSTIN checksum, gapless numbering including a rolled-back issue, immutability of issued documents and lines, totals mismatch rejection, duplicate webhook rejection, over-allocation rejection, append-only audit log, cross-tenant isolation with the tenant unset, identity freeze, reverse-charge totals.
- Not yet tested: concurrent issuing from parallel connections (planned in step 3), performance, and anything about the application.
- `contrast.py`: 21 pairs, 0 failures.
- Tax-case figures were worked by hand and spot-checked; they are not yet executed.

Waiting for your approval of this plan before any application code.
