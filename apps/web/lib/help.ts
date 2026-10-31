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
      'You need three things: your business details, a customer and something to sell. If you would rather look around first, use "Try it with sample data" on your dashboard. It fills a clearly labelled demo business that you can remove again.',
      'Tax is worked out as you type. Kora compares your state with the place of supply and picks CGST and SGST, or IGST. You do not choose it by hand.',
      'A draft can be changed any time. Once you issue an invoice it gets its number and cannot be edited. If something is wrong you fix it with a credit note or a debit note.',
    ],
    steps: ['Open Documents and choose New invoice.', 'Pick a customer, or add one on the spot.', 'Add lines. Choose an item to fill in the HSN code and GST rate.', 'Check the totals, then choose Save draft, or Issue to give it its number.', 'After issuing, use Send to share it on WhatsApp, SMS or email, or Copy link. The page your customer opens shows the UPI QR if you added your UPI ID.'],
    related: ['set-up-your-business', 'customers-and-items', 'send-on-whatsapp', 'collect-upi-payments'],
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
      'Once you turn e-invoicing on, Kora registers each invoice by itself when you issue it. There is no separate button to press. Kora checks every detail the portal needs before sending, and tells you in plain words what to fix. If the portal is down, Kora keeps trying in the background. If the portal rejects an invoice, you see the reason and can correct it.',
      'An e-invoice can be cancelled only within 24 hours of registration. After that, use a credit note.',
      'Kora is in early access. The live connection to the e-invoice partner is switched on with our partners, so until then registration runs against a test connection and the IRN you see is not a real one.',
    ],
    steps: ['Open Settings and tick "Register my invoices as e-invoices". Your CA can tell you whether this applies to you.', 'Issue the invoice as usual.', 'Wait for the IRN and QR to appear on the invoice. It shows as registering until the portal answers, which can take a while if the portal is slow.', 'If it is rejected, read the reason on the invoice, fix the detail and choose Resubmit e-invoice.', 'To cancel within 24 hours, choose Cancel e-invoice on the invoice.'],
    related: ['e-way-bills', 'credit-and-debit-notes', 'gstr-1-and-your-ca'],
  },
  {
    slug: 'payment-reminders', title: 'Payment reminders', category: 'Getting paid',
    summary: 'Let Kora chase for you on a schedule you choose.',
    body: [
      'Reminders go out at 10 am on the days you choose, counted from the due date, through WhatsApp, SMS or email. Each message names the invoice and the amount still due, and links to the invoice page where your customer can pay with the UPI QR.',
      'A reminder stops by itself when the invoice is paid. Part payments reduce the amount asked for. You can also press Send reminder on any unpaid invoice to nudge a customer straight away.',
      'While Kora is in early access, messages go through a test sender unless your business has live delivery switched on.',
    ],
    steps: ['Open Settings and find Payment reminders.', 'Tick Send reminders automatically.', 'Choose how to send (WhatsApp, SMS or email) and the days from the due date. Use a minus for days before, for example -2, 3, 7.', 'Choose Save reminder settings.'],
    related: ['collect-upi-payments', 'send-on-whatsapp', 'late-fees', 'recurring-invoices'],
  },
  {
    slug: 'collect-upi-payments', title: 'Collect payments by UPI', category: 'Getting paid',
    summary: 'A QR and a pay link on every invoice, with payments matched for you.',
    body: [
      'Add your UPI ID in Settings. After that every invoice shows a QR with the amount still due filled in, so a customer pays with one scan.',
      'Payments made through a payment link are matched to the invoice automatically once a payment gateway is connected. Until then, and for bank transfer, cheque or cash, record the payment on the invoice yourself. A QR scan goes straight to your bank, so Kora cannot see it. Record it when the money arrives, or use Bank to record what your bank statement shows.',
      'Part payments are supported. The invoice shows what is paid and what is left.',
    ],
    steps: ['Open Settings, find Business details and add your UPI ID.', 'Issue an invoice and open it.', 'Choose Record payment for money that arrived another way.'],
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
    steps: ['Open Recurring and choose New recurring invoice.', 'Pick the customer, the lines and how often it repeats.', 'Choose the first invoice date, and whether each one is saved as a draft, issued, or issued and sent.'],
    related: ['payment-reminders', 'first-invoice'],
  },
  {
    slug: 'import-from-other-software', title: 'Move from other software', category: 'Your data',
    summary: 'Bring your customers, items and past invoices from Zoho, Vyapar, Tally or a spreadsheet.',
    body: [
      'Export a customer list and an item list from your old software as an Excel or CSV file, then import them into Kora. From Tally, export your ledger master as an XML file and Kora picks out your customers. The import guide tells you which file to export from each product and how the columns line up.',
      'Past invoices come in as drafts, not as issued invoices. Kora gives a number only when you issue a document, and a number can never be reused, so your old invoice number is kept as a reference and the draft gets a new Kora number when you issue it. Look at each draft before you issue it. Issuing creates a new tax document with a new number, so talk to your CA before you issue an invoice that you already issued in your old software.',
      'Payments recorded against old invoices, stock counts, and files and attachments do not come across. Tally vouchers and old transactions do not come across either. Importing the same file twice does not make a second set.',
    ],
    steps: ['Open Import in the side menu, or read the import guide first.', 'Choose what you are importing and follow your old product\'s export steps.', 'Upload the file and check the preview. Rows with a problem are left out and explained.', 'Confirm. For invoices, open Documents to check each draft.'],
    related: ['customers-and-items', 'back-up-and-export'],
  },
  {
    slug: 'back-up-and-export', title: 'Back up and export your data', category: 'Your data',
    summary: 'Your data is yours. Take a copy any time.',
    body: [
      'Open Data to export to Excel, download a full backup as a ZIP with CSV and JSON files, or create a Tally import file. Exports are for the owner and the accountant. Staff cannot take the business data out.',
      'A backup holds your records, not your PDFs, receipt photos or settings. You can always make a PDF again from an issued invoice.',
      'Spreadsheet exports are written so that they open safely in Excel or Google Sheets.',
      'The Tally file follows Tally\'s import format but has not been tried against a live Tally yet. Import it into a test company first and ask your accountant to check it.',
    ],
    steps: ['Open Data.', 'Choose Download Excel file, Download backup (ZIP) or Download Tally file.', 'Keep the file somewhere safe that is not only on this phone or computer.'],
    related: ['import-from-other-software', 'gstr-1-and-your-ca'],
  },
  {
    slug: 'roles-and-team', title: 'Roles and your team', category: 'Your team',
    summary: 'Owner, staff and accountant: who can do what.',
    body: [
      'The owner can do everything, including adding people, changing settings and cancelling an issued document. Staff can create, issue and send documents, record payments and expenses, and enter purchases, but cannot cancel an issued document, change settings or take data out. An accountant can see everything, run reports and export, and can also enter purchase bills and go through the client inbox, but cannot change invoices.',
      'These limits are enforced by the database, not only by the screens, so a person cannot get around them.',
      'One login can run more than one business. Use the business switcher at the top of the side menu.',
    ],
    steps: ['Open Team (owners only).', 'Under Invite a person, enter their mobile number or email.', 'Pick a role: Staff, Accountant or Owner. Choose Send invitation.', 'They sign in with that number or email and accept the invitation; until they do, they see nothing of the business. You can cancel a waiting invitation.', 'To take access away later, choose Remove next to their name.'],
    related: ['security-and-sign-in', 'gstr-1-and-your-ca'],
  },
  {
    slug: 'gstr-1-and-your-ca', title: 'Working with your CA', category: 'GST',
    summary: 'What Kora prepares, and what stays with you and your CA.',
    body: [
      'Kora does not file your returns. It prepares the data: a GSTR-1 JSON file, a GSTR-3B JSON file, a GST summary and a sales register that add up to your sales ledger to the paisa. The GSTR-1 and GSTR-3B file layouts are still to be checked by a CA against the current government offline tool, so ask your CA to look before you upload one.',
      'Invite your CA as an accountant so they can see everything without being able to change it. Or share the exports. Either way, you and your CA remain responsible for every invoice and every filing.',
    ],
    steps: ['Open Reports and choose the month.', 'Choose Download GSTR-1 JSON, or the summary.', 'Send it to your CA, or add them as an accountant from Team.'],
    related: ['roles-and-team', 'purchases-and-input-credit', 'gst-basics-for-invoices'],
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
  {
    slug: 'set-up-your-business', title: 'Set up your business details', category: 'Getting started',
    summary: 'The details that print on every invoice, and where to change them.',
    body: [
      'When you first sign in, Kora walks you through five short steps: business details (including your phone number and UPI ID), your logo, the look of your invoice, your first customer and your first invoice. You can skip any step and come back later. Everything you enter is saved as you go.',
      'Everything you set up lives in Settings. Business details holds your legal name, trade name, GSTIN, address, phone, email, annual turnover, UPI ID, bank account, and the default notes and terms printed on each document. Invoice template holds your colour, font, layout, paper size, language, logo, signature image and footer line.',
      'Your GSTIN and address decide what you can issue and how tax is worked out, so check them with care. If you are not registered for GST, or you sell under the composition scheme, you issue a bill of supply instead of a tax invoice. Ask your CA if you are not sure which applies to you.',
      'The turnover question matters for e-invoicing. If your turnover has been above the government limit in any year since 2017-18, e-invoicing may apply to you even if this year is lower. Settings asks you, and tells you if your answer suggests you should turn e-invoicing on. The decision is yours and your CA\'s.',
    ],
    steps: ['Open Settings.', 'Fill in Business details and choose save.', 'Add your UPI ID so every invoice carries a QR.', 'Open Invoice template to choose how your documents look.', 'Add default notes and terms if you want the same words on every invoice.'],
    related: ['first-invoice', 'collect-upi-payments', 'e-invoice'],
  },
  {
    slug: 'send-on-whatsapp', title: 'Send an invoice on WhatsApp, SMS or email', category: 'Getting paid',
    summary: 'Share an issued invoice, see if it was opened, and what to do if it did not go.',
    body: [
      'Open an issued invoice. In the Send panel, pick WhatsApp, SMS or email, check the mobile number or email address, and choose Send. Or choose Copy link and paste the link into any chat yourself. A draft cannot be sent until it is issued.',
      'The panel tells you how many times your customer has opened the invoice, and Send history lists every attempt with its result. If a message failed, the history says why. Fix the cause, such as a wrong number, and send it again.',
      'Messages go out through a background queue, and Kora tries again if a provider is busy. It is usually quick, but it can take longer, and Send history shows where each message stands. Do not press Send again while it still says queued, or your customer may get it twice.',
      'While Kora is in early access, messages go through a test sender unless your business has live delivery switched on. A test message is not delivered to your customer. WhatsApp business messages also have to use a template approved by WhatsApp, so the wording of the first message to a customer follows that template.',
    ],
    steps: ['Issue the invoice and open it.', 'In Send, choose WhatsApp, SMS or email.', 'Check the number or email address, then choose Send.', 'Open Send history to see whether it was delivered.'],
    related: ['payment-reminders', 'collect-upi-payments', 'first-invoice'],
  },
  {
    slug: 'e-way-bills', title: 'E-way bills for goods', category: 'GST',
    summary: 'Make an e-way bill from an invoice, or download the file for the government portal.',
    body: [
      'When goods worth more than the government limit move in one consignment, the movement usually needs an e-way bill. The usual limit is Rs 50,000 of goods, but the rules have exceptions, so confirm with your CA whether a bill is needed. Services do not need one.',
      'You can make an e-way bill from an issued tax invoice, bill of supply or delivery challan. Kora asks for the distance in kilometres and the vehicle number, or the transporter\'s GSTIN if the transporter adds the vehicle later. It checks what it can before sending and says in plain words what to fix.',
      'Kora sends the bill through your GST partner. Until a partner is connected, choose Download JSON for the portal and upload the file on the e-way bill portal yourself.',
      'An e-way bill can be cancelled only within 24 hours of making it, and before the goods move. Choose a reason and confirm.',
      'Kora is in early access. The e-way bill format has not yet been checked against the live portal, so test with your CA first.',
    ],
    steps: ['Issue the invoice and open it.', 'Open the E-way bill panel.', 'Fill in the journey: distance, vehicle number or transporter.', 'Choose Make the e-way bill, or Download JSON for the portal.'],
    related: ['e-invoice', 'gst-basics-for-invoices'],
  },
  {
    slug: 'purchases-and-input-credit', title: 'Purchase bills and input GST', category: 'GST',
    summary: 'Record what you buy, see the credit you can claim, and check it against GSTR-2B.',
    body: [
      'Record your purchase bills under Purchases, with the vendor, bill number, date and lines. Each bill carries the GST you paid. Input GST then shows the credit you can claim, the credit at risk because your supplier has not filed it, and credit that is blocked.',
      'To check against what your suppliers filed, load your GSTR-2B file on the Input GST page. Kora marks each bill as matched, different in amount, only in 2B or only in your books. A bill that is only in 2B can be added to your books with the Add as a bill button.',
      'The GSTR-3B summary on the Reports page uses these figures. They are for your CA to confirm before filing. Kora does not file anything and does not decide whether a credit is allowed in your case.',
      'Expenses are a separate, simpler list for your own records. They do not feed input GST.',
    ],
    steps: ['Open Purchases and add a bill.', 'Open Input GST to see the credit by tax.', 'Load your GSTR-2B file to compare it with your bills.', 'Send the figures to your CA.'],
    related: ['gstr-1-and-your-ca', 'roles-and-team'],
  },
  {
    slug: 'client-portal', title: 'A private link for each customer', category: 'Getting paid',
    summary: 'Customers see what they owe, pay, answer quotes and read their statement, with no account.',
    body: [
      'You can make one private link for each customer. They open it on their phone and see their issued invoices, estimates, payments and statement, and can pay and answer estimates. It never shows your drafts, other customers or your reports.',
      'Anyone who has the link can open it, so send it only to the customer. Making a new link stops the old one, and you can stop a link at any time. Customers can ask for a sign-in code, which goes only to the email or mobile number saved on their record.',
      'An estimate that the customer answers from the portal shows in your activity log as answered by the customer.',
    ],
    steps: ['Open Customers.', 'Open the portal link for the customer you want. Making a new link stops the old one.', 'Copy the link, or choose Email it.', 'To end access, choose Stop this link.'],
    related: ['estimates-and-quotes', 'payment-reminders', 'collect-upi-payments'],
  },
  {
    slug: 'expenses', title: 'Record expenses', category: 'Getting started',
    summary: 'Keep your own record of what the business spends, with the receipt.',
    body: [
      'Under Expenses, add what you spent: the date, who you paid, the category, the amount paid including GST, the GST inside it and how you paid. You can attach a photo or PDF of the receipt (JPEG, PNG or PDF, up to 2 MB).',
      'Expenses are your own record and a CSV for your accountant. The GST here is only for your records. Kora does not claim input tax credit from expenses. To claim input credit on a bill from a supplier, enter it under Purchases instead.',
      'Costs that repeat, such as rent, can be set up once under Recurring as a recurring expense.',
    ],
    steps: ['Open Expenses and choose Add an expense.', 'Fill in the amount, category and how you paid.', 'Attach the receipt, then choose Save expense.', 'Choose Download CSV to send your list to your accountant.'],
    related: ['purchases-and-input-credit', 'recurring-invoices'],
  },
  {
    slug: 'stock-and-till', title: 'Stock and the till', category: 'Getting started',
    summary: 'Count the goods you sell, scan barcodes, and print a receipt at the counter.',
    body: [
      'In Items, turn on stock for goods that you count. Add stock that came in or went out, and set a reorder level so you can see what is running low. You can give an item a barcode.',
      'The Till is for the counter. Scan a barcode or type an item name, take the money, and print a receipt. If your business issues bills of supply, no GST is added. Quick items show the things you sell most.',
      'A till sale makes the bill, issues it and records the money in one step, so it is an ordinary issued document with its own number and appears in your reports. A registered business gets a tax invoice. A composition dealer or unregistered seller gets a bill of supply.',
    ],
    steps: ['Open Items and turn on stock for an item.', 'Record stock that came in.', 'Open Till, scan or type an item, and take the money.', 'Choose Print receipt.'],
    related: ['customers-and-items', 'first-invoice'],
  },
  {
    slug: 'late-fees', title: 'Late fees on overdue invoices', category: 'Getting paid',
    summary: 'Kora prepares a late fee for you to read and issue. It never adds one by itself.',
    body: [
      'Open Settings and find Late fees to switch them on. Choose a percentage of what is owed per month, or a flat amount charged once, and set the grace days after the due date. You also choose the GST on the fee.',
      'Once on, an overdue invoice shows what has built up and offers a draft debit note. Nothing is charged to your customer until you read the draft and issue it like any other debit note, with its own number. Days that were already charged are never charged again.',
      'Whether GST applies to a late payment charge, and under which code, is for your CA to confirm.',
    ],
    steps: ['Open Settings and set up Late fees.', 'Open an overdue invoice and look at the late fee.', 'Check the draft debit note, then issue it.'],
    related: ['credit-and-debit-notes', 'payment-reminders'],
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
