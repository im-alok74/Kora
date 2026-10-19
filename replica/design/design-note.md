# Kora design note

Premium, calm and professional, for a CA's eye. Documents are the product, so the interface steps back and lets the invoice be the most considered thing on the screen.

## Choices and the reason for each

- **Warm off-white (`#fbfaf7`) instead of pure white.** Reduces glare on long sessions at a counter or desk and reads as paper. Text on it measures 15.96:1.
- **Deep green accent (`#0b5d4f`).** A green accent sets Kora apart from the blue-led palettes I remember on competitor sites (unchecked), and green carries "settled" without needing a second status colour. White on it measures 7.80:1.
- **Muted gold (`#8a6212`) used rarely.** Only for premium marks and small ornaments. It passes AA (5.24:1) but is not for body text.
- **Serif display, sans body.** The invoice number and totals set in a serif feel like a printed ledger. Fraunces and Source Serif 4 are open licence; Inter and Noto Sans Devanagari cover English and Hindi without a licence fee. JetBrains Mono for GSTIN and IRN strings so characters are unambiguous.
- **Tabular figures for all money.** Columns of rupees must line up.
- **Icons: Lucide (ISC).** No vendor icons.
- **Radius 4/8/12, near-flat shadows.** Precise, not playful.
- **Border for inputs is `#7a766c`** because WCAG wants 3:1 for input boundaries; it measures 4.34:1 on the page background.

## Contrast result

`python .claude/skills/replica-design/contrast.py replica/design/tokens.json`: 21 pairs, 0 failing AA, exit code 0. The first run passed, so no fixes were needed. Re-run after any colour change.

## What is deliberately not specified yet

Component specs (`components.md`), the Tailwind mapping and `tokens.css` come at the start of Phase 3 step 3, when the first screens are built. Reference screenshots of competitors were not taken, so nothing here is derived from their pixels.

## Template editor rule

Users can change logo, colours, font choice, layout blocks, and the order of optional sections. They cannot move, hide or rename statutory fields: supplier and recipient GSTIN, invoice number and date, HSN or SAC, place of supply, tax breakup, IRN and QR, reverse-charge statement, signature. The editor shows them locked.
