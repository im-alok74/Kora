# Recon summary

18 Oct 2026. Details in recon-zoho.md, recon-mybillbook.md, recon-sag.md, complaints.md, features.csv.

## Must match

- Full document set: tax invoice, bill of supply, estimate, proforma, delivery challan, credit and debit notes.
- GSTIN lookup that fills party details, HSN or SAC items, automatic CGST/SGST/IGST split, cess, reverse charge.
- Share by PDF, email, WhatsApp. Reminders by WhatsApp with a UPI link (MyBillBook already does this).
- UPI, cards and net banking through gateways (Zoho already lists several).
- GSTR-1 export and GSTR-3B summary. E-invoice with IRN and QR, and cancellation. Zoho's paid plans have all of this through its own GSP licence.
- Roles, templates with brand control, receivables ageing.

## Must beat

1. **The free-plan cap.** Zoho's own page says 500 invoices a year, 2 users, 3 projects, and its branding. No cap on invoices in Kora.
2. **Compliance behaviour, not compliance features.** Gapless numbering per series and year, immutable issued documents, rejections shown in plain words with a fix-and-resubmit screen, a visible "registering" state. I found no competitor evidence for any of these, so they are our bet, not a proven pain.
3. **Reconciliation.** Idempotent webhooks and automatic allocation so a paid invoice closes itself and reminders stop.
4. **Offline drafts.** Only a Gen GST complaint about internet dependence supports this. No Zoho evidence.
5. **Price clarity.** Flat plan price with visible counters for e-invoices, WhatsApp and gateway fees.

## Will deliberately skip

Inventory depth, POS, loyalty and marketing (MyBillBook's turf), income tax and TDS filing, payroll, ROC (SAG's turf), the Zoho marketplace and ecosystem, time and project billing until v3, direct GSP licence.

## Corrections to the bible you should decide on

1. **"Ship IRN on the first paid tier" is parity, not a gap.** Zoho Invoice has e-invoicing on Basic, Standard and Professional plans. Kora's edge has to be price and handling, not existence. I could not see Zoho's paid prices.
2. **UPI and WhatsApp are not gaps.** Zoho and MyBillBook both claim them. They are required, and the differentiator moves up a level (delivery status, reconciliation, reminder rules).
3. **Zoho can file GST returns from inside the product.** Kora's plan stops at GSTR-1 JSON. Decide whether that is acceptable for CA-led buyers.
4. **SAG price row looks mislabelled.** Rs 15,000 plus Rs 7,000 is Genius on SAG's home page, not the All-In-One GST product. No Gen GST price was visible.
5. **MyBillBook pricing is unconfirmed.** Its pricing page would not render for me.
6. **Review evidence is thin.** One verbatim review, seven summary claims, zero Reddit. G2 and Capterra block automated access.

## What I need from you

- **Reviews.** Easiest fix: open G2, Capterra and Play for Zoho Invoice, MyBillBook and Gen GST in your own browser and export or paste 1 to 3 star reviews into `replica/reviews.csv`. I will then run the ranker. Or tell me to proceed to Phase 2 with the thin sample and mark the gaps as unproven.
- **Zoho's paid price and MyBillBook's price** from the live pages.
- **Buyer order** (freelancer, shop, or CA-led business). MyBillBook owns shops. SAG owns CAs. Zoho owns freelancers.

Waiting for your go-ahead before Phase 2.
