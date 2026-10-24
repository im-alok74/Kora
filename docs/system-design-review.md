# System design review and handoff

24 October 2026. Reviewed local commit 9fadb70. Scope: end-to-end design and repository evidence, not a production security or compliance certification.

## Completed in this pass

- Wrote [system-design.md](system-design.md): context diagram, module/data ownership, request contracts, invoice/payment sequence, offline sync, PDFs/files, queue semantics, deployment, security, capacity model, observability, recovery and ordered implementation gates.
- Linked the design from README and the existing architecture map.
- Corrected the architecture claim that SKIP LOCKED alone prevents all duplicate execution.
- Corrected migration transaction documentation: pending migrations execute inside one outer transaction, not one transaction per file.
- Corrected worker/tick comments that implied universal replay safety or a hard execution deadline.
- Left runtime behavior, database data, deployment settings and provider accounts unchanged.

## Evidence-backed findings

| Finding | Evidence | Effect | Required next implementation |
|---|---|---|---|
| Daily configured cron | `apps/web/vercel.json` | Without a separately deployed worker, background delivery can wait until the next daily tick | Verify continuous worker and alert on oldest due job |
| Stale claim completion | `packages/core/src/jobs.ts`, `packages/db/migrations/0004_collections.sql` | Ten-minute requeue plus ID-only updates allows an old worker to overwrite a newer claim | Lease token + conditional acknowledgement + race tests |
| Ambiguous provider outcome | `packages/core/src/delivery.ts` | Provider accepts a message before sent status commits; crash can lead to repeat delivery | Stable provider operation key or reconciliation of uncertain sends |
| Cooperative tick budget | `packages/core/src/tick.ts` | A serial batch can outlive the remaining request budget | Claim by execution capacity/deadline; bound provider calls |
| Manual-payment replay gap | `packages/core/src/payments.ts` | Invoice locking prevents over-allocation but does not identify a repeated partial-payment request | Tenant-scoped operation key, request hash and transactional replay response |
| Backup readiness unverified | `.github/workflows/backup.yml`, `infra/restore-check.sh` | Scripts do not prove scheduled backups, PITR or a successful restore | Operational drill and explicit measured RPO/RTO |

## Validation and limits

Checked relative Markdown links and evidence-file existence. Reviewed source-comment changes to ensure they do not alter executable behavior. `git diff --check` passed. No application build or accounting tests are claimed for this documentation-only design pass; the prior PR's results are not reused as evidence for proposed fixes.

No new queue lease, payment idempotency feature, monitoring service or infrastructure deployment is claimed as implemented. Those require the acceptance tests and deployment gates listed in the design. Operational settings remain unknown until inspected on the actual hosts. The design's traffic figures and latency objectives are explicit planning assumptions, not measured capacity.

## Recommended implementation order

1. Confirm delivery execution and backup recovery on actual infrastructure.
2. Implement lease fencing and bounded queue processing, with crash/concurrency tests.
3. Add replay-safe manual payment operations and provider reconciliation.
4. Verify tenant isolation across offline caches and business switching.
5. Instrument latency/queue age and use measurements to size PDF/export workers.

Complete one change with its tests and rollback plan before starting the next. Financial correctness and recoverability take priority over adding more product sections.
