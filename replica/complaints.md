# Complaints and gaps, with evidence

Date: 18 Oct 2026. Read this first: **the review sample is far below the 100 reviews the method asks for.** I could not reach the main review sites, so most rows below are secondary summaries, not quotes. Nothing in this file is invented, and no counts are rounded up.

## What I could and could not reach

| Source | Result |
|---|---|
| G2 (product and individual review pages) | HTTP 403 to automated access. Not bypassed. |
| Capterra | HTTP 403 ("Sorry, you have been blocked"). Not bypassed. |
| Google Play, Zoho Invoice listing | Read. 4.7 stars, 32.6K reviews. Page showed 3 review texts, 1 critical. |
| Google Play, MyBillBook | The package id I tried returned 404. Not read. |
| Reddit | Search page failed to load; a web search for Zoho Invoice India threads returned none. Zero Reddit evidence. |
| Search-engine summaries of G2, Capterra, Techjockey, Merchant Maverick | Read. These are paraphrases written by a summariser, not verbatim reviews. |

Rule from the skill: a quote must be verbatim and linked. Only C06 meets that. The other rows are labelled **summary** and should be re-checked against the live page by a person with a normal browser. If you export or paste reviews from G2, Capterra and Play into `replica/reviews.csv` (columns source,url,date,rating,text), `reviews.py` can rank them properly.

## Evidence table

Count = number of distinct reviews I could point to. "Summary" means counted from an aggregated line, so the true number is unknown but at least 1.

| ID | Product | Complaint | Type | Count | Link | Kora fix |
|---|---|---|---|---|---|---|
| C01 | Zoho Invoice | Template customisation is limited, languages awkward | summary of G2 reviewers | at least 1 (G2 cites several) | https://www.g2.com/products/zoho-invoice/reviews | Real template editor with brand blocks and locked statutory fields (bible row 4) |
| C02 | Zoho Invoice | Cannot change currency while generating an invoice | summary of G2 reviewers; **contested** by third-party listings that praise multi-currency | at least 1 | https://www.g2.com/products/zoho-invoice/reviews | Per-document currency in v1.5. Verify the claim first |
| C03 | Zoho Invoice | Mobile app lags | summary of G2 | at least 1 | https://www.g2.com/products/zoho-invoice/reviews | Offline-first installable app; measure on cheap phones |
| C04 | Zoho Invoice | Billing issues, refund delays, poor search, weak support | summary of G2 | at least 1 | https://www.g2.com/products/zoho-invoice/reviews | Plain pricing; visible counters; in-app support in Hindi |
| C05 | Zoho Invoice | Free plan capped at 500 invoices a year, 2 users, 3 projects, and "Powered by" branding | **first-party fact**, not a review | n/a | https://www.zoho.com/in/invoice/pricing/ | No invoice cap on any Kora plan (bible rule) |
| C06 | Zoho Invoice | "Buggy and antiquated little invoicing app. Nothing is intuitive." Cannot edit a line item once added, and could not find how to issue a refund after searching "for 3 days" | **verbatim**, Play Store, 21 Aug 2026, 4 found helpful | 1 | https://play.google.com/store/apps/details?id=com.zoho.invoice&hl=en_IN&gl=IN (reviewer "Zackie D") | Inline line-item edit; refund path surfaced as a credit-note action on the invoice |
| C07 | Zoho Invoice | Free-plan client limit | summary of a TemperStack listing (a third party, not a reviewer) | 0 reviews | https://www.temperstack.com/software/zoho-invoice/ | Contradicts Zoho's own page (no client cap stated). Treat as unreliable |
| C08 | Zoho Invoice | Multi-currency "fairly basic", foreign payments settle in INR; bank reconciliation lives in Books | competitor-authored blog (ProfitBooks, discloses it sells an alternative) | 0 reviews | https://profitbooks.net/top-zoho-invoice-alternatives-in-india/ | Bias risk. Do not cite as customer voice |
| C09 | MyBillBook | Support could not resolve issues and offered temporary fixes; reviewer regrets purchase | summary of one Capterra review | 1 | https://www.capterra.in/reviews/202732/flobooks (the listing appears under an older product name) | Visible job status; escalate to a human for compliance errors |
| C10 | Gen GST | Cloud version depends on internet, delays at peak | summary of G2 | at least 1 | https://www.g2.com/products/gen-gst-software/reviews | Queue with per-invoice status; retry with backoff |
| C11 | Gen GST | Stops on GST portal technical issues; no automatic HSN lookup; slow | summary of Techjockey reviewers | 3 reviewers (one each) | https://www.techjockey.com/reviews/gen-gst-software | HSN suggestions (v3 AI); portal-down state shown plainly |
| C12 | Zoho Invoice | Inactive accounts: data deleted after 180 days, then 20 more | **first-party policy**, not a review | n/a | https://www.zoho.com/in/invoice/pricing/ | Kora must keep financial records for statutory periods; never auto-delete issued documents |

## Counts

- Verbatim, linked reviews: **1**
- Aggregated or summarised review claims: 7 rows (C01 to C04, C09, C10, C11)
- First-party facts about limits: 2 (C05, C12)
- Unreliable or biased sources noted: 2 (C07, C08)
- Reddit threads: **0**

## Bible claims I could not verify

| Bible gap | Status |
|---|---|
| Slow GST sync and laggy mobile app | "Laggy mobile" has a G2 summary (C03). "Slow GST sync" not found. |
| No offline option for patchy connectivity (rural G2 reviewer) | Not found. Gen GST's reviewers complain about internet dependence (C10), which is the same pain on a competitor. |
| MyBillBook settings reset after an update | Not found. |
| Few local payment options at Zoho | Weakened. Zoho lists UPI, net banking and several Indian gateways (see recon-zoho.md). |
| Email-only reminders at Zoho | Weakened. Zoho's page says WhatsApp sending is supported; reminders channel unclear. |
| E-invoicing missing | Only true for Zoho's free plan. Paid plans have it (https://www.zoho.com/in/invoice/help/e-invoicing/). |

## Merged gap table (bible gaps, updated)

| Gap | Strength after recon | Kora answer |
|---|---|---|
| Free-plan caps (500 invoices, 2 users, 3 projects, branding) | **Strong** (first-party) | No invoice cap; limits on businesses and seats |
| Template design limits | Medium (G2 summary) | Real template editor, locked statutory fields |
| E-invoice only on paid tiers | Medium; paid Zoho price unknown | Flat, visible price including e-invoice allowance |
| Currency per document | Contested | Verify in Zoho's demo before promising |
| Clunky line-item and refund flows | Weak (1 verbatim) | Inline edit; refund shown as an invoice action |
| Offline and flaky-network use | Medium (Gen GST complaints, no Zoho evidence) | Offline drafts with sync |
| UPI-first collection | **Weak as a gap** | Keep it, but call it parity. The differentiator is automatic reconciliation and per-event idempotent webhooks |
| WhatsApp-first sending and reminders | **Weak as a gap** | Differentiate on delivery status, templates and reminder rules, not on having WhatsApp |
| Regional languages | Hypothesis | Needs customer interviews |
