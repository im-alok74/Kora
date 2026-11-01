# Kora marketing plan

Written 1 November 2026 from the repository, not from market research. Everything about the product comes from the code and docs at the commit this plan sits on. Every number about the market, conversion or cost is a **planning assumption**, marked as such, to be replaced by your own data in the first 60 days. Nothing here is a verified benchmark.

The goal you set: get people to start using Kora, and get enough of them to pay.

## 1. The honest starting point

What decides the plan is not "what channels exist" but what is true today.

| Fact | Where it comes from | What it means for marketing |
|---|---|---|
| Kora is in early access. Prices on the pricing page are placeholders | `apps/web/app/pricing/page.tsx`, launch checklist row 2 | Do not run paid ads or promise a price until the owner sets real ones |
| Background work (WhatsApp/SMS/email sends, reminders, e-invoice) only runs if the tick or worker is hosted | `docs/launch-checklist.md` row 1 | Never advertise "send on WhatsApp in one click" or "e-invoicing" as working until a live test passes |
| Live providers (SMS sign-in, WhatsApp, Razorpay, GST partner) have not been called live | audit D-16, D-17 | Same: sell only what a stranger can do today |
| 17 free tools run in the browser, no sign-up, nothing uploaded | `apps/web/lib/tools.ts` | This is the cheapest, most honest top of the funnel you have |
| The product is unusually strict on correctness: paise-exact totals, gapless numbers, sealed invoices, GSTR-1 equal to the sales ledger | `packages/tax`, landing "Built so the books add up" | This is the real difference. Competitors sell features; you can sell "your CA will not have to fix it" |
| The 22 September 2025 slab change (12% and 28% gone) is enforced by date | `docs/gst-audit.md` rate slabs row | A timely, checkable, useful story that most small tools get wrong |
| Free plan: 10 invoices/quotes a month, 1 person. Paid plans add messaging, reminders, recurring, more people | `packages/core/src/plans.ts` | You have a natural, honest upgrade moment |
| No product analytics exist and the privacy notice says there are no tracking or advertising cookies | grep of `apps/web`, `apps/web/app/privacy/page.tsx` | A Meta or Google ad pixel would make your own notice false. Use cookieless, first-party measurement (section 8) |

**Consequence:** the next 4 to 6 weeks are about getting people to a first issued invoice and learning why they stop, not about reach. Reach you buy before activation works is wasted.

## 2. Positioning

**One sentence.** Kora makes GST invoices that are right the first time, so you collect faster and your CA stops fixing them.

**Why that and not "all-in-one"?** Zoho, Vyapar, myBillBook, Refrens, Tally and others already sell breadth. A new entrant cannot win a feature list. What you can prove, and they rarely say, is correctness and trust:

- Tax split into CGST, SGST, IGST from the place of supply, in whole paise, so totals never drift.
- Numbers run in order with no gaps, per financial year.
- An issued invoice cannot be edited; mistakes are fixed with credit and debit notes. (Some owners dislike this at first. Frame it as "the version your CA and the department see is the version you sent".)
- GSTR-1 data and the GST summary tie to the sales register to the paisa.
- Old 12% and 28% rates are refused for supplies after 22 September 2025.
- "We never ask for your GST portal password." Kora prepares returns data; you and your CA file.

**Three proof points in every piece of content, rotated:** *right the first time*, *get paid faster* (UPI QR on every invoice, pay link, part payments), *ready for your CA*.

**Tone.** Plain Indian business English. Short sentences. Talk to the person doing the billing, not to "enterprises". Hindi versions of the best posts once the English ones prove out. No "revolutionise", no "AI-powered" unless it is true of the feature.

**What not to say** is in section 11.

## 3. Who to go after, in order

| Priority | Segment | Why | First channel |
|---|---|---|---|
| 1 | **Freelancers, consultants and small service businesses** (1 to 3 people, GST registered or about to be) | Low switching cost, bill every month, feel GST pain directly, fit the free plan and the Business upgrade (recurring, reminders) | Short video, SEO on free tools, LinkedIn/Instagram |
| 2 | **CAs and small CA firms** | A multiplier. One CA recommends a tool to 20 to 100 clients, and CAs are the people who punish wrong invoices. The Firm plan and "run with your CA" story exist already | LinkedIn, CA WhatsApp/Telegram groups, direct outreach, a partner offer |
| 3 | **Small shops** (barcode till, 80 mm receipts, stock) | Large market, but the till and printer experience must be proven first | Local, later; skip until Priority 1 converts |
| 4 | Lawyers | Niche features (matters, trust ledger) are strong, market is small | Referral only for now |

Do not market to all four at once. Each needs different words.

## 4. The funnel and how people actually get to "buy"

```
Seen a post / searched a GST question
        |
Free tool (no sign-up): GST calculator, invoice generator, GSTIN check ...
        |   "Save this and keep numbering right: continue in Kora"
Sign up (10 seconds, no card)
        |
FIRST ISSUED INVOICE  <- activation. Everything is judged by this.
        |
Customer pays through the UPI QR / pay link; owner sees it matched
        |
Hits a limit or wants something paid:
   11th document in a month | second person | send by WhatsApp/SMS/email | reminders | recurring
        |
Upgrade (Razorpay autopay) -> refer a customer or a CA
```

**Activation definition (use this exactly):** a new business issues its first invoice within 7 days of sign-up. Track it per source.

**Why free tools are the front door.** 17 pages that answer real searches ("GST calculator", "invoice generator", "GSTIN validator", "amount in words") are already built, static, fast and private. Each one should end with one honest line and button: "Want this saved, numbered and sent? Keep going in Kora." The tools were scoped to relate to Kora (commit `591794e`), which is what makes this converting traffic and not just visitors.

**Upgrade triggers are honest and already in the product:** the 11th document of the month, a second team member, or the first attempt to send/remind/recur. The message at the wall already says what to do. Marketing's job is to make the first 10 invoices good enough that the wall is welcome.

## 5. Growth loops (the part that makes it cheaper over time)

Ranked by leverage. Items marked **build** need a small product change, which I can do next.

1. **Every invoice is an ad.** A customer receives your invoice, with the UPI QR. On the free plan, a small footer "Made with Kora" linking to the free tools (**build**, removable on paid plans). This is the single best loop for a document product.
2. **Invoice to another business on Kora lands in their account** (already built: network invoices). Encourage: "Your customer is on Kora? It arrives ready to become a purchase bill."
3. **CA brings clients.** A CA invites clients into their firm view (built). Give CAs a simple referral code and a page `/for-cas` (**build**). One CA is worth 20 freelancers.
4. **Referral:** a credit for both sides, paid in extra free documents rather than cash (**build**, later). Do this after activation is healthy.
5. **Templates people share.** Invoice templates and the free document makers are shareable on their own (SEO plus word of mouth).

## 6. Channels and sequence

### Month 1: earn the right to spend
| Channel | What | Why now |
|---|---|---|
| **Search (free tools)** | Improve titles, FAQs and the "continue in Kora" step on the top 5 tools; add pages for the exact questions people type (GST on freelancers, invoice format for each profession, GST rate for common services) | Compounds, costs nothing, brings people already trying to do the job |
| **Short video** (Reels, Shorts, LinkedIn video) | 3 a week, 15 to 40 seconds, screen recordings of the real product with captions. See section 7 | Cheapest way to show "right the first time" |
| **LinkedIn** | 3 posts a week: carousels for CAs and founders, one personal "building Kora" post | CAs and consultants are here |
| **CA outreach** | Message 30 CAs a week with a useful offer, not a pitch: a free review of how their clients' invoices look in Kora | Highest value per hour |
| **Communities** | Answer real GST invoicing questions in CA/freelancer groups and forums with no link unless asked | Trust first |

### Month 2: widen what works
Pick the 2 channels with the best activation, double them. Start a short weekly email (only to people who ticked "product news"; that consent exists in the product), a YouTube series ("GST in 5 minutes"), and Hindi cuts of the best videos.

### Month 3: paid, only if the numbers allow
Start paid only when: activation within 7 days is at least your chosen floor (assumption: 30 percent), the first-invoice time is under 10 minutes, and live WhatsApp/e-invoice claims are true. Search ads on high-intent phrases first (invoice software, GST billing software), tiny budget, one landing page per segment. Measure cost per **activated** business, not per click.

**Skip for now:** influencer deals, big events, print, cold WhatsApp blasts (see section 11).

## 7. Content system

### Pillars
| Pillar | Example | Goal |
|---|---|---|
| **Fix it** (GST rules explained) | "12% and 28% are gone for supplies after 22 Sep 2025. What changed on your invoice" | Search, saves, credibility |
| **Show it** (product in seconds) | "A GST invoice in 30 seconds, with the QR" | Trial |
| **Save time / get paid** | "Stop chasing: reminders that go out on their own" (say this only once reminders are live) | Upgrade |
| **Trust** | "Why you cannot edit an issued invoice, and what to do instead" | Positioning |
| **Build in public** | "What we got wrong this week" | Memorability, early believers |

### Formats
- **Carousels** (LinkedIn, Instagram): 6 to 9 slides, 4:5 (1080x1350). One idea each. Slide 1 is the hook, the last is one action.
- **Short videos** (9:16, 1080x1920): real screen recording, burned-in captions, no voice needed (most are watched muted), 15 to 40 seconds, a hook in the first 2 seconds.
- **Long form** (YouTube, blog): the same topics, searchable, 4 to 8 minutes.

### Hook patterns that fit this product
- "Your invoice has a mistake your CA will find." (Fix it)
- "12% GST is gone. Check your old invoices." (Fix it)
- "Make a GST invoice with a UPI QR in 30 seconds." (Show it)
- "Why Kora will not let you edit a sent invoice." (Trust)
- "5 free tools every small business should bookmark." (Search)

### Weekly rhythm (solo-founder sized)
Mon carousel (Fix it) · Tue short video (Show it) · Wed LinkedIn text post (build in public) · Thu short video (Fix it) · Fri carousel (free tools or trust) · weekend: reply to every comment and message, 30 CA outreach messages. About 8 to 10 hours a week once assets exist.

The first batch of assets is in `marketing/carousels` and `marketing/videos`, with copy in `marketing/CAPTIONS.md`.

## 8. Measurement (and keeping the privacy notice true)

Your notice promises no advertising or tracking cookies, and the DPDP work added consent for product news. So:

- **Do not install Meta Pixel or Google Ads tags** without changing the notice and adding a consent banner. Prefer **cookieless first-party analytics** (self-hosted or a privacy-first tool) on the public site, and **server-side events** inside the app.
- Add `utm_source`, `utm_medium`, `utm_campaign` to every link you post. Store the first-touch source on the new business at sign-up (**build**, small).
- **Events to record** (in the app, no personal data in the event): `tool_used`, `signup_started`, `signup_done`, `first_invoice_issued`, `invoice_sent`, `payment_matched`, `limit_hit`, `upgrade_started`, `upgrade_done`, `cancelled`.

**One page of numbers, reviewed weekly:**

| Metric | Why | Planning assumption (replace with real) |
|---|---|---|
| Visitors to tools, by tool | Which pages earn traffic | none yet |
| Tool to sign-up rate | Does the CTA work | 1 to 3 percent |
| Sign-up to first invoice within 7 days (**activation**) | The number that matters | aim 30 percent first, then 40 |
| Median minutes from sign-up to first invoice | Onboarding quality | under 10 |
| Week-4 return (issued another invoice) | Real use | aim 35 percent of activated |
| Free to paid | Revenue | 3 to 5 percent of activated, in 60 days |
| Cost per activated business | Paid channel limit | set after month 3 |

**Worked example, labelled assumption:** if 4 percent of activated businesses pay Rs 499 a month, 100 paying businesses need about 2,500 activated, which at 30 percent activation is about 8,300 sign-ups. That is why the free tools and the invoice footer loop matter more than any one post.

## 9. Offer and pricing choices (owner decisions)

1. **Real prices.** The page shows Rs 0, Rs 499, Rs 1,999 as placeholders. Decide, then remove the "placeholder" banner.
2. **Founding offer** (suggestion, not built): the first N businesses keep an early price for as long as they stay. Creates urgency without discounts, and gives you a story. Needs a plan note or coupon; the admin panel can set a plan by hand today.
3. **Annual plan** with two months free is common and improves cash flow; not built.
4. **Free plan stays generous enough to love** (10 documents is the current decision). Watch whether people hit it in week 1; if so, the limit may be too low for the first invoices to feel good.

## 10. 30, 60, 90 days

**Days 1 to 30: make it ready, then show it**
- Owner: set real prices; switch on the worker or the 5-minute tick; run one real WhatsApp and one Rs 1 Razorpay test (launch checklist). Until then keep claims to what works.
- Me: carousels and videos (first batch done), the "continue in Kora" CTA on the tools, UTM capture, the five events, a `/for-cas` page, the "Made with Kora" footer.
- You: post 3 times a week; message 30 CAs a week; talk to the first 10 users on a call and write down every sticking point.

**Days 31 to 60: learn**
- Cut every channel that does not activate. Double two. Fix the biggest drop-off in onboarding. Ship the referral credit. Start the weekly email to opted-in people. Hindi cuts of the best 5 videos.

**Days 61 to 90: scale what is proven**
- If activation clears the floor, start search ads at a small daily cap. Launch the CA partner offer. Collect 5 real testimonials (with permission) and 2 short case stories. Only then think about events and influencers.

## 11. Rules for claims (keeps you out of trouble and keeps trust)

| Do not say | Say instead | Why |
|---|---|---|
| "Kora files your GST returns" | "Kora prepares your GSTR-1 data and GST summary. You and your CA file." | The product does not file, and the FAQ says so |
| "E-invoicing built in" / "register IRN in one click" | "Kora checks the details the portal needs." Only say more after a live test | No GST partner is connected yet |
| "Send on WhatsApp automatically" | Only after a live WhatsApp template test and the worker are running | Same |
| "Free forever" | "Start free: 10 invoices and quotes a month" | The limit is real |
| Any testimonial, customer count, savings figure, "trusted by" | Nothing, until you have real, permitted ones | Invented proof is deception and a legal risk |
| "Zoho/Vyapar/Tally is worse" | Compare only things you can show, never name-and-shame | Defamation and credibility |
| "Cheapest" | A price, with what is included | Prices are not final |

**Messaging law.** Product news by email only to people who ticked that consent. WhatsApp business messages only to people who opted in, with approved templates. No scraped lists, no cold WhatsApp or SMS blasts (DPDP Act duties, WhatsApp policy, and TRAI rules for commercial SMS). When in doubt, a lawyer reads it first.

## 12. What I can produce, what only you can do

| I produce (in this repository) | You do |
|---|---|
| This plan, carousels, captions, video scripts and captioned screen-recorded videos | Post them; reply to comments the same day |
| Product changes that feed marketing: tool CTAs, invoice footer, UTM capture, events, `/for-cas`, referral | Decide prices, offers and which segment to lead with |
| A weekly numbers page once events exist | Talk to users; run CA outreach; sign partner agreements |
| More carousels and videos on request, in Hindi too | Permission and quotes for any testimonial |

## 13. First decisions I need from you

1. Lead segment: freelancers and small services first (recommended), or CAs first?
2. Languages: English only to start, or English and Hindi from week 1?
3. Where will you post: which accounts exist (LinkedIn, Instagram, YouTube)? Handles for the end slides.
4. Is the worker or the 5-minute tick live yet? It decides whether "send and remind" videos can be published.
5. A founding-offer idea you like, if any.
