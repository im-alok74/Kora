/**
 * The "do this automatically in Kora" call to action shown under every free tool. Each line says one thing Kora really does that
 * replaces the manual step in the tool above it, and the button goes to the sign-up page. No numbers, no promises beyond the app.
 */
export type KoraCta = { title: string; text: string; button: string };

export const SIGNUP_HREF = '/login?signup=1';

export const KORA_CTA: Record<string, KoraCta> = {
  'gst-calculator': { title: 'Let Kora work out GST on every invoice', text: 'Kora picks CGST and SGST or IGST from the place of supply and adds up each line for you, so there is no calculator step.', button: 'Invoice with GST worked out' },
  'invoice-generator': { title: 'Stop retyping your invoices', text: 'Kora numbers invoices in order, remembers your customers and items, and sends each one on WhatsApp with a UPI QR.', button: 'Create invoices in Kora' },
  'quotation-maker': { title: 'Turn a quote into an invoice in one click', text: 'Make the quotation in Kora and convert it to an invoice when the customer agrees, without typing the items again.', button: 'Send quotes from Kora' },
  'proforma-invoice-generator': { title: 'Move from proforma to tax invoice without retyping', text: 'Kora keeps the proforma and carries its items into the final invoice when you deliver.', button: 'Try Kora for proformas' },
  'purchase-order-generator': { title: 'Keep what you buy in the same place as what you sell', text: 'Kora records your supplier bills and keeps your input tax credit in view for your CA.', button: 'Track purchases in Kora' },
  'receipt-maker': { title: 'Let every payment find its invoice', text: 'In Kora a payment is recorded against its invoice, so the balance still due is always right and nothing is receipted by hand.', button: 'Record payments in Kora' },
  'qr-code-generator': { title: 'Put a UPI QR on every invoice', text: 'Kora adds a UPI QR to each invoice and matches the payment to it, so you do not make a code each time.', button: 'Get paid by UPI with Kora' },
  'barcode-generator': { title: 'Keep a barcode on every item', text: 'Kora stores a barcode against each item and has a billing counter for the shop that bills from those items.', button: 'Set up items in Kora' },
  'qr-code-scanner': { title: 'Take payments without screenshots', text: 'Customers pay from the UPI QR on a Kora invoice and Kora matches the payment to the invoice for you.', button: 'Collect payments with Kora' },
  'barcode-scanner': { title: 'Keep your stock list straight', text: 'Kora keeps your items and stock with your invoices, so each sale comes off what you hold.', button: 'Track stock in Kora' },
  'logo-maker': { title: 'Put your logo on every document', text: 'Add your logo once in Kora and it appears on every invoice, quotation and receipt you send.', button: 'Add your logo in Kora' },
  'profit-margin-calculator': { title: 'Start every quote from the right price', text: 'Kora keeps your items with their prices and tax rates, so a quote or invoice starts from the price you settled on here.', button: 'Save your prices in Kora' },
  'emi-calculator': { title: 'Get paid on time, so loans are easier', text: 'Kora sends payment links and reminders and matches each payment to its invoice, which keeps your cash flow steady.', button: 'Chase payments with Kora' },
  'interest-calculator': { title: 'Deal with overdue invoices without the sums', text: 'Kora can work out the late fee on an overdue invoice and prepare a draft debit note for you to read and issue. Nothing is charged by itself.', button: 'Manage overdue invoices' },
  'gstin-validator': { title: 'Never type a customer GSTIN wrong', text: 'Kora checks the GSTIN when you add a customer, and fills the right tax on every invoice from it.', button: 'Add customers in Kora' },
  'amount-in-words': { title: 'Have the words written for you', text: 'Kora writes the invoice total in words on every invoice, in the same wording as this tool.', button: 'Invoice with Kora' },
};
