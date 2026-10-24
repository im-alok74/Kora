import type Icon from '../components/Icon';

// The free tools. Each runs in the browser: nothing typed into them is sent to Kora.
export type Tool = { slug: string; title: string; summary: string; group: 'Documents' | 'Calculators, codes and logos' | 'PDF and images' | 'Text and numbers' };

export const TOOLS: Tool[] = [
  { slug: 'gst-calculator', title: 'GST Calculator', summary: 'Add or remove GST from an amount, with the CGST, SGST and IGST split.', group: 'Calculators, codes and logos' },
  { slug: 'invoice-generator', title: 'Invoice Generator', summary: 'Make a GST tax invoice in minutes and print it or save it as a PDF.', group: 'Documents' },
  { slug: 'quotation-maker', title: 'Quotation Maker', summary: 'Send a clear quote with tax worked out and a valid-until date.', group: 'Documents' },
  { slug: 'proforma-invoice-generator', title: 'Proforma Invoice Generator', summary: 'An advance invoice that a customer can pay against before you deliver.', group: 'Documents' },
  { slug: 'purchase-order-generator', title: 'Purchase Order Generator', summary: 'Order goods or services from a supplier with a proper purchase order.', group: 'Documents' },
  { slug: 'receipt-maker', title: 'Receipt Maker', summary: 'Give a payment receipt that shows what was paid, how and for what.', group: 'Documents' },
  { slug: 'qr-code-generator', title: 'QR Code Generator', summary: 'Make a QR code for a link, text, a phone number or a UPI payment.', group: 'Calculators, codes and logos' },
  { slug: 'barcode-generator', title: 'Online Barcode Generator', summary: 'Make a Code 128 barcode for a product or an item code, as an image.', group: 'Calculators, codes and logos' },
  { slug: 'qr-code-scanner', title: 'QR Code Scanner from Image', summary: 'Read a QR code from a photo or a screenshot.', group: 'Calculators, codes and logos' },
  { slug: 'barcode-scanner', title: 'Online Barcode Scanner', summary: 'Read a barcode from a photo, or live with your camera.', group: 'Calculators, codes and logos' },
  { slug: 'logo-maker', title: 'Logo Maker', summary: 'Make a simple logo with your initials or name and download it.', group: 'Calculators, codes and logos' },
  { slug: 'pdf-to-image', title: 'PDF to Image Converter', summary: 'Turn every page of a PDF into a PNG or JPG picture. Download one, or all as a ZIP.', group: 'PDF and images' },
  { slug: 'image-converter', title: 'Image Converter', summary: 'Change JPG, PNG and WebP pictures from one to another, one at a time or in a batch.', group: 'PDF and images' },
  { slug: 'image-compressor', title: 'Image Compressor and Resizer', summary: 'Shrink a picture to a size in KB or to exact dimensions, and see before and after.', group: 'PDF and images' },
  { slug: 'images-to-pdf', title: 'Images to PDF', summary: 'Put JPG, PNG and WebP pictures into one PDF, in the order you choose.', group: 'PDF and images' },
  { slug: 'merge-split-pdf', title: 'Merge and Split PDF', summary: 'Join PDFs, pull pages out of one, split it into parts or rotate its pages.', group: 'PDF and images' },
  { slug: 'gstin-validator', title: 'GSTIN Validator', summary: 'Check a GSTIN and read its state, PAN and registration number. Paste a list to check many.', group: 'Text and numbers' },
  { slug: 'amount-in-words', title: 'Amount in Words', summary: 'Write a rupee amount in words, in English and Hindi, with lakh and crore.', group: 'Text and numbers' },
  { slug: 'word-counter', title: 'Word Counter and Keyword Density', summary: 'Count words and characters, estimate reading time and see your top keywords.', group: 'Text and numbers' },
];


/** Bump when a tool's behaviour or copy changes; the sitemap reports it as the last change. */
export const TOOLS_UPDATED = '2026-10-24';

export const TOOL_GROUPS: Tool['group'][] = ['Documents', 'PDF and images', 'Text and numbers', 'Calculators, codes and logos'];
export const toolBySlug = (s: string) => TOOLS.find((t) => t.slug === s);

type IconName = React.ComponentProps<typeof Icon>['name'];
const ICONS: Record<string, IconName> = {
  'gst-calculator': 'percent', 'invoice-generator': 'invoice', 'quotation-maker': 'documents', 'proforma-invoice-generator': 'documents',
  'purchase-order-generator': 'cart', 'receipt-maker': 'receipt', 'qr-code-generator': 'qr', 'barcode-generator': 'database',
  'qr-code-scanner': 'search', 'barcode-scanner': 'search', 'logo-maker': 'home',
  'pdf-to-image': 'documents', 'image-converter': 'repeat', 'image-compressor': 'box', 'images-to-pdf': 'invoice', 'merge-split-pdf': 'documents',
  'gstin-validator': 'shield', 'amount-in-words': 'rupee', 'word-counter': 'chat',
};
export const toolIcon = (slug: string): IconName => ICONS[slug] ?? 'invoice';
