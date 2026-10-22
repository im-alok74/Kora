import type { Tool } from './tools';

/** The words around each free tool: the headline, the explainer, steps and questions. Plain facts only, no made-up numbers. */
export type ToolPageInfo = {
  badge: string;
  highlight: string;
  lead: string;
  cta: string;
  toolTitle: string;
  toolAccent: string;
  stats: [string, string][];
  about?: { title: string; accent: string; body: string[] };
  steps: [string, string][];
  features: [string, string][];
  faq: [string, string][];
  crossTitle: string;
  crossText: string;
};

const FACTS: [string, string][] = [['100%', 'Free to use'], ['No signup', 'Start straight away'], ['On your device', 'Nothing is uploaded']];

export const GST_SLABS: [string, string, string, string][] = [
  ['0%', 'Nil', 'Basic food and a few essentials', 'mint'],
  ['5%', 'Everyday', 'Items most households buy often', 'sky'],
  ['18%', 'Standard', 'Most goods and most services', 'sun'],
  ['40%', 'Luxury and sin', 'Items such as luxury cars and tobacco', 'pink'],
];

const GST: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Add or remove GST in one step',
  lead: 'Type an amount, pick the rate and see the CGST, SGST and IGST split at once. Worked out in whole paise with the same rules a Kora invoice uses.',
  cta: 'Calculate GST now',
  toolTitle: 'Calculate GST',
  toolAccent: 'online',
  stats: FACTS,
  about: {
    title: 'What is GST and',
    accent: 'why does it matter?',
    body: [
      'GST (Goods and Services Tax) is one tax across India that replaced a pile of separate indirect taxes such as VAT, excise duty and service tax. Before it, each state had its own system, and tax was charged on top of tax.',
      'For a business, the practical points are simple: charge the right rate on every invoice, split it correctly between the Centre and the state, and keep records your CA can file from.',
    ],
  },
  steps: [
    ['Choose what you have', 'Pick "Before GST" if the amount is the price without tax, or "With GST included" if the tax is already inside it.'],
    ['Enter the amount and rate', 'Type the amount in rupees and tap a rate. Use the other rates menu for the special and older rates.'],
    ['Pick the type of sale', 'Choose inside one state for CGST and SGST, or to another state for IGST. The result updates as you type.'],
  ],
  features: [
    ['Exact to the paisa', 'Amounts are worked out in whole paise, so the parts always add up to the total.'],
    ['CGST, SGST and IGST', 'See each part of the tax, not just the total, the way it appears on an invoice.'],
    ['Add or remove GST', 'Go from a price to a price with tax, or from a tax-inclusive price back to the base amount.'],
    ['Private', 'The sum runs in your browser. What you type is not sent to us.'],
  ],
  faq: [
    ['What are the GST rates in India?', 'Most goods and services fall in 0%, 5%, 18% or 40%. A few items have special rates, such as 3% on gold and 0.25% on rough diamonds. The older 12% and 28% rates apply to supplies made before 22 September 2025.'],
    ['What is the difference between CGST, SGST and IGST?', 'When you sell inside one state, the tax is split into equal halves: CGST for the Centre and SGST for the state. When you sell to another state, the whole tax is charged as IGST.'],
    ['How do I calculate GST on an amount?', 'GST = amount x rate / 100, and total = amount + GST. For Rs 1,000 at 18% that is Rs 180 of tax and Rs 1,180 in all.'],
    ['How do I take GST out of a price that already includes it?', 'Base = total x 100 / (100 + rate), and GST = total - base. For Rs 1,180 at 18% the base is Rs 1,000 and the GST is Rs 180.'],
    ['Which rate applies to my product?', 'It depends on the HSN or SAC code of what you sell. Check the code on your supplier bill or on the GST portal, and ask your CA if you are unsure.'],
    ['Is this calculator tax advice?', 'No. It is a plain guide to the arithmetic. You and your CA remain responsible for the rate and for every filing.'],
  ],
  crossTitle: 'Need more than a GST calculator?',
  crossText: 'Kora works out the tax on every invoice for you, from the place of supply, and keeps your returns data ready for your CA.',
};

const INVOICE: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Create professional bills in minutes',
  lead: 'Fill in your details, watch the invoice build itself on the right, then print it or save it as a PDF. GST is worked out for you.',
  cta: 'Create an invoice now',
  toolTitle: 'Generate an invoice',
  toolAccent: 'online',
  stats: FACTS,
  about: {
    title: 'What is an invoice and',
    accent: 'what goes on it?',
    body: [
      'An invoice is the document that records a sale. It lists what was sold, the price, the tax and when payment is due. It is also the record your customer needs to claim input tax credit and your CA needs to file returns.',
      'A GST tax invoice normally shows your name, address and GSTIN, the customer details, a unique invoice number, the date, each item with its HSN or SAC code, the tax split and the total.',
    ],
  },
  steps: [
    ['Enter your details', 'Add your business, your customer and the items you sold. Tax is added from the state and rate you choose.'],
    ['Check the preview', 'The invoice updates as you type. Add your logo and pick a colour to match your brand.'],
    ['Print, save or share', 'Print it, save it as a PDF from the print window, or share a short summary on WhatsApp or email.'],
  ],
  features: [
    ['GST worked out', 'CGST, SGST or IGST are added from the states you pick, with the total in words.'],
    ['Your logo and colour', 'Upload a logo and choose an accent colour so the invoice looks like yours.'],
    ['Print or save as PDF', 'One button opens the print window, where you can save a PDF.'],
    ['Share in a tap', 'Send a summary on WhatsApp or email straight from the page.'],
    ['Private by design', 'Everything stays in your browser. We do not receive what you type.'],
    ['Other documents too', 'The same tool style makes quotations, proforma invoices, purchase orders and receipts.'],
  ],
  faq: [
    ['Is the invoice generator really free?', 'Yes. It is free to use and needs no account. When you need numbering in order, reminders and payment tracking, Kora does that for you.'],
    ['Are the invoices GST compliant?', 'The layout carries the fields a GST tax invoice needs and the tax is worked out with the same library Kora uses. You and your CA remain responsible for what you issue.'],
    ['Do I need to create an account?', 'No. Open the page, fill in the form and print.'],
    ['Can I add my logo?', 'Yes. Upload a PNG, JPG or WebP file under 1 MB. It stays on your device.'],
    ['How do I get a PDF?', 'Choose Print or save as PDF, then pick "Save as PDF" as the printer in the print window.'],
    ['Does Kora keep a copy of my invoice?', 'No. Nothing you type here leaves your device. If you want invoices saved and numbered for you, sign up for Kora.'],
  ],
  crossTitle: 'Do more than just invoicing',
  crossText: 'Switch to Kora to number invoices in order, send them on WhatsApp with a UPI QR and see who has paid.',
};

const LOGO: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Make a logo in a few clicks',
  lead: 'Enter your business name and pick a style you like. Change the colour, shape and letters, then download your logo as an image.',
  cta: 'Make my logo',
  toolTitle: 'Create your logo',
  toolAccent: 'now',
  stats: FACTS,
  about: {
    title: 'Why does your business',
    accent: 'need a logo?',
    body: [
      'A logo is the small mark people connect with your business. On an invoice it tells a customer at a glance who the bill is from, and it makes your documents look careful.',
      'Keep it simple. One or two colours and a clear shape stay readable on a phone screen, on a printout and on a shop sign.',
    ],
  },
  steps: [
    ['Enter your name', 'Type your business name. The letters for the mark are suggested from it, and you can change them.'],
    ['Pick a style', 'Choose one of the starting styles, then adjust the colour, shape, letter style and layout.'],
    ['Download', 'Download the logo as a PNG and use it on your invoices, your social pages or your shop board.'],
  ],
  features: [
    ['A few clicks', 'Start from a ready style and change only what you like.'],
    ['Fully adjustable', 'Colours, shapes, letter styles and layouts are all your choice.'],
    ['Yours to use', 'You can use the logo you make wherever you like.'],
    ['Private', 'The logo is drawn on your device. Your business name is not sent anywhere.'],
  ],
  faq: [
    ['Is the logo maker free?', 'Yes. There is nothing to pay and no account to make.'],
    ['Can I use the logo for my business?', 'Yes. It is a simple mark made from your own letters and your own name, so it is yours to use.'],
    ['What format do I get?', 'A PNG image. A square mark under 150 KB works well as your logo on a Kora invoice.'],
    ['Can I change it later?', 'Come back and make another any time. The tool does not store your logo, so keep the file you download.'],
    ['Will this replace a designer?', 'It makes a clean starter logo. If you want a full brand identity, a designer is still the better choice.'],
  ],
  crossTitle: 'Put your logo to work',
  crossText: 'Add your logo to Kora once and it appears on every invoice, quote and receipt you send.',
};

const BY_SLUG: Record<string, ToolPageInfo> = { 'gst-calculator': GST, 'invoice-generator': INVOICE, 'logo-maker': LOGO };

/** Tools without their own page copy get a plain version built from their title and summary. */
export function toolPageInfo(t: Tool): ToolPageInfo {
  const own = BY_SLUG[t.slug];
  if (own) return own;
  const doc = t.group === 'Documents';
  return {
    badge: 'Free, no signup',
    highlight: doc ? 'Ready in a couple of minutes' : 'Quick, simple and private',
    lead: t.summary,
    cta: `Use the ${t.title.toLowerCase()}`,
    toolTitle: t.title,
    toolAccent: 'online',
    stats: FACTS,
    steps: doc
      ? [['Fill in the details', 'Add your business, the other party and the items.'], ['Check the preview', 'The page updates as you type, so you see exactly what you will send.'], ['Print or save as PDF', 'Use the print window to print it or save it as a PDF.']]
      : [['Give it what it needs', 'Type or choose what the tool asks for.'], ['See the result', 'The result appears straight away on this page.'], ['Download or copy it', 'Save the result and use it where you need it.']],
    features: [
      ['Free to use', 'No payment and no account.'], ['Private', 'It runs in your browser, so what you enter stays on your device.'],
      ['Made for India', 'Built around how Indian businesses bill and keep records.'], ['Works on a phone', 'The page fits small screens.'],
    ],
    faq: [
      ['Is this tool free?', 'Yes. It is free and needs no signup.'],
      ['Is what I type sent to Kora?', 'No. The tool runs in your browser and nothing you enter is uploaded.'],
      ['Can I do this every week without retyping?', 'Yes, with Kora. It remembers your customers and items, numbers documents in order and keeps them for you.'],
    ],
    crossTitle: `Need more than the ${t.title.toLowerCase()}?`,
    crossText: 'Kora handles invoices, payments, reminders and returns data in one place that stays correct.',
  };
}
