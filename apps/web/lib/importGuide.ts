// What to export from each product, in general words. Menus change between versions, so we describe what to look for, not exact clicks.
export type ImportSource = { id: string; name: string; file: string; fileNote: string; steps: string[]; brings: string[]; notBrought: string[] };

export const IMPORT_SOURCES: ImportSource[] = [
  {
    id: 'zoho', name: 'Zoho Invoice or Zoho Books', file: 'CSV or Excel', fileNote: 'Export from the Customers, Items and Invoices lists.',
    steps: ['In Zoho, open the list you want (Customers, Items or Invoices).', 'Look for the export option in the list menu and choose CSV or Excel.', 'Open the file once to check it has a heading row.', 'Upload it in Kora and look at the preview before you confirm.'],
    brings: ['Customers with GSTIN, state, phone and email', 'Items with rate, HSN or SAC and GST rate', 'Invoices as drafts for you to check'],
    notBrought: ['Payments recorded against old invoices', 'Files and attachments'],
  },
  {
    id: 'vyapar', name: 'Vyapar', file: 'Excel', fileNote: 'Export party details, item details and sale reports as Excel.',
    steps: ['In Vyapar, open the reports or export section.', 'Export your party list, your item list and, if you want them, your sale invoices as Excel.', 'Open each file and make sure the first row is the heading row.', 'Upload each file in Kora and check the preview.'],
    brings: ['Customers with GSTIN and contact details', 'Items with rate and tax', 'Sale invoices as drafts'],
    notBrought: ['Stock counts and past stock movements', 'Payments recorded against old invoices'],
  },
  {
    id: 'tally', name: 'Tally', file: 'Ledger file (XML)', fileNote: 'Export your ledgers from Tally. Kora reads the customers in it.',
    steps: ['In Tally, export your ledger master as an XML file.', 'In Kora, choose to import Customers and pick the Tally file.', 'Kora picks out the parties and shows a preview.', 'Confirm, then check a few customers against Tally.'],
    brings: ['Customer ledgers with GSTIN and state where Tally has them'],
    notBrought: ['Vouchers and old transactions', 'Items and stock'],
  },
  {
    id: 'excel', name: 'Any spreadsheet', file: 'CSV or Excel', fileNote: 'Your own list works too.',
    steps: ['Make one row per customer or per item, with a heading row on top.', 'For customers use headings such as Name, GSTIN, State, Mobile, Email. For items use Name, Rate, HSN or SAC, GST rate.', 'Save as CSV or Excel.', 'Upload it in Kora and check the preview. Rows with a problem are left out and explained.'],
    brings: ['Customers and items from your own sheet', 'Invoices as drafts, if your sheet has an invoice number, customer, item and rate on each row'],
    notBrought: ['Anything not in the sheet'],
  },
];
