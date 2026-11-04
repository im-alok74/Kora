# Kora marketing plan (draft for the owner, 1 November 2026)

Goal: get small businesses to issue their first invoice on Kora within minutes, collect a first payment through it, and pay for the Business plan; get CA firms to bring their clients with them.

## 0. Do not start paid or public marketing before these are true

Marketing sends strangers to the site. Today these would embarrass us:

| Gate | Why | State |
|---|---|---|
| Sign-in works on the live site | Production `DATABASE_URL` points at a host Vercel cannot reach | broken |
| Real sign-in codes (MSG91 / Resend) | Staging switches are still on, health check says 503 | not done |
| Razorpay billing, Rs 1 test | Nobody can pay otherwise | not done |
| Own domain and support e-mail | Legal pages still say placeholder | not done |
| Real WhatsApp sending | The sample video shows "Sent by WhatsApp" from the local mock messenger; do not publish it as live until a WhatsApp provider is connected | not done |
| Prices decided | Rs 499 and Rs 1,999 are placeholders in `docs/pricing.md` | owner decision |

Until then: build the content, collect a waiting list, show the product to 10 to 20 friendly businesses and CAs.

## 1. What we may and may not say

Say: invoices with correct GST, gapless numbering, WhatsApp sending, UPI QR and payment links, reminders, receivables ageing, GSTR-1 data export, import from Tally and Excel, works as an installable app, built to be run with your CA, Hindi, Marathi and Gujarati documents.

Do not say (not built or not live): "files your returns", live e-invoice or e-way bill registration (runs against a mock partner until a GST partner is connected), export invoices under LUT, "used by thousands", any testimonial or number we do not have, any price until the owner confirms it.

## 2. Who, and the one-line promise

| Audience | Pain | Promise | Plan |
|---|---|---|---|
| Shop, trader, small service business | Chasing money, WhatsApp photos of bills, CA asks for data every month | "Send the invoice on WhatsApp. Get paid by UPI. Your CA gets clean GST data." | Starter free, then Business |
| Freelancer, consultant | Late payments, no proper GST invoice | "Look professional, get paid on time." | Starter, then Business |
| CA firm | 30 to 100 clients sending photos and Excel files | "One screen for every client: what is overdue, what is due, what they sent." | Firm |

The CA is the growth engine. One CA brings 30 to 100 businesses and tells each what to use. Every client the CA puts on the free plan is a future Business subscriber.

## 3. How to make people use it (activation)

1. First invoice in under 3 minutes: sample data button, GSTIN lookup, items remembered. Measure it, make it faster.
2. First payment collected: every invoice carries a UPI QR and pay link. The customer who pays sees Kora.
3. Bring their old data: Tally and Excel import so nobody starts from empty.
4. Free tools as the front door (16 tools on `/tools`: GST calculator, GSTIN validator, invoice, quotation, receipt, QR). Each ends with "make this a real invoice on Kora".
5. A reminder to the owner on day 1, 3 and 7 by WhatsApp or e-mail (needs live messaging).

## 4. How they pay (conversion)

The free plan gives 10 documents a month and no messaging, reminders or recurring. The moments to ask for money are the ones where the feature pays for itself:
- An invoice goes overdue: "Send a reminder on WhatsApp" is locked on Starter.
- The 8th to 10th invoice of the month.
- A repeat customer: "Make this recurring".
Message at those moments: "This reminder usually gets the money in. Business plan, one price a month."

CA path: free for the first clients, Firm plan when they link more than a few.

## 5. Channels, in order of effort versus payoff

1. **CA partner outreach** (highest payoff): local CA associations, CA Instagram and YouTube, a one-page "bring your clients" kit, a referral reward the owner approves.
2. **Short video** (YouTube Shorts, Instagram Reels, WhatsApp Status): screen recordings of the real app, Hinglish, captions on.
3. **Carousels** (Instagram, LinkedIn): GST tips and "how to" for owners and CAs.
4. **Search**: the tools pages, plus guides ("how to make a GST invoice", "bill of supply vs tax invoice").
5. **Referral inside the product**: invoice footer, the Kora network invite, "give a month, get a month".
6. **Paid ads** only after activation and payment work and there is a measured cost per paying user.

## 6. Content pillars

1. Get paid faster (UPI QR, reminders, ageing).
2. GST made simple (rates, credit notes, bill of supply, due dates).
3. Your CA will like this (clean data, GSTR-1 export, client screen).
4. Mistakes that cost money (wrong GSTIN, missing HSN, numbering gaps).
5. Real app demos (30 seconds, one feature each).

## 7. First four weeks

| Week | Videos (15 to 30 s) | Carousels (7 slides) |
|---|---|---|
| 1 | 1. Invoice on WhatsApp in 60 seconds. 2. UPI QR on every invoice. | 1. 5 things every GST invoice must have. |
| 2 | 3. Overdue? One-tap reminder. 4. Import your Tally customers. | 2. Tax invoice vs bill of supply vs credit note. |
| 3 | 5. For CAs: every client on one screen. 6. Recurring invoices. | 3. What your CA wishes you sent every month. |
| 4 | 7. Hindi invoice for the shop. 8. Customer pays from the link. | 4. 4 ways late payments eat your profit. |

Each post ends with one action: try it free, or (for CAs) bring a client.

## 8. What to measure

| Step | Number | Target |
|---|---|---|
| Visit to sign-up | rate | set after two weeks of data |
| Sign-up to first invoice issued within 24 hours | activation | the number to push up first |
| First invoice to first payment through Kora | value moment | |
| Free to paid within 30 days | conversion | |
| Paid after 3 months | retention | |
| CA: clients linked per firm | engine | |

Do not set targets before there is a baseline.

## 9. What I can produce next

- Carousels as 1080 x 1350 images made from the real brand (HTML rendered to PNG), with the copy in your language.
- Videos made from screen recordings of the real app (not mock-ups), captions in Hinglish, 9:16, plus a voice-over if you want one.
- A one-page CA kit, a WhatsApp message to send to existing contacts, and a landing page for CAs.

Needed from the owner: language and tone, first audience, price to show (or "free to start"), brand name for social handles, whether your face or a voice-over appears.
