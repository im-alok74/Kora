# GST test cases for the shared tax library

The library is pure: integer paise in, integer paise out, no clock, no I/O. Every case below becomes a unit test before anything else calls the library. Expected values were worked by hand from the rules stated here, so a failing test means either the code or this file is wrong, and a CA should settle which.

## Rules the library implements

1. **Line level.** `gross = round_half_up(quantity * rate)`; `taxable = gross - discount`. Discount may not exceed gross.
2. **Rounding.** Round half up on integer paise: `floor((n * 2 + d) / (2 * d))`. Never floating point. Quantity is a decimal with 3 places, handled as an integer count of thousandths.
3. **Intra-state (place of supply equals supplier state).** `cgst = sgst = round_half_up(taxable * rate_bp / 20000)`. CGST always equals SGST because the schema enforces it.
4. **Inter-state.** `igst = round_half_up(taxable * rate_bp / 10000)`. Note that `igst` can differ from `cgst + sgst` by 1 paise on the same line. That is accepted: the IRP validates each component against its own rate.
5. **Cess.** Ad valorem only in v1: `cess = round_half_up(taxable * cess_bp / 10000)`. Specific (per-unit) cess is out of scope and rejected with a clear error.
6. **Per-line rounding, then sum.** Document tax is the sum of line taxes, never recomputed from the document total. This matches the line-level validation on the IRP.
7. **Round-off.** `grand = taxable + tax + tcs`; `round_off = round_half_up(grand / 100) * 100 - grand`; always within +/- 50 paise. Under Rs 1 (100 paise) there is no round-off, so a small invoice is never rounded to zero (found by property test, see TC31).
8. **Place of supply.** Goods: ship-to state if given, otherwise bill-to state. Services: recipient's registered state, otherwise the address state. Supplier state comes from the business.
9. **Reverse charge.** Tax is computed and shown, but excluded from the amount due.
10. **TDS.** Does not change the invoice total. It is carried as `tds` and reduces what the customer will pay.
11. **TCS.** The user supplies the rate. The library computes `round_half_up((taxable + gst) * tcs_bp / 10000)`.

The rate list and the HSN-length rule (4 digits under Rs 5 crore, 6 digits above) are not set in code from memory. They come from config that a practising CA signs off.

## Cases

Amounts are in paise. `T` taxable, `C` cgst, `S` sgst, `I` igst, `X` cess, `G` grand total after round-off.

| ID | Scenario | Input | Expected |
|---|---|---|---|
| TC01 | Intra-state, one line | 1 x 100000 @18%, supplier MH, buyer MH | T 100000, C 9000, S 9000, I 0, G 118000 |
| TC02 | Inter-state, same line | buyer KA | T 100000, C 0, S 0, I 18000, G 118000 |
| TC03 | Mixed rates, intra | A 50000 @5%; B 200000 @12%; C 75000 @18% | C 1250 / 12000 / 6750 (sum 20000); S same; T 325000; G 365000 |
| TC04 | Mixed rates, inter | same lines | I 2500 / 24000 / 13500 (sum 40000); G 365000 |
| TC05 | Discount before tax | qty 3 x 33333, discount 10000 @18% intra | gross 99999, T 89999, C 8100, S 8100, total 106199, round-off +1, G 106200 |
| TC06 | Half-paise rounds up | T 50 @18% intra | C 5 (4.5 rounds up), S 5; inter I 9; G for intra: 60, no round-off because it is under Rs 1 |
| TC07 | Cess | 100000 @28% + 12% cess, intra | C 14000, S 14000, X 12000, G 140000 |
| TC08 | Cess, inter | same | I 28000, X 12000, G 140000 |
| TC09 | Per-line rounding differs from per-document | 3 lines of 33333 @5%, intra | each line C 833, S 833; C 2499, S 2499, T 99999, total 104997, round-off +3, G 105000. Document-level rounding would give C 2500, so this test pins the policy |
| TC10 | Place of supply, goods | supplier MH, bill-to KA, ship-to MH | intra-state (CGST+SGST) |
| TC11 | Place of supply, goods reverse | supplier MH, bill-to MH, ship-to KA | inter-state (IGST) |
| TC12 | Place of supply, services | supplier MH, recipient registered in KA | IGST |
| TC13 | Reverse charge | 100000 @18% inter, reverse charge on | I 18000 shown, amount due 100000 |
| TC14 | Exempt supply | 100000 @0%, all lines exempt | library recommends bill of supply; tax 0; G 100000 |
| TC15 | Mixed exempt and taxable | line A 0%, line B 18% | stays a tax invoice; A shows 0 tax |
| TC16 | Composition dealer | registration composition | tax invoice refused, bill of supply with no tax columns |
| TC17 | Credit note, partial | original 118000 intra; credit T 50000 @18% | C 4500, S 4500, G 59000; settles 59000 of the original, 59000 remains |
| TC18 | Credit note cannot exceed original | credit > original taxable | rejected |
| TC19 | TDS | T 100000 @18%, TDS 10% of T | G 118000 unchanged; net expected receipt 108000 |
| TC20 | TCS | T 100000 @18% intra, TCS 10 bp on 118000 | tcs 118; total 118118; round-off -18; G 118100 |
| TC21 | Quantity of thousandths | qty 0.250 x 100000 | gross 25000 |
| TC22 | Large values | T 999999999999 @28% | no overflow in bigint; sums equal |
| TC23 | Zero or negative quantity | qty 0 or -1 | rejected |
| TC24 | Discount above gross | discount > gross | rejected |
| TC25 | Rate not in allowed list | 1700 bp | rejected |
| TC26 | GSTIN checksum | 27AAPFU0939F1ZV valid; last char changed invalid | validator agrees with `gstin_valid()` in the database for 1,000 random GSTINs |
| TC27 | GSTIN state vs address state | GSTIN prefix 27, state KA | rejected |
| TC28 | Invoice number length | prefix + number of 17 characters | rejected |
| TC29 | Specific cess | per-unit cess | rejected with message, not silently ignored |
| TC31 | Tiny invoice | 4.5 x 1 paisa @0%, TDS 10% | T 5, no round-off, G 5, TDS 1, net receivable 4 (never negative) |
| TC30 | HSN length rule | turnover over Rs 5 crore, 4-digit HSN | warning or reject per CA-approved config |

## Property tests (run on 10,000 generated invoices each)

- P1: `document.taxable = sum(line.taxable)` and the same for each tax component.
- P2: `CGST = SGST` on every line and document.
- P3: `|round_off| <= 50`.
- P4: no case yields a negative amount.
- P5: library output equals the e-invoice payload builder's totals. The payload builder reads the library, never recomputes.
- P6: library output equals the database's issue-time totals check (the document is accepted by `document_guard`).

## Open points for the CA review

- Which slabs to seed (the seed list in `schema.sql` is a starting point only).
- Exempt versus nil-rated versus non-GST supplies: all three print as bill of supply here; confirm.
- TCS applicability and rates.
- Export, SEZ and deemed export: deferred to v1.5, not modelled in these cases.
- B2C large-invoice threshold for GSTR-1 reporting.
