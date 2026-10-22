import type Icon from '../components/Icon';

// The free tools. Each runs in the browser: nothing typed into them is sent to Kora.
export type Tool = { slug: string; title: string; summary: string; group: 'Documents' | 'Calculators' | 'Codes and logos' };

export const TOOLS: Tool[] = [
  { slug: 'gst-calculator', title: 'GST Calculator', summary: 'Add or remove GST from an amount, with the CGST, SGST and IGST split.', group: 'Calculators' },
  { slug: 'invoice-generator', title: 'Invoice Generator', summary: 'Make a GST tax invoice in minutes and print it or save it as a PDF.', group: 'Documents' },
  { slug: 'quotation-maker', title: 'Quotation Maker', summary: 'Send a clear quote with tax worked out and a valid-until date.', group: 'Documents' },
  { slug: 'proforma-invoice-generator', title: 'Proforma Invoice Generator', summary: 'An advance invoice that a customer can pay against before you deliver.', group: 'Documents' },
  { slug: 'purchase-order-generator', title: 'Purchase Order Generator', summary: 'Order goods or services from a supplier with a proper purchase order.', group: 'Documents' },
  { slug: 'receipt-maker', title: 'Receipt Maker', summary: 'Give a payment receipt that shows what was paid, how and for what.', group: 'Documents' },
  { slug: 'qr-code-generator', title: 'QR Code Generator', summary: 'Make a QR code for a link, text, a phone number or a UPI payment.', group: 'Codes and logos' },
  { slug: 'barcode-generator', title: 'Online Barcode Generator', summary: 'Make a Code 128 barcode for a product or an item code, as an image.', group: 'Codes and logos' },
  { slug: 'qr-code-scanner', title: 'QR Code Scanner from Image', summary: 'Read a QR code from a photo or a screenshot.', group: 'Codes and logos' },
  { slug: 'barcode-scanner', title: 'Online Barcode Scanner', summary: 'Read a barcode from a photo, or live with your camera.', group: 'Codes and logos' },
  { slug: 'logo-maker', title: 'Logo Maker', summary: 'Make a simple logo with your initials or name and download it.', group: 'Codes and logos' },
];

export const TOOL_GROUPS: Tool['group'][] = ['Documents', 'Calculators', 'Codes and logos'];
export const toolBySlug = (s: string) => TOOLS.find((t) => t.slug === s);

type IconName = React.ComponentProps<typeof Icon>['name'];
const ICONS: Record<string, IconName> = {
  'gst-calculator': 'percent', 'invoice-generator': 'invoice', 'quotation-maker': 'documents', 'proforma-invoice-generator': 'documents',
  'purchase-order-generator': 'cart', 'receipt-maker': 'receipt', 'qr-code-generator': 'qr', 'barcode-generator': 'database',
  'qr-code-scanner': 'search', 'barcode-scanner': 'search', 'logo-maker': 'home',
};
export const toolIcon = (slug: string): IconName => ICONS[slug] ?? 'invoice';
