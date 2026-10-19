# Cost model (gate for plan pricing)

Status: **a model with blank inputs.** The three costs that scale with use are paid to others, and I have not seen a quote for any of them. The numbers in the worked example are **assumptions chosen to show the arithmetic, not prices**. Do not set a plan price from them.

## The three metered costs

| Cost | Paid to | Unit | Where to get the real figure | In Kora |
|---|---|---|---|---|
| E-invoice registration | GST partner (GSP) | per IRN generated | partner's rate card, after sandbox signup | counter on Settings; allowance per plan |
| WhatsApp message | WhatsApp provider (Meta pricing plus the provider's margin) | per template message, by category | provider's India rate card | `delivery` rows with `channel = 'whatsapp'` |
| Payment collection | Payment gateway | percent of amount, plus fixed fee on some methods | gateway pricing page; check UPI merchant discount rate status with NPCI | `payment` rows with `gateway` set; passed through, not in plan price |
| SMS | DLT-registered sender | per SMS | operator or aggregator rate card | `delivery` rows with `channel = 'sms'` |

Fixed costs per business are small (database rows, storage, PDF rendering CPU) and are ignored here.

## Formula

For one business in one month:

```
cost  =  e_invoices x gsp_fee
       + whatsapp_messages x wa_fee
       + sms_messages x sms_fee
       + email_messages x email_fee

margin = plan_price - cost            (payment fees are passed through, so they are not in cost)
break-even e-invoices = (plan_price - other_costs) / gsp_fee
```

Overage: charge `fee x (1 + markup)` per unit beyond the plan allowance, with the counter visible, so the bill is never a surprise.

## Worked example (assumptions, not quotes)

| Input | Assumed |
|---|---|
| Plan price (Business, excluding GST) | Rs 399 a month |
| GSP fee per e-invoice | Rs 1.00 |
| WhatsApp fee per message | Rs 0.50 |
| SMS fee per message | Rs 0.25 |
| E-invoices a month | 150 |
| WhatsApp messages a month (sends plus reminders) | 300 |

```
cost   = 150 x 1.00 + 300 x 0.50 = 150 + 150 = Rs 300
margin = 399 - 300 = Rs 99     (25%)
```

What this shows, whatever the real numbers turn out to be: **at Rs 399, the allowance matters more than the headline price.** A shop sending 150 e-invoices and 300 messages would consume most of the plan price in partner and WhatsApp fees under these assumptions. So the bundled allowance has to be set from the real rate cards, and the free plan, which includes no e-invoice and no WhatsApp automation, is what keeps acquisition cost low.

## Sensitivity to check once real rates exist

| If this changes | Effect |
|---|---|
| GSP fee doubles | break-even e-invoices a month halves |
| WhatsApp moves to per-message pricing for reminders | cap automatic reminders per invoice, or pass through |
| UPI merchant discount rates return for some merchants | payment fees are passed through, so the plan price is unaffected; the collection pitch may weaken |
| Partner minimum monthly commitment | a fixed cost per business becomes a fixed cost for the company; decide plan floors accordingly |

## To do before pricing is final

1. Get rate cards from at least two GST partners and one WhatsApp provider; record them here with the date.
2. Check the UPI merchant discount rate position directly with NPCI. The only source I saw was a trade headline on a competitor's site.
3. Re-run the worked example with real numbers, then set allowances so the Business plan's margin is positive at the 90th percentile of usage seen in the closed beta.
4. Decide whether e-invoice cost is bundled, pass-through, or both (bundled allowance, pass-through beyond it, as the bible proposes).
