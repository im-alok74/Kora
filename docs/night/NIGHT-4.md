# Night 4: first meeting to first invoice

Branch night-4, migrations 0140-0149.

## Tasks
- [x] 1. Research Zoho Invoice + two others (first five minutes)
- [x] 2. Landing page finished (meta, OG, sitemap, robots, CLS, 375px)
- [x] 3. Pricing page + comparison table
- [x] 4. Sign-up / sign-in polish (strength meter, errors, remember account type)
- [x] 5. Onboarding wizard (GSTIN autofill, logo, look, customer, invoice, skippable, saved)
- [x] 6. Demo data button (label + delete)
- [x] 7. Import guide page (Zoho, Vyapar, Tally, Excel)
- [x] 8. Help centre (15 pages, search, help button, tour)
- [x] 9. Empty states, error pages, 404
- [x] 10. Legal drafts (terms, privacy, refund)
- [x] 11. Polish pass 375px, dark, AA

## Log
- 2026-10-22: worktree ../kora-night-4 created from origin/kora-phases, deps installed.
- Research (Zoho Invoice India page, Refrens home; Vyapar page would not load through browse, it returned a stale tab, so skipped). Public pages only, nothing copied.
  What a good first five minutes looks like:
  1. One clear promise and one button above the fold ("sign up free"), plus a second way in that needs no commitment: Zoho offers an "Explore demo account". We will offer "Try with sample data".
  2. Sign-up asks for little: name, email or phone, password. The business details come after, not before.
  3. Zoho promises "first invoice in under 5 seconds" and sets up the account while you wait. Our equivalent: a short checklist (business, GSTIN, first customer, first invoice), every step skippable, progress saved.
  4. Audience tiles (freelancers, consultants, agencies, entrepreneurs) so people see themselves. We already have CA, lawyers, freelancers, shops.
  5. GST answers up front: "Can I use it if I am not GST registered?", "Does it file returns?" with a plain yes/no. Free tools (invoice template, generator) bring search traffic.
  6. Refrens leads with a long feature list and a "Get a demo"; that is heavy for a small shop. Keep ours short and concrete.
  7. Import from other software is a switching blocker; a guided page lowers it.

- 2026-10-22 (build 1): shared header and footer (components/SiteChrome), metadata, sitemap, robots, share card, security section, FAQ schema. Pricing (placeholder prices marked), 15 help guides (lib/help.ts) with no-script search, public import guide, legal pages rewritten under one LegalPage with a draft banner, refunds page. Migrations 0140 (onboarding_step) and 0141 (business.is_demo, remove_demo_business). Core: onboarding.ts, demo.ts with tests. Web: setup with live GSTIN check, /app/welcome wizard, /app/import, Help button and tour, demo banner, EmptyState, 404 and error pages, password strength, remembered account type.
- Decisions: issued invoices cannot be deleted by design, so "remove sample data" takes everyone off the demo business instead (the member guard trigger is switched off for that one statement inside the definer function and the test proves it is back on). The Data page and /app/import both have an uploader (components/ListImport.tsx is a copy of the Data page logic) so the Data page, owned by others, was not edited. GSTIN name autofill works only when a GST partner supplies a name; the mock gives the state only.

- 2026-10-22 (polish): dark theme for public pages (landing-dark.css), fixed pricing sideways scroll at 375px (absolutely positioned screen-reader text inside the table wrapper), fixed AA contrast on small grey text found by the accessibility e2e. e2e: night4-first-meeting, first-invoice, password-login, access all pass (22). Note for other chats: the shared kora_e2e database gets rebuilt by whoever migrates last, so migrate from your own worktree right before a run.

## Needs you
- Apply migrations 0140 and 0141 to the hosted Supabase project (not done: they are additive but I did not touch the hosted database).
- Replace the placeholder prices on /pricing and the placeholders in /refunds, and have a lawyer review terms, privacy and refunds (all marked as drafts).
- Demo businesses are never hard-deleted (issued invoices cannot be). Decide later whether to allow a purge for is_demo businesses.
(none yet)
