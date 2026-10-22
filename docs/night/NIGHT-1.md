# Night 1: the documents themselves

Branch `night-1`, worktree `../kora-night-1`, migrations 0110-0119.

## Tasks
- [x] 1. Research Zoho Invoice and two others, write the documents gap list
- [x] 2. Quotation flow end to end
- [x] 3. Proforma, sales order, delivery challan as first-class types
- [x] 4. Credit and debit note guided flow
- [x] 5. Recurring invoices screen
- [x] 6. Ten invoice looks, gallery live preview, brand settings
- [x] 7. Custom fields on documents and customers
- [x] 8. Multi-currency documents
- [x] 9. Discounts, shipping, adjustments, round-off, HSN/SAC picker
- [x] 10. PDF fidelity pass
- [x] 11. Keyboard-first editor
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

- Task 2 done: customer answers from the shared link (name, comment, accept or decline), staff can record an answer with a comment, quote versions (revise, old version withdrawn on issue), valid-until defaults to 30 days, convert lands on the new draft. Migration 0110.
- Task 3 done: sales_order is a document type with its own SO series; estimate, sales order, proforma and challan convert forward into each other and into an invoice (one draft each, never doubled). 0110 widens two type CHECK constraints (dropped and re-added with the extra value; no data touched). Small edit outside my area: packages/tax DocType gets 'sales_order'.
- Task 4 done: guided credit and debit note page (kind, reason, pick lines, quantity and rate), reason printed on the note. Migration 0111.
- Task 5 done: schedule panel with next six dates and amounts, skip next, pause, mode help text, date preview in the form. Migration 0112 (adds a skipped run status).
- Task 6 done (code): six new looks (bold, elegant, ledger, corporate, soft, two-tone; 11 selectable plus thermal), four fonts, logo size, signature image. Checked each new look by eye at A4 width.
- Decision: task 9 discount on the whole bill and a shipping line already exist in the editor; remaining for 9 is the settings for round-off, adjustment line and the HSN/SAC search.
- Lesson: never run a migration against the e2e database while its server is up (cached prepared statements break). Wait for the e2e run to end.

- Task 7 done: per-business custom fields for documents and customers (migration 0113), answers copied onto documents (kept with their label, so renames never change an issued document), printed on the PDF when set to print. Small edits outside my area: settings page and customers page each got one component.
- Task 8 done: a rupee document can show a reference total in another currency (0114); foreign quotes print the rupee equivalent; the editor shows both. Tax stays in rupees by design (GST).
- Task 9 done: adjustment line (not taxed, limited to Rs 10,000) and a round-to-the-rupee choice per document (0115 replaces the one total CHECK with the same check plus the adjustment; tax package gets an optional adjustment). HSN and SAC search list in the editor (about 100 common codes, tax rate suggested only for common services).
- Task 11 done: Enter moves down a line and adds one at the end, Ctrl+D copies, Alt+Up or Down moves, Ctrl+Z and Ctrl+Y undo and redo, drag to reorder, autosave 2.5 s after the last change with a visible status.
- e2e: 33 of 34 specs I ran pass. The failing one is first-invoice.spec.ts "home page explains the product" (cannot find a "Sign in to Kora" link on the landing page). The landing page is work in progress from before tonight and is not mine; not touched.
- Lesson: keep the tree still while the e2e build runs, and never leave a stale lock: the lock dir was hours old after a restart, so I removed it after checking nothing listened on 3200 to 3202.

- Task 10 done: rendered every look at A4 with 3 and 70 lines, the thermal roll, and Hindi, Marathi and Gujarati, and looked at the pages. Fixed: a 3-line invoice spilled onto a second page in every look (screen padding doubled the print margin; payment blocks stacked), and the elegant look still spilled its footer line. Now 1 page each; 70 lines make 5 pages with the heading repeated and the totals on the last page. Hindi and Gujarati glyphs render. The amount in words stays in English on every language, as before. Script: packages/pdf/scripts/fidelity.ts.

## Needs you
(nothing yet)
