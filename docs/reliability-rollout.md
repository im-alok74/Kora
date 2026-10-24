# Reliability implementation and rollout

Updated 25 October 2026. This is a code/test milestone, not a production readiness certificate.

## Delivered

- Queue claims receive fresh lease tokens. A stale worker cannot complete, retry or fail a newer claim. Expired final attempts become failed. Serial consumers claim only the next execution slot and stop claiming at the tick deadline. In-flight provider calls can still exceed that deadline; external delivery remains at least once.
- Manual payment APIs accept `operationKey`. The business-scoped key, canonical payload hash and original result commit atomically with the financial entries. Concurrent retries return one result. Reusing a key with different details returns HTTP 400. Keys are optional for older clients and are not pruned. The invoice payment form retains its pending key in session storage across reloads; blocked storage falls back to the mounted form's memory. Other payment entry points still require adoption before keys can become mandatory.
- Gateway payment identity is unique independently of webhook event retention. A repeated provider payment cannot create another payment even with a new event ID. After integrating main's PR #43 payment fixes, write-off reversal happens only after confirming a new payment, so replaying an older partial payment cannot undo a later write-off.
- Offline IndexedDB names and sync locks include user and business. Stale-tab requests through the shared client/sync helper are rejected when their scope differs from the authenticated session. Server authorization and RLS remain authoritative.
- Monitoring detects unknown schema status and running claims older than the ten-minute lease.
- `scripts/reliability-benchmark.ts` creates a disposable migrated database and measures save, issue, payment, replay, ageing and PDF operations with correctness assertions.

## Migration and deployment order

1. Back up and verify a restore before production migration. Pause all old workers and scheduled tick consumers. Do not deploy mixed fenced/unfenced consumers.
2. Check existing gateway duplicates with `select gateway, gateway_payment_id, count(*) from payment where gateway is not null and gateway_payment_id is not null group by gateway, gateway_payment_id having count(*) > 1`. Reconcile any results; never delete financial rows automatically to satisfy an index.
3. Apply migrations 0180, 0181 and 0182 using the normal migration runner. The index can require a maintenance window on a large payment table. This repository deploys main automatically, so apply migrations before merging the application change.
4. Deploy the matching web and worker, then resume consumers. Verify schema health, queue progress, retry behavior and a payment operation replay in staging first.
5. On application rollback, pause consumers first. Keep the additive columns, operation records and unique index. Rolling back to old workers restores their known stale-acknowledgment race. Do not remove replay records or replay all failed jobs.

## Offline limits and recovery

The old `kora-offline` database has no trustworthy user/business owner. It is preserved but never automatically imported or synced. Before rollout, sync legacy drafts while still on the previous release. If unsynced legacy data remains, recover/export it on the original device and confirm the business before importing. Do not clear browser storage as a recovery step.

Sign-out clears the active business's drafts/reference data and page caches, after the existing unsynced-draft confirmation. Other scoped business drafts remain for that same account. IndexedDB separation is an application boundary, not encryption against someone with access to the browser profile. Service-worker HTML caches still need a separate multi-tab/shared-device audit; this change does not claim complete offline isolation. Session-storage payment retries do not survive closing the tab or signing out; reconcile the payment list before starting a new operation after either event.

## Operational blockers and remaining phases

GitHub inspection on 24 October found no repository secrets, no `BACKUPS_ENABLED` variable, three recent backup runs skipped and no tick/watch runs. Production execution, notification receipt, blob recovery and a measured restore remain unverified. Configure the existing workflows through the hosting/GitHub secret settings; never commit credentials. A daily backup alone does not establish a 15-minute recovery point.

Remaining work is explicitly phased: provider timeout/shutdown evidence; adoption of operation keys by every payment client; full shared-device/service-worker lifecycle coverage; live backup/restore and worker monitoring; realistic staging load, async PDF/export authorization and signed desktop/mobile package verification. These require additional validation or environment access and are not marked complete by this PR.

## Local performance evidence

Run `pnpm exec tsx scripts/reliability-benchmark.ts` with local test Postgres running. It uses `TEST_ADMIN_URL` or the local test default, never `DATABASE_URL`, and drops only its randomly named test database. It calls no live providers.

24 October baseline: Node 22.23.2, Intel i5-13420H, 16 GiB RAM; one business, four concurrent clients, 24 ten-line invoices; one cold and eight warm serial sample PDFs. Other local builds were active, so these numbers include machine contention.

| Operation | Samples | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| Save 10 lines | 24 | 496.4 | 757.6 | 766.4 |
| Issue | 24 | 1163.9 | 2974.4 | 3540.6 |
| Payment | 24 | 455.0 | 1122.7 | 1569.3 |
| Replay | 24 | 135.5 | 280.6 | 350.8 |
| Ageing, 24 invoices | 24 | 141.8 | 254.1 | 329.3 |
| Cold PDF | 1 | 7282.3 | 7282.3 | 7282.3 |
| Warm PDF | 8 | 1393.4 | 1835.3 | 1835.3 |

Assertions passed: 24 issued invoices, 24 payments despite retries, 240000 paise collected, valid PDF headers. Node process RSS was 135 MiB. HTTP/provider latency, Chromium memory, queue age and pool wait were not measured. Small-sample p99 is effectively the maximum; these figures are not a production capacity estimate. No speculative query/index optimization was made from this sample.
