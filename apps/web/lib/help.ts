// Help centre articles. Plain Indian business English. Nothing here is legal or tax advice; where it matters, the article says so.
export type HelpArticle = {
  slug: string; title: string; category: 'Getting started' | 'GST' | 'Getting paid' | 'Your data' | 'Your team';
  summary: string; body: string[]; steps?: string[]; related: string[];
};

export const HELP_CATEGORIES: HelpArticle['category'][] = ['Getting started', 'GST', 'Getting paid', 'Your data', 'Your team'];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: 'first-invoice', title: 'Make your first invoice', category: 'Getting started',
    summary: 'From an empty account to an issued invoice in about five minutes.',
    body: [
      'You need three things: your business details, a customer and something to sell. If you would rather look around first, use "Try with sample data" on your dashboard. It fills a clearly labelled demo business that you can delete in one click.',
      'Tax is worked out as you type. Kora compares your state with the place of supply and picks CGST and SGST, or IGST. You do not choose it by hand.',
      'A draft can be changed any time. Once you issue an invoice it gets its number and cannot be edited. If something is wrong you fix it with a credit note or a debit note.',
    ],
    steps: ['Open Documents and choose New invoice.', 'Pick a customer, or add one on the spot.', 'Add lines. Choose an item to fill in the HSN code and GST rate.', 'Check the total on the right, then choose Save as draft or Issue.', 'After issuing, choose Send to share it on WhatsApp, SMS or email with a UPI QR.'],
    related: ['customers-and-items', 'gst-basics-for-invoices', 'collect-upi-payments'],
  },
  {
    slug: 'customers-and-items', title: 'Add customers and items', category: 'Getting started',
    summary: 'Save people and products once so every invoice is quick.',
    body: [
      'A customer needs a name. Add a GSTIN if they have one, because it decides the tax type and shows on the invoice. Kora checks the GSTIN format and the check character and tells you if something is off.',
      'An item carries a name, a price, an HSN or SAC code and a GST rate. Add it once and it fills those fields on every invoice.',
      'Have a long list already? Import customers and items from a spreadsheet instead of typing them. See Move from other software.',
    ],
    steps: ['Open Customers, then Add customer.', 'Fill in the name, GSTIN, state and phone or email.', 'Open Items, then Add item, and set the HSN or SAC code and the GST rate.'],
    related: ['import-from-other-software', 'first-invoice'],
  },
  {
    slug: 'gst-basics-for-invoices', title: 'GST basics for your invoices', category: 'GST',
    summary: 'What has to appear on a tax invoice, in plain words.',
    body: [
      'If you are registered for GST, a tax invoice normally shows your GSTIN, the invoice number and date, the customer name and address, a description of each item with its HSN or SAC code, the taxable value, the tax rate and the tax amount. Kora puts these on for you.',
      'Invoice numbers run in sequence for each financial year without gaps. Kora keeps the sequence, so you do not have to track it.',
      'If you are not registered, or you sell under the composition scheme, you issue a bill of supply instead and do not charge GST. Choose this when you set up your business.',
      'This page is a plain summary to help you use Kora. It is not tax advice. Talk to your CA about your own situation.',
    ],
    related: ['cgst-sgst-igst', 'credit-and-debit-notes', 'gstr-1-and-your-ca'],
  },
  {
    slug: 'cgst-sgst-igst', title: 'CGST, SGST and IGST: which one applies', category: 'GST',
    summary: 'How Kora picks the tax type from the place of supply.',
    body: [
      'When you sell inside your own state, the tax is split into CGST and SGST in equal halves. When you sell to another state, the whole tax is IGST.',
      'Kora decides by comparing the state your business supplies from with the place of supply on the invoice. The place of supply usually follows your customer state, which Kora reads from their GSTIN.',
      'Every amount is a whole number of paise, so the total never drifts by a rupee. If a rule for your kind of sale is unusual, such as an export or a service with a special place of supply, check with your CA.',
    ],
    related: ['gst-basics-for-invoices', 'first-invoice'],
  },
  {
    slug: 'e-invoice', title: 'E-invoicing', category: 'GST',
    summary: 'How Kora prepares and registers e-invoices, and what to do when one is rejected.',
    body: [
      'Businesses above the government turnover limit must register each B2B invoice on the e-invoice portal to get an IRN and a QR code. Whether that applies to you is for you and your CA to decide.',
      'Kora checks every detail the portal needs before sending, and tells you in plain words what to fix. If the portal is down, Kora keeps trying. If the portal rejects an invoice, you see the reason and can correct it.',
      'An e-invoice can be cancelled only within 24 hours of registration. After that, use a credit note.',
      'Kora is in early access. The live connection to the e-invoice partner is switched on with our partners, so until then registration runs against a test connection.',
    ],
    steps: ['Issue the invoice as usual.', 'Open it and choose Register e-invoice.', 'Wait for the IRN and QR to appear on the invoice.', 'If it fails, read the reason, fix the detail and try again.'],
    related: ['credit-and-debit-notes', 'gstr-1-and-your-ca'],
  },
  {
    slug: 'payment-reminders', title: 'Payment reminders', category: 'Getting paid',
    summary: 'Let Kora chase for you on a schedule you choose.',
    body: [
      'Reminders go out before and after the due date, on the days you choose, through WhatsApp, SMS or email. Each message carries a pay link and a UPI QR for the amount still due.',
      'A reminder stops by itself when the invoice is paid. Part payments reduce the amount asked for.',
      'While Kora is in early access, messages go through a test sender unless your business has live delivery switched on.',
    ],
    steps: ['Open Settings and find Reminders.', 'Choose how many days before and after the due date to remind.', 'Pick the channels, then save.'],
    related: ['collect-upi-payments', 'recurring-invoices'],
  },
  {
    slug: 'collect-upi-payments', title: 'Collect payments by UPI', category: 'Getting paid',
    summary: 'A QR and a pay link on every invoice, with payments matched for you.',
    body: [
      'Add your UPI ID in Settings. After that every invoice shows a QR with the amount still due filled in, so a customer pays with one scan.',
      'Payments made through a payment link are matched to the invoice automatically. If a customer pays by bank transfer or cash, record the payment on the invoice yourself.',
      'Part payments are supported. The invoice shows what is paid and what is left.',
    ],
    steps: ['Open Settings and add your UPI ID.', 'Issue an invoice and open it.', 'Choose Record payment for money that arrived another way.'],
    related: ['payment-reminders', 'first-invoice'],
  },
  {
    slug: 'estimates-and-quotes', title: 'Quotes and estimates', category: 'Getting started',
    summary: 'Send a quote, get a yes, and turn it into an invoice once.',
    body: [
      'An estimate has a valid-until date. Your customer can accept or decline it from a private link, with no account.',
      'When a quote is accepted, you convert it to an invoice with one click. A quote can be converted only once, so the same work is not billed twice.',
      'You can also quote in another currency. The invoice that follows is in rupees.',
    ],
    steps: ['Open Documents and choose New estimate.', 'Fill it in and send it.', 'When it is accepted, open it and choose Convert to invoice.'],
    related: ['first-invoice', 'recurring-invoices'],
  },
  {
    slug: 'credit-and-debit-notes', title: 'Fixing a mistake: credit and debit notes', category: 'GST',
    summary: 'Issued invoices cannot be edited. Here is how to correct one.',
    body: [
      'Once an invoice is issued it is sealed. This keeps your record clean for your CA and for any audit.',
      'If you charged too much, issue a credit note against the invoice. If you charged too little, issue a debit note. Both link back to the original invoice and carry their own numbers.',
      'Not yet issued? A draft can be edited or deleted freely.',
    ],
    steps: ['Open the issued invoice.', 'Choose Credit note or Debit note.', 'Enter the amount or lines to correct and issue it.'],
    related: ['gst-basics-for-invoices', 'e-invoice'],
  },
  {
    slug: 'recurring-invoices', title: 'Recurring invoices', category: 'Getting paid',
    summary: 'Bill the same customer every week, month or year without retyping.',
    body: [
      'Set the schedule once. Each time it comes due Kora creates the invoice as a draft, issues it, or issues and sends it. You choose which.',
      'Start with drafts if you want to look at each one before it goes. Switch to issue and send when you trust the setup.',
    ],
    steps: ['Open Recurring and choose New.', 'Pick the customer, the lines and how often it repeats.', 'Choose whether to save as draft, issue, or issue and send.'],
    related: ['payment-reminders', 'first-invoice'],
  },
  {
    slug: 'import-from-other-software', title: 'Move from other software', category: 'Your data',
    summary: 'Bring your customers and items from Zoho, Vyapar, Tally or a spreadsheet.',
    body: [
      'Export a customer list and an item list from your old software as an Excel or CSV file, then import them into Kora. The guided page tells you which file to export from each product and how the columns line up.',
      'Importing past invoices is not built yet. Keep a backup from your old software for old records, and start fresh numbering in Kora.',
    ],
    steps: ['Open Import from other software.', 'Choose your old product and follow its export steps.', 'Upload the file and check the preview before you confirm.'],
    related: ['customers-and-items', 'back-up-and-export'],
  },
  {
    slug: 'back-up-and-export', title: 'Back up and export your data', category: 'Your data',
    summary: 'Your data is yours. Take a copy any time.',
    body: [
      'Open Data to export to Excel, download a full backup as a ZIP with CSV and JSON files, or create a Tally import file.',
      'Spreadsheet exports are written so that they open safely in Excel or Google Sheets.',
    ],
    related: ['import-from-other-software', 'gstr-1-and-your-ca'],
  },
  {
    slug: 'roles-and-team', title: 'Roles and your team', category: 'Your team',
    summary: 'Owner, staff and accountant: who can do what.',
    body: [
      'The owner can do everything, including adding people and changing settings. Staff can create and send documents and record payments. An accountant can see everything and run reports, but cannot change documents.',
      'These limits are enforced by the database, not only by the screens, so a person cannot get around them.',
      'One login can run more than one business. Use the business switcher at the top of the side menu.',
    ],
    steps: ['Open Team (owners only).', 'Choose Invite and enter their mobile number or email.', 'Pick a role. You can change or remove it later.'],
    related: ['security-and-sign-in', 'gstr-1-and-your-ca'],
  },
  {
    slug: 'gstr-1-and-your-ca', title: 'Working with your CA', category: 'GST',
    summary: 'What Kora prepares, and what stays with you and your CA.',
    body: [
      'Kora does not file your returns. It prepares the data: a GSTR-1 JSON file, a GST summary and a sales register that add up to your sales ledger to the paisa.',
      'Invite your CA as an accountant so they can see everything without being able to change it. Or share the exports. Either way, you and your CA remain responsible for every invoice and every filing.',
    ],
    steps: ['Open Reports and choose the month.', 'Download the GSTR-1 file or the summary.', 'Send it to your CA, or invite them from Team.'],
    related: ['roles-and-team', 'gst-basics-for-invoices'],
  },
  {
    slug: 'offline-and-phone', title: 'Use Kora on your phone and offline', category: 'Getting started',
    summary: 'Install it like an app and keep working when the network drops.',
    body: [
      'Open Kora in your phone browser and choose Add to Home Screen. It then opens like an app.',
      'Drafts you make offline stay on your device and sync when the connection returns. If something changed in between, Kora asks you what to keep.',
      'Issuing, sending and e-invoicing need a connection.',
    ],
    related: ['first-invoice', 'security-and-sign-in'],
  },
  {
    slug: 'security-and-sign-in', title: 'Signing in and keeping your account safe', category: 'Your team',
    summary: 'Passwords, one-time codes, an authenticator app and signed-in devices.',
    body: [
      'You can sign in with a password, or ask for a six-digit code on your mobile number or email. For extra safety, turn on an authenticator app and keep the recovery codes somewhere safe.',
      'Open Security to see the devices that are signed in and a log of recent sign-ins. Sign out any device you do not recognise. Kora never asks for your GST portal password.',
    ],
    steps: ['Open Security.', 'Turn on the authenticator app and save the recovery codes.', 'Review the list of devices.'],
    related: ['roles-and-team', 'offline-and-phone'],
  },
];

export const bySlug = (slug: string) => HELP_ARTICLES.find((a) => a.slug === slug);

/** Simple scoring search over title, summary and body. */
export function searchHelp(q: string): HelpArticle[] {
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (!terms.length) return HELP_ARTICLES;
  return HELP_ARTICLES
    .map((a) => {
      const title = a.title.toLowerCase(), sum = a.summary.toLowerCase(), body = (a.body.join(' ') + ' ' + (a.steps ?? []).join(' ')).toLowerCase();
      let s = 0;
      for (const t of terms) { if (title.includes(t)) s += 5; if (sum.includes(t)) s += 3; if (body.includes(t)) s += 1; }
      return [a, s] as const;
    })
    .filter(([, s]) => s > 0).sort((x, y) => y[1] - x[1]).map(([a]) => a);
}
