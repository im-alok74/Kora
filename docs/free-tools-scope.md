# Free tools: what is on the site and why

The public tools section (`/tools`) keeps only tools that a Kora customer, or someone who may become one, uses while invoicing,
taxing, pricing, shopping, collecting or reconciling. The list lives in one place, `apps/web/lib/tools.ts`; the hub, the header
menu, the footer strip, the sitemap, the static pages and the structured data all read it. `apps/web/test/toolScope.test.ts`
fails when a tool is added or removed without this file and that test being updated.

## Kept (16)

| Group | Tool | Why it stays |
|---|---|---|
| Documents | Invoice, Quotation, Proforma, Purchase Order, Receipt | The documents Kora itself makes, so each is a direct path into the product. |
| GST and pricing | GST Calculator | Core GST arithmetic, same rules as an invoice. |
| GST and pricing | GSTIN Validator | Checking a customer or supplier before billing. |
| GST and pricing | Amount in Words | Needed on invoices, receipts and cheques. |
| GST and pricing | Profit Margin and Markup | Pricing an item before quoting. |
| GST and pricing | Business Loan EMI Calculator | Reframed for business and equipment loans (cash flow, credit cost). |
| GST and pricing | Simple and Compound Interest | Reframed for late payment interest on overdue invoices (days, months or years). |
| QR, barcodes and logo | QR Code Generator, QR Code Scanner | UPI payment QR; reading a payment QR from a customer's screenshot. |
| QR, barcodes and logo | Barcode Generator, Barcode Scanner | Shop, stock and till use. |
| QR, barcodes and logo | Logo Maker | A logo for the invoice. Now also fits a logo you already have under Kora's 150 KB limit. |

## Dropped (6) and why

| Tool | Address now | Reason |
|---|---|---|
| PDF to Image | `/tools` (308) | Generic file conversion; nothing to do with invoicing. |
| Image Converter | `/tools` (308) | Generic file conversion. |
| Image Compressor and Resizer | `/tools` (308) | Generic editor. The one thing Kora needs from it, fitting a logo under 150 KB, moved into the Logo Maker (`LogoFit.tsx`). |
| Images to PDF | `/tools` (308) | Generic file conversion. |
| Merge and Split PDF | `/tools` (308) | Generic PDF editing. |
| Word Counter and Keyword Density | `/tools` (308) | Writing and SEO tool; no link to billing. |

The redirects are in `apps/web/next.config.mjs` (`permanent: true`, which Next.js sends as 308) because the pages may be indexed. They
also cover anything under the address, such as the share card. The code is not kept in the tree: git history is the archive
(the last commit that has these tools is `ea77209`). Dependencies that only they used (`pdfjs-dist`, `pdf-lib`, `fflate`) and the
worker were removed with them.

## Rules for any new tool

1. It must relate to invoicing, GST, billing, pricing, shops or getting paid.
2. It needs page copy of its own in `lib/toolPages*.ts` and an entry in `lib/toolKora.ts` (the "do this automatically in Kora" note that links to `/login?signup=1`).
3. GST facts: slabs 0, 5, 18 and 40 percent, special rates 3 percent (gold) and 0.25 percent (rough stones); 12 and 28 percent only for supplies before 22 September 2025.
4. No invented statistics, and no long dashes in project text.
