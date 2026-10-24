import type { Tool } from './tools';
import { NEW_PAGES } from './toolPagesMore';
import { CALC_PAGES } from './toolPagesCalc';

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

const QUOTE: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Send a clear quote, win the job',
  lead: 'Add the items, the rates and a valid-until date. Tax is worked out for you and the quotation is ready to print, save as a PDF or share.',
  cta: 'Make a quotation now',
  toolTitle: 'Create a quotation',
  toolAccent: 'online',
  stats: FACTS,
  about: {
    title: 'What is a quotation and',
    accent: 'when do you send one?',
    body: [
      'A quotation (or quote) is the price you offer before the work starts. It lists what you will supply, the rate for each item, the tax and how long the offer stays open. It is an offer, not a bill: the customer owes nothing until they accept and you supply.',
      'A clear quote avoids arguments later. Put the valid-until date on it, say what is and is not included, and mention any advance you need. When the customer says yes, the quote becomes the base for your tax invoice.',
    ],
  },
  steps: [
    ['Add who and what', 'Enter your business, the customer and each item with its quantity and rate. Pick the GST rate for every item.'],
    ['Set the valid-until date', 'Choose how long the offer stays open and add your terms, such as the advance you need or the delivery time.'],
    ['Print, save or share', 'Print it, save it as a PDF from the print window, or send a short summary on WhatsApp or email.'],
  ],
  features: [
    ['Tax worked out', 'CGST and SGST, or IGST for another state, are added from the states you choose, with the total in words.'],
    ['Valid-until date', 'Show how long your price holds, so an old quote is not held against you.'],
    ['Your logo and colour', 'Add a logo and pick a colour so the quote looks like it came from your business.'],
    ['Private', 'It all runs in your browser. What you type is not sent to us.'],
  ],
  faq: [
    ['What is the difference between a quotation and an invoice?', 'A quotation is an offer of a price before the sale. An invoice is the bill you issue when you supply the goods or services. A GST tax invoice has legal requirements that a quote does not.'],
    ['Does a quotation have to show GST?', 'It is good practice to show the tax so the customer knows the full price. The tax becomes payable when you supply and issue the tax invoice, not when you send the quote.'],
    ['How long should a quotation be valid?', 'There is no fixed rule. Seven to thirty days is common. Pick a period you can honour if prices or rates change.'],
    ['Can I turn the quotation into an invoice?', 'In this tool, open the Invoice Generator and enter the same items. In Kora, one click turns a saved quote into an invoice.'],
    ['Is a quotation legally binding?', 'It is an offer. Once the customer accepts it and you start the work, it can form part of the contract. For anything large, ask your advisor to check your terms.'],
    ['Does Kora keep a copy of what I type?', 'No. Nothing you enter here leaves your device.'],
  ],
  crossTitle: 'Turn quotes into paid invoices',
  crossText: 'In Kora a saved quotation becomes an invoice in one click, goes out on WhatsApp with a UPI QR and shows when it is paid.',
};

const PROFORMA: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Ask for payment before you deliver',
  lead: 'Make a proforma invoice with items, tax and a valid-until date. A customer can pay against it before you send the goods or start the work.',
  cta: 'Make a proforma invoice',
  toolTitle: 'Create a proforma invoice',
  toolAccent: 'online',
  stats: FACTS,
  about: {
    title: 'What is a proforma invoice and',
    accent: 'how is it different?',
    body: [
      'A proforma invoice is a preliminary bill. It tells the customer what they will be charged, so they can arrange payment, raise an internal approval or get an import or bank document ready.',
      'It is not a tax invoice. You still issue a proper GST tax invoice when you supply the goods or services, and only that invoice supports the buyer\'s input tax credit. If you take an advance, ask your CA whether a receipt voucher is also needed.',
    ],
  },
  steps: [
    ['Fill in the details', 'Enter your business, the customer and the items with quantity, rate and GST.'],
    ['Set the valid-until date', 'Say how long the proforma stands and add your payment terms, such as bank details or the advance needed.'],
    ['Print, save or share', 'Print it, save it as a PDF, or send a short summary on WhatsApp or email.'],
  ],
  features: [
    ['Marked as proforma', 'The title says PROFORMA INVOICE, so nobody mistakes it for a tax invoice.'],
    ['Tax shown up front', 'CGST, SGST or IGST are worked out, so the amount to pay is clear.'],
    ['Print or save as PDF', 'One button opens the print window, where you can save a PDF.'],
    ['Private', 'It runs in your browser. We do not receive what you type.'],
  ],
  faq: [
    ['Is a proforma invoice the same as a tax invoice?', 'No. A proforma invoice is a preview of the charge. It is not a tax invoice and cannot be used by the buyer to claim input tax credit. You issue the tax invoice when you supply.'],
    ['When should I send a proforma invoice?', 'When the customer needs a price document to pay in advance, to get an internal approval, or to arrange a letter of credit or other paperwork before delivery.'],
    ['Does a proforma invoice need a number?', 'Give it a number so you can match the payment to it. Keep it in a separate series from your tax invoices to avoid confusion.'],
    ['Do I charge GST on a proforma invoice?', 'It shows the tax you expect to charge. The tax is reported on the tax invoice you issue later. If you take an advance, check with your CA how it is treated.'],
    ['Can the customer pay against it?', 'Yes. Many customers pay straight from a proforma. Put your bank or UPI details in the notes.'],
    ['Does Kora keep a copy of what I type?', 'No. Nothing you enter here leaves your device.'],
  ],
  crossTitle: 'Move from proforma to paid',
  crossText: 'In Kora you can send a proforma, take the advance with a UPI QR and then issue the tax invoice from the same details.',
};

const PO: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Order from suppliers, on paper that holds up',
  lead: 'Make a purchase order with items, quantities, rates, a delivery date and your terms. The tax is shown so the supplier\'s invoice can match it.',
  cta: 'Make a purchase order',
  toolTitle: 'Create a purchase order',
  toolAccent: 'online',
  stats: FACTS,
  about: {
    title: 'What is a purchase order and',
    accent: 'why use one?',
    body: [
      'A purchase order (PO) is the document a buyer sends to a supplier to order goods or services. It records what you want, in what quantity, at what price and by when. When the supplier accepts it, it is the reference for delivery and for the bill that follows.',
      'Quote the PO number on the supplier\'s invoice and your payment. It makes it easy to check that what arrived is what you ordered, and that the tax charged matches what you agreed.',
    ],
  },
  steps: [
    ['Add supplier and buyer', 'Enter the supplier you are ordering from and your own business as the party to ship and bill to.'],
    ['List the items', 'Add each item with quantity, rate and GST, and set the date you need it by.'],
    ['Print, save or share', 'Print it, save it as a PDF, or send a short summary to the supplier on WhatsApp or email.'],
  ],
  features: [
    ['Delivery date', 'A deliver-by date on the order sets the expectation from the start.'],
    ['Tax worked out', 'GST is calculated from both states, so the totals can be compared with the supplier\'s invoice.'],
    ['Terms and notes', 'Add payment terms, shipping instructions or a contact name.'],
    ['Private', 'It runs in your browser. We do not receive what you type.'],
  ],
  faq: [
    ['What should a purchase order include?', 'A PO number, the date, the supplier and buyer details, each item with quantity and rate, the tax, the total, the delivery address and date, and your payment terms.'],
    ['Is a purchase order the same as an invoice?', 'No. A purchase order is the buyer\'s order. The invoice is the supplier\'s bill. Your PO number should appear on the invoice you receive.'],
    ['Does a purchase order carry GST?', 'It can show the GST you expect to pay so the figures are agreed. The tax is charged on the supplier\'s tax invoice.'],
    ['Is a purchase order legally binding?', 'Once the supplier accepts it, it can form a contract on those terms. For large or unusual orders, have your advisor check your terms.'],
    ['Can I use it to order services?', 'Yes. Use the SAC code in place of an HSN code and describe the work and the date it is due.'],
    ['Does Kora keep a copy of what I type?', 'No. Nothing you enter here leaves your device.'],
  ],
  crossTitle: 'Keep purchases and payables in one place',
  crossText: 'Kora records your purchase bills, tracks what you owe suppliers and reconciles it with the tax on your sales.',
};

const RECEIPT: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Give proof of payment in seconds',
  lead: 'Enter who paid, how much and what for. The receipt writes the amount in words and is ready to print, save as a PDF or share.',
  cta: 'Make a receipt',
  toolTitle: 'Create a payment receipt',
  toolAccent: 'online',
  stats: FACTS,
  about: {
    title: 'What is a payment receipt and',
    accent: 'what should it say?',
    body: [
      'A payment receipt is proof that money was received. It names the payer, the amount, the date, how it was paid and what it was for. It protects both sides: the customer can show they paid, and you have a record that the payment came in.',
      'A receipt is not a tax invoice. If the payment is against an invoice, quote the invoice number so the two can be matched.',
    ],
  },
  steps: [
    ['Enter the payment', 'Add the amount received, the date and how it was paid: cash, UPI, bank transfer, cheque or card.'],
    ['Say what it is for', 'Write what the payment is towards, such as an invoice number or a month of rent.'],
    ['Print, save or share', 'Print it, save it as a PDF, or send a short summary on WhatsApp or email.'],
  ],
  features: [
    ['Amount in words', 'The amount is also written in words, which makes it harder to alter.'],
    ['Payment method', 'Record whether it was cash, UPI, a transfer, a cheque or a card.'],
    ['Your logo and colour', 'Add a logo and pick a colour to match your business.'],
    ['Private', 'It runs in your browser. We do not receive what you type.'],
  ],
  faq: [
    ['Is a receipt the same as an invoice?', 'No. An invoice asks for payment. A receipt confirms that payment was made. If it is for a taxable supply, you still issue a proper tax invoice.'],
    ['What should a receipt include?', 'A receipt number, the date, who paid, who received, the amount in figures and words, how it was paid and what it was for.'],
    ['Can I take a large payment in cash?', 'Income tax law restricts accepting Rs 2 lakh or more in cash from one person in a day, for one transaction or for one event. Prefer a bank transfer or UPI, and ask your CA if you are unsure.'],
    ['Do I need a revenue stamp?', 'Check the current stamp duty rules of your state for receipts. Many everyday receipts do not need one, and your CA can confirm.'],
    ['Can I make a receipt for a cheque?', 'Yes. Choose cheque, and write the cheque number and bank in the "towards" line. Treat the payment as received only when the cheque clears.'],
    ['Does Kora keep a copy of what I type?', 'No. Nothing you enter here leaves your device.'],
  ],
  crossTitle: 'Receipts that write themselves',
  crossText: 'When a customer pays through Kora by UPI, the payment is matched to the invoice and a receipt is ready to send.',
};

const QR: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Turn a link, a number or a payment into a code',
  lead: 'Choose what the code is for, fill in the details and download it as a PNG. Test it with your phone before you print.',
  cta: 'Make a QR code',
  toolTitle: 'Generate a QR code',
  toolAccent: 'online',
  stats: [['5', 'Kinds of code'], ['No signup', 'Start straight away'], ['On your device', 'Nothing is uploaded']],
  about: {
    title: 'What is a QR code and',
    accent: 'how do shops use it?',
    body: [
      'A QR code is a square pattern that a phone camera reads as text. The text can be a web address, a phone number, a Wi-Fi sign-in or a UPI payment request.',
      'For a shop, a UPI QR on the counter lets customers pay without typing your ID. The code made here is a plain static code: it holds exactly what you typed and does not expire, and it does not track scans.',
    ],
  },
  steps: [
    ['Choose the kind', 'Pick a web link, plain text, a phone number, a UPI payment or Wi-Fi sign-in.'],
    ['Fill in the details', 'Type the address, number or UPI ID. For UPI you can add the name and an amount, or leave the amount empty for the customer to type.'],
    ['Download and test', 'Download the PNG, scan it with a phone and check the result before you print it.'],
  ],
  features: [
    ['Five kinds of code', 'Link, text, phone number, UPI payment and Wi-Fi.'],
    ['Pick the size', 'From a small sticker to a large poster, up to 800 pixels.'],
    ['Never expires', 'A static code keeps working as long as the link or ID behind it does.'],
    ['Private', 'The code is drawn on your device. What you type is not sent to us.'],
  ],
  faq: [
    ['Is the QR code generator free?', 'Yes. There is no charge, no account and no limit on how many you make.'],
    ['Will my QR code expire?', 'No. It is a static code. It works for as long as the link, number or UPI ID inside it stays valid.'],
    ['How do I make a UPI payment QR?', 'Choose "A UPI payment", enter your UPI ID, add your name and, if you want, an amount. Scan it with any UPI app to check it opens the right payee.'],
    ['Can I track how many people scan it?', 'No. This tool makes a plain code and has no tracking. A tracked code needs a service that sits between the scan and your page.'],
    ['What size should I print?', 'Keep it at least 2 cm wide and leave a blank margin around it. Test the printed copy with a phone from the distance people will scan it.'],
    ['Does Kora see what I put in the code?', 'No. The code is made in your browser and nothing is uploaded.'],
  ],
  crossTitle: 'Get paid by UPI without the typing',
  crossText: 'Every invoice you send from Kora carries a UPI QR for the exact amount, and the payment is matched to the invoice.',
};

const BARCODE: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Print labels for your stock and shelves',
  lead: 'Type an item or SKU code and get a Code 128 barcode to download as an image. Use it for stock, bins, packing and in-house labels.',
  cta: 'Make a barcode',
  toolTitle: 'Generate a barcode',
  toolAccent: 'online',
  stats: [['Code 128', 'Barcode type'], ['No signup', 'Start straight away'], ['On your device', 'Nothing is uploaded']],
  about: {
    title: 'What is a barcode and',
    accent: 'which one do you need?',
    body: [
      'A barcode is a row of bars that a scanner turns back into a code. Code 128 can hold letters, numbers and common symbols in a compact space, which makes it a good choice for your own SKUs, bin labels and packing slips.',
      'Retail products sold in shops usually carry an EAN-13 or UPC number that is issued by GS1. A generator cannot give you a registered number, so for retail listings get your numbers from GS1 India.',
    ],
  },
  steps: [
    ['Type the code', 'Enter your SKU or item code. Use letters, numbers and common symbols.'],
    ['Set the height', 'Drag the slider until the bars are tall enough for your label.'],
    ['Download and test', 'Download the PNG or SVG, print it and scan it with your own scanner before you label a whole batch.'],
  ],
  features: [
    ['Code 128', 'A widely supported type that works with most scanners and phone apps.'],
    ['PNG and SVG', 'Download an image for a label or a vector file for a print shop.'],
    ['Adjustable height', 'Make short labels or tall ones.'],
    ['Private', 'The barcode is drawn on your device. What you type is not sent to us.'],
  ],
  faq: [
    ['What is Code 128?', 'A barcode type that encodes letters, numbers and common symbols in a compact line of bars. Most scanners read it.'],
    ['Can I use this for products I sell in shops?', 'For shop shelves and online marketplaces you normally need EAN-13 or UPC numbers issued by GS1. Use this tool for your own internal labels and stock codes.'],
    ['Why does it reject some characters?', 'Code 128 here covers standard letters, numbers and common symbols. Characters from other scripts cannot be encoded, so use plain letters and numbers.'],
    ['Will my scanner read it?', 'Most will. Always print one label and scan it before you print a full sheet, and keep a quiet blank margin on each side.'],
    ['Is there a limit to how many I can make?', 'No. It is free and you can make as many as you like.'],
    ['Does Kora see my codes?', 'No. The barcode is made in your browser and nothing is uploaded.'],
  ],
  crossTitle: 'Count stock and sell it, in one place',
  crossText: 'Kora keeps your items, your stock and your invoices together, so what you sell comes off what you hold.',
};

const QRSCAN: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Read a QR code from any picture',
  lead: 'Choose a photo or a screenshot with a QR code in it and the text inside appears at once. The picture stays on your device.',
  cta: 'Scan a QR code',
  toolTitle: 'Scan a QR code from an image',
  toolAccent: 'online',
  stats: [['Photo or screenshot', 'Input'], ['No signup', 'Start straight away'], ['On your device', 'Nothing is uploaded']],
  about: {
    title: 'When is it useful to read a QR code',
    accent: 'from an image?',
    body: [
      'Sometimes the QR code is on your screen, not on a wall: a payment request in a chat, a code in a PDF or a screenshot from a customer. Your phone camera cannot scan its own screen, but you can open the image here and read it.',
      'The tool shows you the text inside the code. Read it before you open a link or pay, and never act on a payment code you do not trust.',
    ],
  },
  steps: [
    ['Choose a picture', 'Pick a photo or a screenshot that shows the whole QR code, sharp and well lit.'],
    ['Read the result', 'The text, link or payment details inside the code appear on the page.'],
    ['Copy or open', 'Copy the text. If it is a web link, check where it goes before you open it.'],
  ],
  features: [
    ['Photos and screenshots', 'Works with any picture your browser can open.'],
    ['Copy in one tap', 'Copy the result to paste into a chat or a form.'],
    ['Nothing uploaded', 'The picture is read by your own browser and is never sent to us.'],
    ['Works on a phone', 'Pick a photo straight from your gallery.'],
  ],
  faq: [
    ['Which browsers does the QR scanner work in?', 'It uses the code reader built into your browser, which is available in Chrome and Edge on computers and in Chrome on Android. If your browser lacks it, the page says so.'],
    ['Why was no code found?', 'The picture may be blurred, cropped or too dark. Try a sharper, brighter picture with the whole code and a little blank space around it.'],
    ['Is it safe to open the link inside a QR code?', 'Not always. Look at the address first. Do not open links or pay on a code from someone you do not know.'],
    ['Does it work for UPI codes?', 'It shows the UPI payment text inside the code, with the payee ID. Check the name and amount in your payment app before you pay.'],
    ['Does it work with barcodes?', 'This page reads QR codes. Use the Online Barcode Scanner for product and shipping barcodes.'],
    ['Is my picture uploaded?', 'No. It is read inside your browser and goes nowhere.'],
  ],
  crossTitle: 'Take payments without the screenshots',
  crossText: 'Kora puts a UPI QR on every invoice and matches the payment to it, so nobody has to send a screenshot.',
};

const BARSCAN: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Read a barcode from a photo or your camera',
  lead: 'Choose a picture of a barcode, or point your camera at one. The code appears on the page and the image stays on your device.',
  cta: 'Scan a barcode',
  toolTitle: 'Scan a barcode',
  toolAccent: 'online',
  stats: [['Photo or camera', 'Input'], ['No signup', 'Start straight away'], ['On your device', 'Nothing is uploaded']],
  about: {
    title: 'What can a barcode scanner',
    accent: 'on a web page do?',
    body: [
      'Your browser can read many kinds of barcode, such as EAN, UPC and Code 128, from a picture or from a live camera view. It is handy for checking a label, looking up a product code or reading a stock sticker without installing an app.',
      'The tool reads the code and shows you the number. It does not look the product up or send the code anywhere.',
    ],
  },
  steps: [
    ['Choose a way to scan', 'Pick a photo of the barcode, or tap Scan with the camera and allow camera access.'],
    ['Hold it steady', 'Keep the whole barcode in view, with good light and the bars straight across the screen.'],
    ['Copy the result', 'The code and its type appear on the page. Copy it into your stock list or invoice.'],
  ],
  features: [
    ['Photo or live camera', 'Use a saved picture, or scan straight from the camera on your phone.'],
    ['Many barcode types', 'Reads the types your browser supports, such as EAN, UPC and Code 128.'],
    ['Nothing uploaded', 'The picture and the camera view are read by your own browser and never sent to us.'],
    ['Copy in one tap', 'Copy the code to paste where you need it.'],
  ],
  faq: [
    ['Which browsers does the barcode scanner work in?', 'It uses the code reader built into your browser, which is available in Chrome and Edge on computers and in Chrome on Android. If your browser lacks it, the page says so.'],
    ['Why can it not use my camera?', 'Allow camera access when the browser asks, and make sure no other app is using the camera. Camera access needs a secure (https) page. You can always choose a photo instead.'],
    ['Why was no barcode found?', 'The picture may be blurred, cropped or too dark. Keep the whole barcode in view, in good light, and try again.'],
    ['Does it tell me what the product is?', 'No. It shows the number inside the barcode. It does not look anything up.'],
    ['Does it read QR codes?', 'This page is for barcodes. Use the QR Code Scanner from Image for QR codes.'],
    ['Is my picture or camera view uploaded?', 'No. Everything is read inside your browser and goes nowhere.'],
  ],
  crossTitle: 'Keep your stock list straight',
  crossText: 'Kora keeps your items and stock with your invoices, so each sale comes off what you hold.',
};

const BY_SLUG: Record<string, ToolPageInfo> = {
  'gst-calculator': GST, 'invoice-generator': INVOICE, 'logo-maker': LOGO, 'quotation-maker': QUOTE, 'proforma-invoice-generator': PROFORMA,
  'purchase-order-generator': PO, 'receipt-maker': RECEIPT, 'qr-code-generator': QR, 'barcode-generator': BARCODE, 'qr-code-scanner': QRSCAN, 'barcode-scanner': BARSCAN,
  ...NEW_PAGES, ...CALC_PAGES,
};

/** True when a tool has its own page copy. Every tool must: the generic text below is only a safety net. */
export const hasOwnCopy = (slug: string) => slug in BY_SLUG;

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
