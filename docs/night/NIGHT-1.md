# Night 1: the documents themselves

Branch `night-1`, worktree `../kora-night-1`, migrations 0110-0119.

## Tasks
- [x] 1. Research Zoho Invoice and two others, write the documents gap list
- [ ] 2. Quotation flow end to end
- [ ] 3. Proforma, sales order, delivery challan as first-class types
- [ ] 4. Credit and debit note guided flow
- [ ] 5. Recurring invoices screen
- [ ] 6. Ten invoice looks, gallery live preview, brand settings
- [ ] 7. Custom fields on documents and customers
- [ ] 8. Multi-currency documents
- [ ] 9. Discounts, shipping, adjustments, round-off, HSN/SAC picker
- [ ] 10. PDF fidelity pass
- [ ] 11. Keyboard-first editor
- [ ] 12. Polish at 375px and dark mode

## Log
- 2026-10-22 setup done: worktree created, deps installed, .env copied.

## Task 1: research notes and documents gap list (2026-10-22)

Sources read with /browse: Zoho Invoice feature page, Refrens home page, Vyapar footer/format list. Invoice Ninja was blocked by a bot check, so it was skipped.
Only ideas about which features exist were taken. Nothing copied.

What the three offer on documents (my words):
- Zoho: quotes with expiry, customer approval with comments in a portal, quote history, convert to invoice, custom fields, scheduled send, recurring invoices, 10+ languages, templates per contact, item-table styling, address format, templates gallery, payment receipts as templates.
- Refrens: separate makers for invoice, quotation, purchase order, GST invoice, delivery challan, proforma; templates; e-invoice and e-way bill.
- Vyapar: formats for invoice, quotation, estimate, credit note, debit note, delivery challan, work order, receipt, sales order style flows; thermal printer.

Kora already has: tax invoice, bill of supply, estimate, proforma, challan, credit/debit note types; estimate accept/decline from staff or portal (no comment); convert estimate to draft invoice; duplicate; recurring profiles; 6 layouts, accent, 2 fonts, logo, footer, language (en/hi/mr/gu); line discount; free-form 5 extra details; multi-currency on estimate/proforma; PDF; share link.

Gaps (documents only), in the order I will close them:
1. Quote: no comment when answering; no public accept/decline page on the share link; no "answered by" record; no expiry reminder; no quote versions; convert lands on an edit screen rather than showing the new draft with a clear banner.
2. No sales order type; no numbering for it; conversions exist only estimate to invoice (need estimate, sales order, proforma, challan, invoice in a chain).
3. Credit/debit note copies every line; no guided picking of lines/quantities, reason, or "full vs partial".
4. Recurring: check for pause, skip, preview of next runs, auto-send option clarity.
5. Only 6 looks; no live preview in the gallery; no signature image; fonts limited to sans/serif.
6. Custom fields are per document only (max 5 free text); none defined per business, none on customers.
7. Tax invoices are rupee only, with no second-currency reference total.
8. No bill-level discount, shipping charge, adjustment line or round-off setting.
9. Editor: check keyboard flow, duplicate line, reorder, undo, visible autosave.

## Needs you
(nothing yet)
