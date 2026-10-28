# DPDP Act 2023: what Kora does and what is still the owner's

Kora is a data fiduciary for the people who sign in (the "users") and a data processor for the personal data a business enters about its own customers (the business decides the purpose). This page maps the Act's duties to the code. It is an engineering record, not legal advice: have a lawyer confirm the notice, the retention periods and the dates the Rules bring each duty into force.

| Duty | What exists | Where |
|---|---|---|
| Notice before consent | Terms and privacy notice shown beside the sign-up button; notice has a version (`NOTICE_VERSION`) | `apps/web/app/login/page.tsx`, `apps/web/app/privacy/page.tsx`, `packages/core/src/privacy.ts` |
| Consent that can be shown | Every decision is an append-only row (`consent_event`): who, which purpose, given or withdrawn, which notice version, from where, when. Sign-up records `terms_privacy` | `0190_dpdp.sql`, `setConsent` |
| Withdraw as easily as give | Checkboxes on `/app/privacy`; optional purposes only (`product_updates`, `messaging_notifications`). The terms cannot be withdrawn alone; closing the account is the way | `consentStates`, `/api/privacy` |
| Access to a summary of data | `Download my data` (JSON): profile, businesses, devices, security log, consents, requests | `personalDataExport`, `GET /api/privacy?export=1` |
| Correction and erasure | Requests with a 30 day due date (`privacy_request`); self-service account closing keeps the audit trail but removes phone, email and name (`close_account`) | `/app/privacy`, `/app/security` |
| Grievance redressal | A `grievance` request kind, plus the grievance officer's address on the notice (`PRIVACY_EMAIL`, a placeholder until the owner sets it) | `apps/web/lib/contact.ts` |
| Nominate another person | A `nomination` request kind | `/app/privacy` |
| Purpose limitation and retention | `prune_operational_data()` removes finished jobs, old events, expired codes and sessions. Tax records are kept as law requires and say so in the notice | `0170_retention_prune.sql` |
| Security safeguards | Row level security on tenant tables, hashed codes, encrypted authenticator secrets, encrypted backups | see `docs/architecture.md` |
| Breach register | `data_breach` table (no application grant); the admin panel is the only way in | `0190_dpdp.sql` |
| Children | Notice says Kora is for businesses and not for under 18s | privacy notice |

## Not done, and why

- **Notifying the Board and the people affected** is a human process. The register records when each was done; sending is manual.
- **Consent for messages a business sends to its own customers** is the business's duty. Kora sends only what the business asks it to and records the delivery.
- **Processor contracts** with hosting, SMS, WhatsApp, e-mail, payment and GST partners must be signed by the owner.
- **Cross-border transfer:** the database region is unconfirmed (see the audit, D-4). State it in the notice once chosen.
- **Consent managers** and any significant data fiduciary duties depend on notifications under the Act. Check them before launch.
- **Operator work:** the grievance officer name and address, a lawyer's review of the notice, and answering requests within the due date. The admin panel lists open requests by due date.
