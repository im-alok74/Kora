# Night chat 3: foundations (branch night-3, migrations 0130-0139)

## Tasks
- [ ] 1. GitHub CI green on night-3
- [ ] 2. Full regression on clean checkout (typecheck, unit, e2e)
- [ ] 3. Team and roles screen, invites, audit log screen
- [ ] 4. Security review as attacker, with tests
- [ ] 5. Public API v1 complete, idempotency, OAuth-style flow, openapi + docs
- [ ] 6. Webhooks: catalogue, test-send, delivery log + retry, signature docs
- [ ] 7. Performance: EXPLAIN at 50k invoices, indexes, N+1, timings
- [ ] 8. Reliability: backups, health/readiness, status, error hooks, graceful shutdown, DLQ view
- [ ] 9. Accessibility and mobile, PWA offline invoice
- [ ] 10. docs/deploy.md exact for Vercel + Supabase + worker

## Needs you

## Log
- 2026-10-22: worktree ../kora-night-3 created, deps installed, .env copied.
- 2026-10-22 task 1: CI run on kora-phases failed only in e2e, three specs. Causes: (a) home-page spec looked for a link 'Sign in to Kora' that the redesigned landing no longer has (now 'Sign in'); (b) bell spec relied on a GST due date showing, which depends on today's date (only near the 11th and 20th), now it makes a draft aged 5 days instead; (c) landing page text below AA contrast (small greys) and axe measured mid-fade colours, fixed greys in landing.css and the spec uses reduced motion. All three pass locally.
