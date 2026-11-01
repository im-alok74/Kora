# Kora for CA firms: research and product direction

Research date: 29 October 2026. Scope: Indian practising Chartered Accountants and their teams. Repository inspected: local commit `8eb065e`; deployed behavior and newer remote branches were not audited. This is desk research plus a source-code review, not interviews or proof of product-market fit. Product proposals below are recommendations, not implemented features.

## 1. Recommendation

Make Kora the daily workspace where a CA firm can see which client-period work is blocked, collect the missing evidence, assign preparation and review, and record what was actually completed.

Start with the monthly GST and books-review cycle for small and growing practices. Connect the firm's workflow to Kora's existing invoicing, purchase and reconciliation data when available, but support clients who continue using Tally, spreadsheets or another accounting product. A client should not have to migrate their books merely to become a managed client.

The promise to test: **Every client, period, missing document, exception and review decision has an owner and a traceable next step.**

"Every CA will use Kora" is a useful ambition, not a realistic first market definition. Audit specialists, sole practitioners, outsourced bookkeeping teams and large advisory firms have different workflows. Win a repeatable segment before expanding.

Initial recruitment hypothesis: firms with roughly 3-20 team members and 20-150 active GST registrations, with recurring bookkeeping/GST work. These ranges are pilot selection criteria, not a measured market distribution. Interview smaller and larger firms as counterexamples. Do not exclude individual-income-tax clients from the data model merely because GST is the first workflow.

## 2. What the research establishes, and what it does not

Evidence is deliberately separated:

| Evidence | What it supports | Limitation |
|---|---|---|
| GSTN documentation on IMS and QRMP [S1-S3] | Compliance work has changing, registration- and period-specific requirements | Does not measure how much time firms lose |
| ICAI audit-documentation discussion [S4] | Reviewable evidence and reasoning matter in audit work | An audit principle is not a universal statutory requirement for every routine task |
| IFAC practice discussion [S5] | Staffing, workload, software cost and change are recognized SMP concerns | Global advisory-group discussion, not an Indian representative survey |
| Zoho Practice, Jamku and Tally documentation [S6-S10] | Existing products already support substantial practice/reconciliation workflows | Vendor features do not prove adoption, satisfaction or market share |
| Two Indian practitioner discussion threads [S11-S12] | Concrete examples of multi-client and reconciliation friction | Anonymous, self-selected anecdotes; one thread's author discloses building a related product |
| Kora source code | Current implementation and limitations | Not a live production audit |

No defensible Indian prevalence, willingness-to-pay or time-saved percentage was established. Do not market invented numbers such as "saves 80% of CA time." Search snippets sometimes disagree with page-relative dates; source access date is recorded here without treating crawl dates as publication dates. Some search results were developer research posts or promotional content; those were not treated as customer validation.

## 3. Pain points by role

These are prioritized hypotheses triangulated from the evidence, not a numerical survey ranking.

| Person | Pain to investigate | Product response | Evidence and confidence |
|---|---|---|---|
| Partner / proprietor | Repeatedly asking everyone which clients are blocked or ready | Portfolio work list with accountable owner, blocker age and review queue | S5-S8; medium for importance in target firms |
| Manager | Client work gets stuck between collection, preparation and review | Dependencies, internal target dates, escalation and reassignment | S6-S8; medium |
| Article assistant / preparer | Documents arrive without the right client, period or context; corrections cause rework | Request checklist, versioned evidence, clear instructions and reviewer comments | S6-S8; medium; validate frequency directly |
| Reviewer / partner | "Done" does not show what was checked or why an exception was accepted | Version-specific sign-off, unresolved-exception gate and evidence bundle | S4 plus S8; high design relevance, audit-specific legal applicability |
| GST preparer | Books and portal records do not align; invoice identifiers vary | Explainable candidate matching and an exception-resolution queue | S1, S9-S10, S12; high that the workflow exists, unknown time cost |
| Client owner / bookkeeper | Requests are repetitive or unclear; another portal adds effort | Mobile-friendly upload/request link, clear period and visible receipt status | S6-S7; medium, validate channel preference |
| Firm administrator | Shared logins, departing staff and unclear client access | Individual identities, scoped assignments, revocation and access history | S5 and Kora permission gap; medium operational priority |
| Partner / billing administrator | Completed work is not linked to an agreed fee or collection status | Engagement scope, billable completion queue and firm receivables | S8 and Kora's existing invoice engine; medium |
| Firm adopting new software | Migration and double entry outweigh the new dashboard's value | External-client onboarding and import preview without compulsory bookkeeping migration | S11; strong example, low confidence on prevalence |

An important nuance from S12: some respondents send mismatch reports to clients and do not perform supplier follow-ups themselves. Therefore follow-up ownership and chargeability must be configurable. Do not assume the CA firm is responsible for every vendor chase.

Software can reduce coordination and handover costs. It cannot by itself solve qualified-staff shortages, a poor engagement scope, portal outages or every client delay.

## 4. What Kora already has

The current code provides a useful starting point, but the CA dashboard is not yet a full practice-management system.

| Capability | Observed implementation | Implication |
|---|---|---|
| Multiple clients | `packages/core/src/firm.ts`, `apps/web/app/app/firm/page.tsx`: membership-based business roll-up and switching | Extend the underlying model beyond businesses the user personally belongs to |
| Portfolio summary | Receivables, overdue amounts, drafts and standard monthly GST prompts | Most headline metrics describe money owed to clients, not work or fees owed to the CA firm |
| Deadline prompts | `gstDeadlines()` covers the previous month's standard dates for regular registrations; comments explicitly exclude QRMP/extensions | Replace with source-backed obligation instances before calling it a compliance calendar |
| Attention list | Includes client receivable overdue counts and GST dates in the next five days; no actual return-completion record | A passed deadline is not proof of a missed filing; a future date is not proof work is outstanding |
| Portfolio scale | `firmSummary()` sequentially reads a maximum of 200 memberships | Add visible pagination/truncation and measure larger portfolios; never silently present partial totals as complete |
| Document inbox | `packages/core/src/inbox.ts`: new/done/rejected, reviewer reason, JPEG/PNG/PDF, 2 MB limit | Missing requested-document lists, engagement/period linkage, versioned completion and broader practical formats |
| Team permissions | `permissions.ts`: owner/staff/accountant at business level; staff can issue documents; accountant can review inbox and work on purchases | Does not express firm partner/manager/preparer/reviewer or independent approval of a return package |
| Reconciliation | `purchases.ts`: GSTR-2B import, normalized supplier/invoice matching and four result buckets; fixed monetary tolerance | Reuse it, then test ambiguous IDs, repeated numbers across years, duplicates and source revisions before scaling |
| Local acceptance | `/api/itc/gstr2b/accept` creates a purchase bill from a statement entry | This is **not** an IMS action on the GST portal; keep labels and integrations distinct |
| Return preparation | GSTR exports and totals exist | `docs/compliance.md` explicitly says no return filing; some utility layouts/live integrations are unverified |
| Finance and evidence | Invoices, collections, files, export and audit foundations exist | Reuse for the firm's own billing and evidence, with explicit tenant boundaries |

Other useful references: `packages/core/src/gstr.ts`, `packages/core/src/tenancy.ts`, `packages/core/src/bankstatement.ts`, `docs/api.md`, `docs/compliance.md`, `packages/core/test/firm.test.ts`, `packages/core/test/inbox.test.ts`. This research did not rerun their tests.

## 5. Competitor lessons and positioning

| Reference | Observed capability | Lesson for Kora |
|---|---|---|
| Zoho Practice [S6-S7] | Client work, requests, collaboration and practice operations | A generic dashboard or task list is already expected; contextual client communication matters |
| Jamku [S8-S9] | Client/service/period tasks, verification, document requests and billing lifecycle | Model service-period work explicitly and connect completion to billing |
| TallyPrime [S10] | GST/IMS records and actions inside its accounting workflow | Do not claim reconciliation or IMS as a unique invention; integrate with existing books |

Kora's proposed differentiation is the connection between business-side source records and firm-side work: a changed purchase bill should identify the affected exception and review package; a received document should satisfy the right request; a completed engagement should enter the firm's billing queue. This is a product hypothesis to validate, not a claim competitors cannot do it. Zoho also supports clients using other software, so external-client support is a requirement, not a unique selling point.

Avoid competing on the longest feature list. Test whether Kora reduces the number of follow-up messages and review cycles needed to close one client-period correctly.

## 6. The first complete use case

Example: a firm prepares monthly GST work for a client using Tally, while another client invoices in Kora.

1. Onboard each legal entity and its registrations, contacts, source software, service scope and filing frequency. Record the client's authorization and nominated reviewer. A managed client can exist without a Kora bookkeeping account.
2. Create one recurring engagement per applicable registration, service and period. Use a source-backed statutory deadline plus a separate internal target. Prevent duplicate recurring creation.
3. Send a period-specific document checklist. Give the client an easy secure upload route. Mark each item received, needs correction, accepted or waived with a reason. Pause reminders when appropriate.
4. Import books/portal files with a preview, source timestamp, hash, totals and duplicate check. Use Kora records directly when authorized. Keep originals; do not silently overwrite them.
5. Route exceptions to an owner. Show source rows, difference, suggested explanation, decision and supporting evidence. A suggested match is not an automatic ITC eligibility decision.
6. Submit an immutable version of the preparation package for review. Reviewers accept or return individual issues. Changes after approval create a new version and invalidate the previous approval for that version.
7. Obtain client approval when the engagement requires it. Record who approved precisely which version. Internal preparation, internal review and client approval are separate events.
8. Record filing separately. An export or staff click must not become "portal verified." Until an authorized integration exists, use "marked filed, evidence uploaded" with reference, timestamp and attachment; independently verified status needs a trusted receipt/status source.
9. Close with an evidence bundle and, if billable, create a firm billing item. Track the firm's fees separately from the client's receivables.

```mermaid
flowchart LR
  A[Client and service scope] --> B[Period engagement]
  B --> C[Documents and source data]
  C --> D[Preparation and exceptions]
  D --> E[Review of a specific version]
  E -->|Changes required| D
  E --> F[Client approval when required]
  F --> G[Filing evidence and status]
  G --> H[Closure and firm billing]
```

Represent blockers independently from progress: a case may be in preparation and waiting for one bank statement. Capture blocker owner, reason, next action and expected response date instead of flattening everything into "pending."

## 7. CA admin experience

Recommended navigation: **Overview, My work, Clients, Engagements, Requests, Reconciliation, Reviews, Calendar, Firm billing, Team, Settings.** Roll out only the sections with working workflows.

The default desktop view should be an actionable table. Use restrained status labels and keyboard-friendly filters, with client, registration, period, service, preparer, reviewer, progress, blocker, internal target, statutory deadline, evidence status and next action. Make saved views easy to share.

Role-specific defaults:

- Partner: overdue/unverified obligations, approvals waiting, old blockers and firm fees due.
- Manager: assignments, unassigned work, workload and review turnaround.
- Preparer: my work today, missing inputs and returned review comments.
- Reviewer: ready packages, changed-after-review packages and unresolved exceptions.
- Client: only their requests, submitted files and approvals; never internal staff notes.

Headline cards should answer operational questions: due soon, blocked by client, awaiting review, filing evidence missing, completed but unbilled. Every card must drill into the underlying records. Show when data was refreshed and distinguish unknown from zero. Do not represent time logged as employee productivity or require intrusive monitoring.

A mobile view should prioritize responding to requests and approvals. Complex reconciliation deserves a desktop grid. A new native app is not a prerequisite for proving this workflow.

## 8. Data, permissions and operational requirements

Keep the modular monolith. Add a firm layer without turning the firm's owner into an unrestricted administrator of every client's books.

Suggested entities: `firm`, `firm_member`, `client_entity`, `client_registration`, `client_access_grant`, `service_template`, `engagement`, `engagement_assignment`, `document_request`, `document_version`, `reconciliation_run`, `exception_case`, `review_submission`, `approval`, `filing_evidence`, `fee_item`.

A client entity may have several registrations and zero or several linked bookkeeping businesses. One person can belong to multiple firms and businesses. Every request must authorize both the firm role and that client's permitted scope. Access revocation must stop access to files, exports and queued operations too. Client users cannot see other clients or internal notes. Bulk actions must validate every selected record rather than relying on the list filter.

Store source snapshots and version review decisions. Retain raw invoice identifiers alongside normalized ones; show ambiguous candidates rather than collapsing them into one match. Keep matching, eligibility assessment, proposed IMS action and actual portal acknowledgment as separate concepts. GSTN's October 2025 changes demonstrate why rules must be period-versioned [S1].

Calendar rules need applicability, authoritative source, effective period, verification date and reviewed overrides. Store deadline changes historically and recompute only affected obligations. Start with reviewed templates and explicit manual overrides; do not claim full automated regulatory coverage.

Use existing background jobs for reminders, imports and exports with deduplication, retries and visible failures. Add malware scanning, safe spreadsheet handling and file-size validation before widening the inbox's supported formats. Share links should be scoped, revocable and time-limited; record delivery versus merely queued notification. Use authorized portal/GSP integrations rather than treating shared passwords, OTP capture or browser scraping as the product's integration strategy.

Evidence retention should be configured by engagement type and applicable requirements, with legal holds and export. ICAI's audit-documentation guidance informs audit workpaper design [S4]; do not advertise blanket SA 230 compliance or one retention duration for every file type.

## 9. Build order and acceptance gates

These are sequential product phases, not promises of delivery dates.

| Phase | Deliverable | Acceptance gate |
|---|---|---|
| Discovery | Observe real work in 8-12 firms; collect anonymized workflow examples | Repeated pain and budget owner identified; firms agree to pilot a specific workflow |
| Foundation | Firm/client/registration model, scoped roles, external-client import, service-period engagements | Two firms cannot access each other's data; staff see only authorized clients; recurrence cannot create duplicate cases |
| Collection and review | Request checklist, secure uploads, reminders, assignments, review/version history and completion evidence | A real client-period moves end to end; received files stop the correct reminders; changed evidence requires re-review |
| Reconciliation depth | Import adapters, source snapshots, ambiguous-match handling, exception decisions and current-format validation | Gold dataset covers repeated IDs across years, duplicates, credit notes, amendments and period changes; no silent matches |
| Firm economics | Engagement fees, unbilled work and receivables in the firm's own books | Completed billable work creates one billing item; client-business receivables stay separate |
| Broader services | ITR/TDS/ROC service templates, notice tracking, advanced audit workpapers and approved integrations | Each service has a practitioner-reviewed checklist, sample cases and evidence requirements |

Fix the current misleading-risk areas early: deadline prompts without actual completion, the 200-client cut-off without explicit pagination, and local GSTR-2B acceptance that could be confused with portal IMS acceptance.

The first release should deliver one complete collection-to-review workflow. Avoid simultaneously building a full income-tax engine, payroll, statutory audit suite, all MCA filings and native desktop/mobile products.

## 10. Responsible automation and AI

Useful candidates after the deterministic workflow works: classify an upload, suggest its period, extract invoice fields with a source highlight, draft a reminder, summarize an exception or suggest a checklist. Show confidence and preserve the source.

Do not autonomously claim ITC, accept/reject portal IMS records, sign or file returns, overwrite books or convert generated explanations into approved evidence. Humans must approve material actions under explicit permissions. A document's text is untrusted input, not an instruction to the system. Test the manual path when AI is unavailable or wrong.

## 11. Validation, adoption and pricing research

Interview partners, managers, preparers and client bookkeepers separately. Ask them to demonstrate the last completed month, not to speculate about a feature list. Request anonymized examples with permission; do not solicit client passwords or identifiable tax documents.

Interview guide:

1. Show how you know which client-periods are still incomplete today.
2. Show the last delayed engagement. What was missing, who chased it, and where was the status kept?
3. How does a manager know a preparer's work is ready? What makes it come back for rework?
4. Show a difficult reconciliation exception and the evidence used to decide it.
5. Who owns supplier follow-up, and is it included in the fee?
6. What happens when an article assistant leaves halfway through a month?
7. Which clients use Tally, Excel, other software or no bookkeeping system? Which files can actually be exported?
8. How do you prove a filing happened? How do you track a late portal acknowledgment?
9. How do you find completed but unbilled services? What is the current collection process?
10. Which existing tool would Kora replace, who approves the purchase, and what would stop a switch?

Pilot with 3-5 firms over two full recurring cycles. Capture baseline and pilot measurements for comparable services and client volumes, including training time. Measure median staff touch time per engagement, request completion time, follow-ups per request, reviewer turnaround, reopened work, completion with evidence, and weekly active staff. Track error rates, missed obligations and access failures as guardrails.

Suggested decision targets, explicitly hypotheses: at least three firms complete a second cycle without founder assistance; at least 80% of pilot cases have an owner and supported completion evidence; median follow-up effort falls by 25% without increasing unresolved exceptions. Adjust these with baseline data; do not publish them as achieved outcomes. A severe authorization leak stops rollout regardless of time savings.

Onboarding should import client lists and provide one useful service template before demanding customization. Compare a flat firm subscription with staff/active-client tiers in paid pilots. Do not assume a particular rupee price or willingness to pay. Test free/easy client participation, transparent storage/messaging costs and complete data export. Do not make the client buy a full accounting subscription just to upload a requested statement.

Unresolved questions: pain severity by segment, real time costs, client willingness to use upload links, budget, portal-access arrangements, current integration formats, who owns compliance updates, and the support cost of onboarding each firm. These require practitioner research and partner validation.

## 12. Sources

All accessed 29 October 2026. Vendor pages describe capabilities, not independently verified performance. Anonymous discussions supply examples, not estimates of the Indian CA population.

- **S1:** [GSTN: IMS changes from October 2025 tax period](https://tutorial.gst.gov.in/downloads/news/creative_faq_on_gstr9_for_24_25_dt_15_oct_25_v6_final.pdf). Official document; its internal title identifies IMS despite the filename. Establishes that actions and period rules evolve, not a complete October 2026 specification.
- **S2:** [GSTN: revised IMS advisory](https://tutorial.gst.gov.in/downloads/news/revised_advisory_on_ims.pdf). Official workflow and recomputation context; read with subsequent changes.
- **S3:** [GSTN: QRMP profile FAQs](https://tutorial.gst.gov.in/userguide/returns/FAQs_change_profile.htm). Official evidence that filing profile is not one universal monthly schedule. No current statutory due-date calendar is supplied by this research.
- **S4:** [ICAI Journal: Audit Documentation, A Cornerstone of Audit Quality](https://cajournal.icai.org/article-details/audit-documentation-a-cornerstone-of-audit-quality). Professional guidance on audit evidence, consistency and review. The directly linked SA 230 PDF failed to fetch; this report does not claim a full standards review.
- **S5:** [IFAC: perspectives from small and medium accounting practices](https://www.ifac.org/knowledge-gateway/discussion/turning-challenges-opportunities-perspectives-small-and-medium-accounting-practices). Global professional-body discussion; historical context, not a current Indian prevalence survey.
- **S6:** [Zoho Practice product overview](https://www.zoho.com/practice/). Vendor capability reference, including support for clients using other software.
- **S7:** [Zoho Practice client request details](https://www.zoho.com/practice/help/client-requests/client-request-details.html). Vendor workflow documentation.
- **S8:** [Jamku task documentation](https://help.jamku.app/guide/task.html). Service-period work, verification and billing lifecycle.
- **S9:** [Jamku document documentation](https://help.jamku.app/guide/document.html). Requests, document movement and assigned-team permissions.
- **S10:** [TallyPrime IMS inward documentation](https://help.tallysolutions.com/invoice-management-system-inward-in-tallyprime/), page dated 11 August 2026; [GSTR-2B reconciliation](https://help.tallysolutions.com/gstr-2b-reconciliation/). Vendor descriptions, not tested integrations with Kora.
- **S11:** [Indian practitioner discussion: multi-client GST without billing](https://www.reddit.com/r/CharteredAccountants/comments/1sepg1b/what_gst_software_are_you_using_for_multiple/). Anonymous anecdote supporting the external-client hypothesis.
- **S12:** [Indian practitioner discussion: GSTR-2B reconciliation across clients](https://www.reddit.com/r/CharteredAccountants/comments/1wutgmw/how_are_you_handling_gstr2b_reconciliation_for_30/). Examples of identifier differences and differing follow-up ownership. Original author also promotes a related workflow, so evidence weight is low.
