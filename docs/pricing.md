# Plans, limits and billing

The plans and their limits live in one place: `PLANS` in `packages/core/src/plans.ts`. The checks, the API rate limit, the Billing page and (through a test) the pricing page all follow it. Prices are placeholders until the owner decides.

| | Starter (free) | Business | Firm |
|---|---|---|---|
| Price a month | Rs 0 | Rs 499 | Rs 1,999 |
| Invoices, bills of supply, quotes, proformas, challans, orders issued a month | 10 | unlimited | unlimited |
| People in the business | 1 | 3 | 25 |
| API requests a minute for each key | 30 | 120 | 300 |
| Send by WhatsApp, SMS and email | no | yes | yes |
| Payment reminders | no | yes | yes |
| Recurring invoices | no | yes | yes |

Credit and debit notes are never limited: they correct an invoice and the law needs them. Everything on a free plan can still be viewed, exported and backed up, so nobody is locked out of their own records.

## Turning limits on

Limits apply only when `KORA_PLANS=enforce`. Until then every business behaves as before. Switch on only after Razorpay billing works end to end, otherwise a free business that hits a limit cannot upgrade. The launch checklist script warns when production has it off.

A paid plan that is not renewed keeps working for 7 grace days (`GRACE_DAYS`), then the business falls back to Starter. A cancelled plan stays to the end of the period already paid for.

## Razorpay billing

1. In the Razorpay dashboard make two monthly plans (Subscriptions, Plans) at the Business and Firm prices. Put their ids in `RAZORPAY_PLAN_BUSINESS` and `RAZORPAY_PLAN_FIRM`.
2. Set `BILLING_GATEWAY=razorpay`. The API keys are `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` unless `RAZORPAY_BILLING_KEY_ID` and `RAZORPAY_BILLING_KEY_SECRET` are set.
3. Add a webhook at `{APP_URL}/api/webhooks/billing` with its own secret in `RAZORPAY_BILLING_WEBHOOK_SECRET`, with these events ticked: `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`.
4. Test with a Rs 1 plan in Razorpay test mode first, then a real one.

How it works: the owner presses Choose on the Billing page; Kora creates the subscription at Razorpay and sends the owner to Razorpay's page to authorise autopay. The webhook (signature checked on the raw body, each event stored once) moves the business to the paid plan for the period Razorpay reports. A failed renewal marks it past due; the plan stays for the grace days. All state changes run through `billing_apply_event()` in the database, so a repeated event changes nothing.

## Not done

- **GST invoice for Kora's own fee.** Payments are recorded, but no tax invoice is produced for them. Kora must issue one to each paying business; decide whether to do it through Kora itself (a platform business with its own series) or from your accounts software. A CA should decide how GST applies to the subscription.
- **Changing plan** (Business to Firm) is by writing to us: cancel and buy again, or the admin panel sets it.
- **Yearly plans, coupons, trials** are not built. A trial can be given by the admin panel by setting a plan with status `trialing`.
