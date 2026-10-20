# Kora v1: final report

Date: 2026-10-19. Status: **feature-complete for v1 against mock adapters. Not yet usable with real money, real e-invoices or real messages.**

## What is built

- **Documents.** Tax invoice, bill of supply, estimate, proforma, delivery challan, credit note, debit note. Gapless numbers per series and financial year, assigned by the database at issue. Issued documents are frozen; corrections are credit and debit notes.
- **Tax.** One pure integer-paise library (`packages/tax`): CGST/SGST/IGST, cess, reverse charge, TDS, TCS, round-off, place of supply. Cross-checked against SQL.
- **Parties and items.** GSTIN checksum and state checks, HSN or SAC, rate list.
- **Delivery.** PDF, public link with view count, WhatsApp, SMS and email through a retrying Postgres queue.
- **Collections.** UPI QR for the amount due, hosted payment links, idempotent signed webhooks, partial payments, allocation to invoices and credit notes, scheduled reminders, ageing.
- **Compliance.** E-invoice (IRN and QR) through a partner adapter, with pre-check, plain-words rejections, correct-and-resubmit, retry through outages, 24 hour cancel. GSTR-1 JSON and a GST summary that reconcile to the ledger.
- **Offline.** Installable app, drafts on the device, local totals from the same tax library, sync with conflict handling, service worker that also keeps each page's scripts.
- **Team and reports.** Owner, staff, accountant roles enforced in the database; activity log nobody can edit; several businesses per login; sales register, by customer, payments, statements, CSV that cannot run as formulas.
- **Hardening.** Row-level security including removed members, security headers (HSTS in production), JSON-only writes, mock adapters refuse to start in production without `KORA_ALLOW_MOCKS=1`, `/api/health` and worker `/healthz`.
- **Docs.** `README.md`, `docs/compliance.md`, `docs/deploy.md`, `replica/cost-model.md`.

## Test results (this run)

| Suite | Result |
|---|---|
| Database (migrations, RLS, roles) | 12 pass |
| Tax library (cases, properties at 10,000 runs, DB cross-check) | 48 pass |
| PDF | 10 pass |
| Core services | 135 pass |
| SQL smoke (`pnpm db:smoke`) | pass |
| Typecheck, all packages | clean |
| Browser end to end (Playwright, production build, web + worker + mock partner) | **46 of 46 pass** |

Parity (`replica/features.csv`): **68.6 / 100**, must-haves 25 of 32 done. The 7 open must-haves are the three messaging channels (built, but only against a mock sender), GSTIN lookup (state only), estimate expiry and convert, TDS/TCS fields in the editor, and the template editor's block layout. Brand sweep: clean. No em dashes in project files.

## Bugs found and fixed in this final pass

- Opening a draft turned a quantity of 10 into 1 (zero-stripping regex).
- The invoice page overwrote a typed payment amount and recipient number when its background load finished.
- The reports page crashed when switching tabs (previous tab's data shown for one frame).
- The service worker cached pages without their scripts, so the list and reload did not work offline.
- The invoice list did not refresh when the connection returned.
- Job `run_at` came from the app clock and could be ahead of the database clock, delaying a job.
- `OTP_PROVIDER=mock` ignored `KORA_ALLOW_MOCKS=1` in production mode, unlike the other mocks.
- Playwright now tests the production build (4 minutes) instead of the dev server (20 minutes, flaky).

## Open issues and known limits

- Every send, payment and e-invoice runs on a **mock** adapter. The mock partner's error codes must be mapped to the real partner's list.
- Rate seed, HSN length rule, nil/exempt reporting and the GSTR-1 JSON structure are **unverified** and need a CA (see `docs/compliance.md`).
- No return filing, purchases or input tax credit, e-way bills, exports or SEZ, reverse-charge e-invoice, recurring invoices, inventory or customer portal.
- The logo is a placeholder. Estimate expiry and convert-to-invoice are missing. Email has no PDF attachment yet.
- Review-based claims about competitors (G2, Capterra) were never verified; competitor items marked unknown stay unknown.
- The CSP is partial (frame, base, form, object); a full script policy needs nonce support in Next.js.
- No load test, no external penetration test, no restore drill has been run.

## Needs real credentials or approvals before launch

1. **GST partner (GSP)** sandbox, then production: e-invoice API, fee card.
2. **Payment gateway** (Razorpay or Cashfree): account, KYC, webhook secret, UPI settlement terms.
3. **WhatsApp Business provider**: approved templates for invoice and reminder.
4. **DLT registration** for SMS: entity, header, templates.
5. **Transactional email** domain and sender.
6. **Hosting, domain and TLS** in an Indian region, managed Postgres with backups.
7. **Trademark and domain checks** for "Kora" in India.
8. **A practising CA** to sign off `replica/tax-cases.md`, the rate seed and the GSTR-1 output.
9. **A lawyer** for privacy notice, terms and data processing terms.
10. Real prices from the partner and WhatsApp rate cards in `replica/cost-model.md`.

## Update, 20 October 2026: segments, hosting and security

Built since the report above: CA firm tools (clients screen, inbox), lawyer matters with client money and private access, freelancer projects with a timer, shop stock and till with tax-inclusive prices and Hindi, Marathi and Gujarati documents, purchases with input tax credit and GSTR-2B matching, the Kora network (invoices between businesses, directory, catalogue, purchase orders), an authenticator app and recovery codes, search, notifications and a dark theme, a public API for matters, purchases and stock, a jobs admin route, a container image, a daily background tick, encrypted backups with a restore check, and Terms and Privacy pages.

Still not built: export invoices under LUT, e-way bills, a live GST partner connection, customer login accounts.

Needs you: put the live-service keys in the environment (see `.env.example`), set `CRON_SECRET`, apply migrations 0021 to 0023 to the hosted database, replace the placeholder contact addresses on the legal pages, and have a lawyer and a CA read them.
