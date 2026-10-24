# Kora system-design execution phases

24 October 2026. Baseline: d8aa1d2, pulled from origin/main before editing. This plan divides work into reviewable changes that can finish with tests and a rollback note. It does not assume a fixed token or account-usage allowance.

## Status and operating rule

Phase 1 is complete in this PR: current-state review, corrected architecture and the implementation plan below. Phases 2 through 6 are pending, not implemented by this documentation change. Existing code and tests are evidence of implementation, not of live provider configuration or production capacity.

At the start of each phase: fetch main, inspect status, preserve unrelated work, check whether another PR already solved the problem, and choose one bounded deliverable. Reserve time for failure-mode tests, diff review and the PR. If a phase is too large, split at the listed boundary; never ship half a financial transaction or mark tests passed without running them. Record completed scope, remaining scope, test results, migration ordering and rollback limitations in every PR.

## Phase 1: current-state design and handoff

Delivered: updated [system-design.md](system-design.md), [review](system-design-review.md), and this phase plan. New tick/watch workflows, schema health, retention and lazy GST setup are acknowledged. Queue races and manual-payment replay remain explicit gaps.

Validation: compare claims with source, check local Markdown links, confirm referenced files exist and run `git diff --check`. No application build is needed for Markdown-only changes. No runtime or deployment changes are included.

## Phase 2: queue correctness

### PR 2A: fenced job ownership

Touch: `packages/core/src/jobs.ts`, a new migration numbered after the highest current migration, and focused core queue tests. Do not modify previously applied migrations.

Proposed contract: every claim creates a fresh lease token. Completion, retry and permanent failure use `WHERE id = ... AND lease_token = ... AND status = 'running'`. A zero-row update means ownership was lost and must not count as completed. Expired claims respect attempt exhaustion. A worker ID alone is not a fencing token.

Acceptance: worker A claims, expires, worker B reclaims, then A returns; A cannot mark B's work done or failed. Test success and error paths, duplicate claims, final-attempt expiry, and transaction rollback. Fencing protects queue state; it does not undo an already accepted external message.

Rollout: apply additive schema, quiesce old workers and cron consumers, deploy token-aware consumers, then resume. Do not run old unfenced and new consumers concurrently and claim the race is fixed. On rollback, pause consumption first; retaining the column is safe, restoring old behavior restores the known race.

### PR 2B: bounded processing

Depends on 2A. Claim one serial slot or a bounded number of actual execution slots, rather than reserving a large serial batch. Pass deadlines through tick orchestration; stop claiming before the budget expires and bound provider calls. Timeouts can leave ambiguous provider outcomes, so reconcile before retry where supported.

Acceptance: a slow handler does not leave unrelated jobs claimed but idle; no new claim starts after the deadline; abort/timeout leaves recoverable state; lease duration exceeds the tested operation timeout and shutdown grace. Fake-clock tests should cover the deadline without long sleeps.

Split rule: deliver 2A first. Do not add a new queue vendor or scheduler in either PR.

## Phase 3: payment replay safety

### PR 3A: server operation contract

Touch: payment core service, route validation, additive operation table/constraint and integration tests. Key scope: `(business_id, operation_type, operation_key)`. Store a canonical request hash and original response atomically with payment/allocation. Never store raw secrets in replay records.

Concurrent requests with the same key and payload return one financial result; changed payload conflicts. Permission and tenant membership are rechecked on retries. Specify retention before pruning operation records; an expired key must not silently become safe to reuse while a retry can still occur. Existing clients need a documented compatibility transition.

Acceptance: concurrent partial payments with the same key, lost HTTP response and retry, changed request, cross-tenant key reuse, transaction failure and revoked membership. Verify one payment and allocation, not merely one response.

### PR 3B: client adoption and reconciliation

Depends on 3A. Generate one key per user operation, retain it across uncertain retries, clear it only after a known outcome, and use a new key for an intentional second payment. Cover every manual-payment entry point before enforcing mandatory keys. Do not mistake disabling a button for idempotency.

Add a reconciliation test for a gateway replay after processed-event retention cleanup, using durable provider payment identity. No live gateway calls in tests. Roll back mandatory validation before rolling back clients; preserve financial and operation records.

## Phase 4: operational readiness evidence

This phase requires actual environment access. Repository configuration alone cannot complete it.

### PR 4A: monitor coverage and runbook

Extend watch checks to expired running leases and explicitly unknown schema status, with deliberate policy for each. Separate skipped configuration from healthy monitoring in operator reports. Test the evaluator using fixtures: healthy, missing secrets/config, stale queued, expired running, failed, malformed response and unhealthy database. Do not include queue payloads or bearer tokens in logs.

### Operational change 4B: execution and recovery

Verify tick/watch activation, delivery latency and operator notification receipt. Choose continuous worker deployment if five-minute scheduled execution cannot meet the target. Verify backup freshness, isolated restore, blob references and ledger totals. Record measured recovery time and available recovery point; no 15-minute RPO claim from daily backups alone.

Provider configuration, paid resources and production migrations are separate operational actions. Until completed, mark their status unverified. Rollback uses the prior worker configuration and preserves queued work; do not replay all failed jobs automatically.

## Phase 5: tenant and offline lifecycle

Touch only cache/sync/auth boundaries and focused tests. Test two businesses, logout/login as another user on one device, membership removal, two tabs, lost response, stale base revision and browsers without Web Locks. Inventory what service worker and IndexedDB store before changing purge behavior.

Acceptance: no cross-user or cross-business visibility; a draft is never silently lost or issued offline; retries do not duplicate server drafts; conflicts require an explicit resolution. Scope local records and synchronization locks appropriately. Warn or preserve recoverable unsynced work before destructive cleanup. Do not add offline payments or invoice numbering.

Split rule: first reproduce and document lifecycle gaps, then fix a single cache or sync boundary with regression coverage. Rollback must keep older local draft formats readable.

## Phase 6: performance and release capacity

Start with a reproducible workload: business count, concurrent users, invoice lines, file sizes, PDF pages, report period, cold/warm requests and provider latency. Record p50/p95/p99, errors, queue age, pool wait and memory. The design's figures remain planning assumptions until measured.

Separate PRs: query/pagination tuning; PDF/export job offload; native packaging assurance. Change indexes only with query-plan evidence. Async exports must authorize creation, polling and download; bound object lifetime and clean up safely. Desktop/mobile releases need signed-package/update verification independent of the PWA.

Completion: before/after results, correctness checks and rollback procedure for each optimization. Do not introduce microservices just to complete this phase.

## Dependency and completion matrix

| Phase | Depends on | Done when | Current status |
|---|---|---|---|
| 1 | Latest-main pull | Evidence refreshed and design PR ready | Complete |
| 2A | 1 | Lease races pass and rollout is documented | Pending |
| 2B | 2A | Deadline/slot/timeout tests pass | Pending |
| 3A | 1 | Concurrent replay produces one financial result | Pending |
| 3B | 3A | All manual-payment clients adopt retry keys | Pending |
| 4A | 1; use 2A fields when available | Monitor failure fixtures pass | Pending |
| 4B | Environment access | Dated delivery, alert and restore evidence | Unverified |
| 5 | 1 | Shared-device and conflict tests pass | Pending |
| 6 | Correctness gates and measured workload | Capacity evidence and release checks | Pending |

The next coding phase is 2A. Its smallest complete unit is schema + ownership checks + race tests + deployment ordering, in one PR. Financial replay work follows in a separate PR so queue failures and payment behavior can be reviewed independently.
