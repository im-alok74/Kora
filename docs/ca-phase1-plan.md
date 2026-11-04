# Kora for CA firms: verification and Phase 1 plan

Checked against `main` at `452cdaf` (newer than the `8eb065e` the research used). Read-only review: no code, no database change, no tests rerun. Companion to `docs/ca-practice-research.md`.

## 1. Verification of the research's code claims

| Claim in the research | Status | Evidence in `main` |
|---|---|---|
| Firm roll-up is membership-based (`firm.ts`) | Accurate | `firmSummary` calls `listBusinesses(userId)` (`my_memberships`), then `resolveTenant` + `inTenant` + `dashboardSummary` per client |
| Silent 200-client cut-off, sequential reads | Accurate | `MAX_CLIENTS = 200`, `.slice(0, MAX_CLIENTS)`, no truncated flag returned |
| `gstDeadlines` is the standard monthly calendar only | Accurate | Returns `[]` unless `registrationType === 'regular'`; GSTR-1 on the 11th, GSTR-3B on the 20th; no QRMP, no extensions |
| Attention list is not completion-aware | Accurate, one nuance | `needsAttention` = overdue invoices, or a deadline 0-5 days away. A deadline that has already passed raises no flag, so it is not just "not proof of a miss": it is invisible |
| Roles are business-level owner/staff/accountant | Accurate | `permissions.ts`: accountant is read-only plus `report.export`, `audit.read`, `inbox.review`, `purchase.write`. No firm roles |
| Inbox: new/done/rejected, 2 MB, JPEG/PNG/PDF, reason on review | Accurate | `inbox.ts`; magic-byte check; list limit 200 |
| Reconciliation: normalised key, fixed tolerance, four buckets | Accurate | `purchases.ts`: `gstin|normaliseInvoiceNumber`, `TOLERANCE = 100n` paise, matched / mismatched / onlyIn2b / onlyInBooks. Normalising strips leading zeros and punctuation, so `INV-001` and `INV001/2025` style collisions across years are real |
| "Accept" on GSTR-2B is local, not an IMS action | Accurate | `/api/itc/gstr2b/accept` -> `acceptGstr2bEntry` creates a purchase bill only |
| No return filing | Accurate | `docs/compliance.md`: "It does not file returns." |

**Outdated, not wrong.** `main` now has `plans.ts` (starter / business / firm; firm = Rs 1,999, 25 members), `billing.ts`, `admin.ts`, DPDP work, and migrations 0190-0193. Plans attach to one `business`, so the `firm` plan limits team size of a business. It does not create a firm entity, a client list or firm-scoped access. Highest migration is 0193.

**Not in the code (research is right that these are absent):** no firm entity, no client without a business, no service-period engagement, no document-request checklist, no review version or sign-off, no firm roles.

**Where I would change the research's wording or advice**
1. "Extend the model beyond businesses the user personally belongs to" understates the cost. Tenancy is `withTenant({ businessId, userId })` and RLS keys on business. A client with no Kora account has no `businessId`, so the firm needs its own tenant key (`firm_id`), not a loosened business check.
2. Adding a client today means inviting every firm staff member into that business via `add_member`. That is why staff cannot be scoped per client. Phase 1 must replace this for firm work, not wrap it.
3. Source S1 is a GSTR-9 FAQ PDF whose filename does not match its content (the research notes this). Treat the GST rule claims as unverified until a primary GSTN notice is cited for the calendar templates.
4. The Reddit sources (S11, S12) are weak evidence; the research says so. Do not use them to justify pricing or the 3-20 member target.

## 2. Phase 1 PRD

**Goal.** One complete client-period workflow for monthly GST: a firm sees which client-periods are blocked, collects documents, assigns preparation and review, and records what was completed. No filing, no new accounting engine.

**Users.** Partner, manager, preparer, reviewer (firm); client contact (upload and approve only).

**In scope**
- Firm, firm members with four roles, firm plan limits.
- Client entity with registrations (GSTIN, type, filing frequency regular or QRMP, source software). A client may have no Kora business.
- Optional link from a client to a Kora business, accepted by that business's owner, revocable.
- Per-member client assignment (staff see only assigned clients).
- Service templates and period engagements: one per registration + service + period, internal target date separate from statutory deadline, owner, reviewer, blocker (reason, owner, expected date) kept apart from status.
- Document request checklist per engagement, expiring revocable upload link, receive / needs-correction / accepted / waived-with-reason, reminders with dedupe.
- Review: submit an immutable package version, accept or return issues, edit after approval invalidates that approval.
- Filing evidence: "marked filed, evidence uploaded" only. Never "verified".
- Overview, My work, Clients, Engagements tables.
- Fix first: visible truncation on the 200 cap, label GSTR-2B accept as "adds to your books, not the GST portal", show a "deadline passed" state.

**Out of scope.** Firm billing and fee items, reconciliation depth beyond showing existing results as exceptions, ITR/TDS/ROC, AI extraction, portal or GSP integration, native apps.

**Success gates (from the research, kept as hypotheses).** Two firms cannot see each other's data. Staff see only assigned clients. Recurrence cannot create a duplicate engagement. Revoking a member or a client link stops file access, exports and queued jobs. A real client-period goes end to end in a pilot.

**Open decisions for the owner**
1. Does the `firm` plan (25 members) become a per-firm limit, plus a client-count limit?
2. Is a client contact a login user or a link-only guest in Phase 1? (Recommendation: link-only.)
3. Who owns reminders' WhatsApp/SMS cost: firm or Kora?

## 3. Data model (migrations 0200-0209 reserved; 0194-0199 left to other sessions)

All tables carry `firm_id`, forced RLS on `firm_id` via a new `withFirm(sql, { firmId, userId }, fn)` mirroring `withTenant`. Money none in Phase 1.

| Table | Key columns | Notes |
|---|---|---|
| `firm` | id, name, plan, created_by | Plan reuses `plans.ts` ids |
| `firm_member` | firm_id, user_id, role (`partner`,`manager`,`preparer`,`reviewer`), active | Unique (firm, user); revoke = `active=false` |
| `client_entity` | id, firm_id, legal_name, pan, source_software, contacts, status | Exists without a business |
| `client_registration` | id, client_id, gstin, registration_type, filing_frequency, state_code | Unique (firm, gstin) |
| `client_business_link` | client_id, business_id, status (`pending`,`active`,`revoked`), accepted_by | Created by firm, activated by business owner only |
| `client_assignment` | client_id, member_id | Scope for non-partner roles |
| `service_template` | id, firm_id, code, checklist jsonb, frequency | Seed: `GST_MONTHLY` |
| `engagement` | id, registration_id, service, period, statutory_deadline, deadline_source, internal_target, status, owner_id, reviewer_id, blocker jsonb | Unique (registration, service, period) |
| `document_request` | id, engagement_id, label, status, reason, due | |
| `document_version` | id, request_id, file_ref, sha256, uploaded_by, uploaded_via, created_at | Append-only |
| `upload_link` | id, engagement_id, token_hash, expires_at, revoked_at | Hash only; never store token |
| `review_submission` | id, engagement_id, version_no, package_hash, status, decided_by | Immutable once submitted |
| `review_issue` | id, submission_id, text, status | |
| `filing_evidence` | id, engagement_id, reference, filed_at, file_ref, marked_by | Status wording is "marked filed" |
| `firm_audit` | firm_id, actor, action, subject, at | Reuse audit helper pattern |

Authorization is two checks on every call: firm role allows the action, and the client is in the member's scope (partner/manager all clients; preparer/reviewer only assigned). Bulk actions re-validate each id server side.

## 4. PR tickets (each small, own tests, no cross-dependency except as listed)

| # | Ticket | Depends | Done when |
|---|---|---|---|
| 0 | No-schema fixes: return `truncated`/`total` from `firmSummary` and show a banner; relabel GSTR-2B accept; add "deadline passed" to `Deadline` | none | Test with 201 memberships shows the banner; e2e copy check |
| 1 | `firm`, `firm_member`, `withFirm`, role table in `permissions.ts` (firm actions), create-firm flow | none | Cross-firm read test fails closed; non-member gets 403 |
| 2 | `client_entity`, `client_registration`, add-client form, CSV import with preview and duplicate GSTIN check | 1 | Import of 150 rows previews, rejects bad GSTIN, idempotent on re-run |
| 3 | `client_assignment` plus scoped list queries and scope helper | 2 | Preparer sees only assigned clients; direct id access returns 403 |
| 4 | `client_business_link` invite/accept/revoke; firm summary reads linked businesses through the link, not `add_member` | 2 | Revoke blocks summary, files, exports; owner-only accept |
| 5 | `service_template` seed and `engagement` table plus idempotent monthly generator job | 2 | Running the job twice creates no duplicate; QRMP registration gets quarterly rule or "manual", never a guessed date |
| 6 | Owner/reviewer assignment and blocker on engagement; Engagements and My work tables | 3, 5 | Blocker and status change independently; filters work |
| 7 | `document_request`, `upload_link`, client upload page reusing inbox file checks | 5 | Expired or revoked link refused; wrong-type file refused |
| 8 | `document_version`, request statuses, reminder job with dedupe and stop-on-receive | 7 | Received file stops the right reminder only; delivery vs queued recorded |
| 9 | `review_submission`/`review_issue`, version invalidation, exception list fed from existing reconciliation output | 6, 8 | Change after approval reopens review; unresolved issue blocks close |
| 10 | `filing_evidence` and close flow | 9 | Cannot close without evidence; wording never says "verified" |
| 11 | Overview page: due soon, blocked by client, awaiting review, evidence missing; unknown vs zero | 6, 9, 10 | Each card drills to rows; refresh time shown |
| 12 | Pilot measurement events (touch time, follow-ups, reopen count) | 11 | Counts visible per firm; no per-person surveillance view |

Order: 0 first (ships alone, fixes live risk), then 1, 2, 3 and 4, 5, then 6 to 12. Tickets 3 and 4 can run in parallel after 2.

## 5. Risks to hold the line on

- RLS on a second tenant key is the biggest risk. Ticket 1 must land with a negative test suite before anything else builds on it.
- Do not let `firm_member` role imply access to a client's books. Books access only comes from an active `client_business_link` plus a business-side role.
- Keep calendar rules as reviewed templates with a recorded source and verification date; manual override is allowed, silent automation is not.
