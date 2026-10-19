# Kora brand

The name is Kora and it is final. Trademark and domain checks have not been done and need a person (see the end).

## Voice

Calm, exact, and a little formal, like a good CA's note to a client. Short sentences. Rupees and dates in Indian format. States what happened and what to do next. No exclamation marks, no emoji in product text, no "oops". Hindi and other Indian languages are v3, but write English so it translates cleanly: no idioms.

| Instead of | Write |
|---|---|
| Oops! Something went wrong | The invoice could not be registered. The GSTIN on line 2 is not valid. Fix it and try again. |
| Congrats, you're all set! | Invoice INV/0042 is issued. |
| Awesome! Payment received | Rs 11,800 received from Sharma Traders. Invoice INV/0042 is paid. |
| Unlock premium features | Included in Business: e-invoice, WhatsApp reminders. |
| Hang tight, we're registering your invoice | Registering with the GST portal. This invoice is not legally complete until the IRN arrives. |

Rules: name the document and the number; show the money; say who is responsible. Never imply Kora files returns for the owner. The owner stays responsible, and the product says so where filings are mentioned.

## Look

Calm and premium. Warm off-white paper background, deep green accent, a muted gold used rarely, ink-dark text. A serif for display headings (numbers and the wordmark), a clean sans for everything else, tabular figures for all money. Generous space, thin rules, almost no shadow. Tokens are in `design/tokens.json`.

## Logo brief

A wordmark first. Lowercase or small-caps "kora" in a refined serif, set tight. An optional mark: a simple closed form that reads as a ledger line or a stamped seal, one colour, no gradient. It must work at 16 px (favicon, WhatsApp avatar) and as a single-colour stamp on a PDF. No rupee symbol, no tick mark, no document-with-folded-corner, no speech bubble. Commission a designer; do not generate it from a competitor's mark. Deliver SVG, one-colour and reversed versions, and clear-space rules.

## Names and colours to keep out of the codebase

The sweep tool (`replica-brand/sweep.py`) should be configured with these. Colours are listed because trade dress is the combination of name, layout and colour, and Kora should look nothing like these.

| Competitor | Words and domains to ban | Colours to avoid copying |
|---|---|---|
| Zoho Invoice | Zoho, Zia, zohoinvoice, "Powered by Zoho", Zoho Books, Zoho Billing, zoho.com | red-led palette and four-colour logo (from memory, unverified) |
| MyBillBook | myBillBook, MyBillBook, Hissab Kitaab, mybillbook.in, FloBooks (earlier product name) | blue and orange pairing (from memory, unverified) |
| SAG Infotech | SAG, SAG Infotech, Gen GST, Genius, GenCodex, EazeMax, saginfotech | corporate blue and orange (from memory, unverified) |
| Others seen in the recon | Vyapar, Tally, QuickBooks, Refrens, ProfitBooks, Skydo | n/a |

Also ban: their template names, their help-centre sentences, their testimonials, their icons and any screenshot. Statutory terms (GST, GSTIN, IRN, HSN, e-way bill) are public and allowed.

The colour column is from memory and I did not check it against their sites; I did not look up hex values either. If the sweep needs hex values, someone should read them from the live brand pages.

## Checks that need a person

1. Trademark search for "Kora" in India, Classes 9, 36 and 42 (software, financial services, SaaS), plus common-law use. Other businesses use the word; this is a real risk.
2. Domain: kora.in, kora.app, getkora.in, usekora.com availability.
3. Play Store and App Store name availability, plus handles on WhatsApp Business, Instagram and X.
4. Company name and GST legal entity for invoices Kora itself issues.
