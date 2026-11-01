import type Icon from '../components/Icon';

// The free tools. Each runs in the browser: nothing typed into them is sent to Kora.
// Only tools that help with invoicing, GST, pricing, shop counters and getting paid belong here. Generic file converters and
// text tools were removed on purpose (see REMOVED_TOOLS); their web addresses redirect to /tools.
export type Tool = { slug: string; title: string; summary: string; group: 'Documents' | 'GST and pricing' | 'QR, barcodes and logo' };

export const TOOLS: Tool[] = [
  { slug: 'gst-calculator', title: 'GST Calculator', summary: 'Add or remove GST from an amount, with the CGST, SGST and IGST split.', group: 'GST and pricing' },
  { slug: 'invoice-generator', title: 'Invoice Generator', summary: 'Make a GST tax invoice in minutes and print it or save it as a PDF.', group: 'Documents' },
  { slug: 'quotation-maker', title: 'Quotation Maker', summary: 'Send a clear quote with tax worked out and a valid-until date.', group: 'Documents' },
  { slug: 'proforma-invoice-generator', title: 'Proforma Invoice Generator', summary: 'An advance invoice that a customer can pay against before you deliver.', group: 'Documents' },
  { slug: 'purchase-order-generator', title: 'Purchase Order Generator', summary: 'Order goods or services from a supplier with a proper purchase order.', group: 'Documents' },
  { slug: 'receipt-maker', title: 'Receipt Maker', summary: 'Give a payment receipt that shows what was paid, how and for what.', group: 'Documents' },
  { slug: 'qr-code-generator', title: 'QR Code Generator', summary: 'Make a QR code for a link, text, a phone number or a UPI payment.', group: 'QR, barcodes and logo' },
  { slug: 'barcode-generator', title: 'Online Barcode Generator', summary: 'Make a Code 128 barcode for a product or an item code, as an image.', group: 'QR, barcodes and logo' },
  { slug: 'qr-code-scanner', title: 'QR Code Scanner from Image', summary: 'Read a QR code from a photo or a screenshot.', group: 'QR, barcodes and logo' },
  { slug: 'barcode-scanner', title: 'Online Barcode Scanner', summary: 'Read a barcode from a photo, or live with your camera.', group: 'QR, barcodes and logo' },
  { slug: 'logo-maker', title: 'Logo Maker', summary: 'Make a simple logo with your initials or name and download it.', group: 'QR, barcodes and logo' },
  { slug: 'profit-margin-calculator', title: 'Profit Margin and Markup Calculator', summary: 'Work out profit, margin and markup, or the price that gives the margin you want.', group: 'GST and pricing' },
  { slug: 'emi-calculator', title: 'Business Loan EMI Calculator', summary: 'Find the monthly instalment, total interest and first months of a business loan or equipment loan.', group: 'GST and pricing' },
  { slug: 'interest-calculator', title: 'Simple and Compound Interest Calculator', summary: 'Work out interest on an overdue invoice, a business loan or a deposit, simple or compound.', group: 'GST and pricing' },
  { slug: 'gstin-validator', title: 'GSTIN Validator', summary: 'Check a GSTIN and read its state, PAN and registration number. Paste a list to check many.', group: 'GST and pricing' },
  { slug: 'amount-in-words', title: 'Amount in Words', summary: 'Write a rupee amount in words, in English and Hindi, with lakh and crore.', group: 'GST and pricing' },
];


/** Bump when a tool's behaviour or copy changes; the sitemap reports it as the last change. */
export const TOOLS_UPDATED = '2026-10-26';

export const TOOL_GROUPS: Tool['group'][] = ['Documents', 'GST and pricing', 'QR, barcodes and logo'];

/** Tools that were removed because they have nothing to do with invoicing, GST or getting paid. Their addresses redirect to /tools (see next.config.mjs). */
export const REMOVED_TOOLS = ['pdf-to-image', 'image-converter', 'image-compressor', 'images-to-pdf', 'merge-split-pdf', 'word-counter'] as const;
export const toolBySlug = (s: string) => TOOLS.find((t) => t.slug === s);

type IconName = React.ComponentProps<typeof Icon>['name'];
const ICONS: Record<string, IconName> = {
  'gst-calculator': 'percent', 'invoice-generator': 'invoice', 'quotation-maker': 'documents', 'proforma-invoice-generator': 'documents',
  'purchase-order-generator': 'cart', 'receipt-maker': 'receipt', 'qr-code-generator': 'qr', 'barcode-generator': 'database',
  'qr-code-scanner': 'search', 'barcode-scanner': 'search', 'logo-maker': 'home',
  'profit-margin-calculator': 'chart', 'emi-calculator': 'rupee', 'interest-calculator': 'percent', 'gstin-validator': 'shield', 'amount-in-words': 'rupee',
};
export const toolIcon = (slug: string): IconName => ICONS[slug] ?? 'invoice';
