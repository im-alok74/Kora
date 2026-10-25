import type { ToolPageInfo } from './toolPages';

/** Page copy for the money calculators, and the related-tool links for every tool. Plain facts only, no made-up numbers. */
const FACTS: [string, string][] = [['100%', 'Free to use'], ['No signup', 'Start straight away'], ['On your device', 'Nothing is uploaded']];

const PROFIT: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Know your profit, margin and markup',
  lead: 'Type what an item costs and what you sell it for to see the profit, margin and markup. Or choose the margin or markup you want and get the selling price.',
  cta: 'Work out my margin',
  toolTitle: 'Calculate profit,',
  toolAccent: 'margin and markup',
  stats: FACTS,
  about: {
    title: 'Margin and markup are',
    accent: 'not the same',
    body: [
      'Both describe profit, but against different things. Markup is the profit as a share of what the item cost you. Margin is the profit as a share of the price you sell at. If something costs Rs 80 and sells for Rs 100, the profit is Rs 20, the markup is 25% and the margin is 20%.',
      'Mixing them up is a common reason a price comes out too low. If you want a 20% margin, adding 20% to the cost gives a margin of only 16.67%. This tool works the price out the right way for whichever you choose. The figures are before GST.',
    ],
  },
  steps: [
    ['Choose what to find', 'Profit, margin and markup from a cost and a price, or the price for a markup or a margin you want.'],
    ['Enter the numbers', 'Type the cost, and then the selling price or the percentage.'],
    ['Read the result', 'See profit, markup and margin together, and use the price in your quotation or invoice.'],
  ],
  features: [
    ['Margin and markup side by side', 'See both for the same sale so you do not mix them up.'],
    ['Price from the percentage', 'Say the margin or markup you want and get the selling price.'],
    ['Shows a loss too', 'If you sell below cost, the result says loss and shows the negative percentages.'],
    ['Private', 'The sum runs in your browser and nothing is sent anywhere.'],
  ],
  faq: [
    ['What is the difference between margin and markup?', 'Markup is profit divided by cost. Margin is profit divided by the selling price. For a cost of Rs 80 and a price of Rs 100, markup is 25% and margin is 20%.'],
    ['How do I work out profit margin?', 'Margin percent = (selling price - cost) / selling price x 100. For Rs 80 cost and Rs 100 price, that is 20 / 100 x 100 = 20%.'],
    ['How do I find the price for a 30% margin?', 'Price = cost / (1 - margin). At a cost of Rs 70 and a margin of 30%, the price is 70 / 0.7 = Rs 100.'],
    ['Is GST included?', 'No. The figures are before GST. Work out the selling price first, then add GST with the GST calculator.'],
    ['Can the margin be 100%?', 'No. A 100% margin would mean the item cost nothing. The tool asks for a margin below 100%.'],
    ['Is what I type sent anywhere?', 'No. It is worked out in your browser.'],
  ],
  crossTitle: 'Know what you earn on every sale',
  crossText: 'Kora keeps your items with their prices, works out the tax, and shows your sales in reports your CA can use.',
};

const EMI: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Find the monthly instalment on a business loan',
  lead: 'Enter the loan amount, the yearly interest rate and the time to see the monthly EMI on a business or equipment loan, the total interest and how the first months split between interest and principal.',
  cta: 'Calculate my EMI',
  toolTitle: 'Calculate your',
  toolAccent: 'business loan EMI',
  stats: FACTS,
  about: {
    title: 'How an EMI is',
    accent: 'worked out',
    body: [
      'An EMI (equated monthly instalment) is the fixed amount you pay each month on a loan. Early on, most of it is interest, because interest is charged on the balance still owed. As the balance falls, more of each instalment goes to the principal.',
      'The formula is EMI = P x r x (1 + r)^n / ((1 + r)^n - 1), where P is the loan, r is the monthly rate (the yearly rate divided by 12 and by 100) and n is the number of months. A lender may add processing fees or round differently, so use the result as a close guide and check the sanction letter.',
    ],
  },
  steps: [
    ['Enter the loan', 'Type the loan amount and the yearly interest rate.'],
    ['Set the time', 'Choose years or months and type how long the loan runs.'],
    ['Read the result', 'See the monthly EMI, the total interest, the total repaid and the first twelve months.'],
  ],
  features: [
    ['Reducing balance', 'Interest is worked on the balance left, as most bank loans do.'],
    ['Total cost of the loan', 'See how much interest you pay over the whole term.'],
    ['First months in a table', 'Interest, principal and balance for each of the first twelve months.'],
    ['Private', 'Nothing you type is sent anywhere.'],
  ],
  faq: [
    ['How is EMI calculated?', 'EMI = P x r x (1 + r)^n / ((1 + r)^n - 1). P is the loan amount, r the monthly interest rate and n the number of months.'],
    ['What is the EMI for a 10 lakh loan at 9% for 20 years?', 'About Rs 8,997 a month. Type the numbers above to see the exact figure and the total interest.'],
    ['Why is the first instalment mostly interest?', 'Interest is charged on the balance you owe, and the balance is highest at the start. Each payment lowers it, so later instalments carry less interest.'],
    ['Does it work for a business loan?', 'Yes, for any loan that is repaid in equal monthly instalments on a reducing balance. It does not cover loans with a balloon payment or a changing rate.'],
    ['Will my bank show the same number?', 'It should be very close. Fees, insurance, rounding and the day interest starts can make the bank figure differ by a little.'],
    ['Is my data sent anywhere?', 'No. The calculation runs in your browser.'],
  ],
  crossTitle: 'Get paid on time, so loans are easier',
  crossText: 'Kora sends payment links and reminders, and matches each payment to its invoice, which keeps your cash flow steady.',
};

const INTEREST: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Interest on an overdue invoice, a loan or a deposit',
  lead: 'Work out the interest on an amount over days, months or years, either simple or compounded yearly, half-yearly, quarterly or monthly. Use days to price a late payment.',
  cta: 'Calculate interest',
  toolTitle: 'Calculate',
  toolAccent: 'interest',
  stats: FACTS,
  about: {
    title: 'Simple or compound:',
    accent: 'what changes?',
    body: [
      'With simple interest, the interest is always worked on the original amount: amount x rate x years / 100. With compound interest, interest is added to the amount at each period and the next interest is worked on the larger sum, so it grows faster.',
      'The more often interest is compounded in a year, the higher the total. For example, Rs 1,00,000 at 12% for one year gives Rs 12,000 as simple interest, and Rs 12,550.88 compounded quarterly.',
      'For a customer who pays late, choose days and simple interest: Rs 1,00,000 overdue for 30 days at 18% a year is Rs 1,479.45 (a year counted as 365 days). Your agreement or your terms on the invoice decide whether you can charge interest and at what rate, so settle that before you work it out. Late payment interest can attract GST, so ask your CA how to bill it.',
    ],
  },
  steps: [
    ['Choose the type', 'Simple or compound. For compound, pick how often it is compounded.'],
    ['Enter the numbers', 'Type the amount, the yearly rate and the time in years.'],
    ['Read the result', 'See the interest and the total, and copy them.'],
  ],
  features: [
    ['Both types', 'Switch between simple and compound for the same numbers.'],
    ['Any compounding', 'Yearly, half-yearly, quarterly or monthly.'],
    ['Exact to the paisa', 'Results are rounded to the nearest paisa.'],
    ['Private', 'Worked out in your browser and never sent.'],
  ],
  faq: [
    ['What is the formula for simple interest?', 'Simple interest = amount x rate x years / 100. For Rs 1,00,000 at 8% for 3 years that is Rs 24,000.'],
    ['What is the formula for compound interest?', 'Total = amount x (1 + rate / (100 x n)) ^ (n x years), where n is how many times a year interest is added. Interest is the total minus the amount.'],
    ['Which is better for a saver?', 'Compound, at the same rate, since interest earns interest. For a borrower it is the other way round.'],
    ['Can I use days or months?', 'Yes. Choose days, months or years under "Time is in". For an overdue invoice, type the days between the due date and the day it was paid.'],
    ['Is this the same as my bank deposit?', 'It is a close guide. Banks may use a different compounding or day-count rule, so check with the bank.'],
    ['Is my data sent anywhere?', 'No. Everything is worked out in your browser.'],
  ],
  crossTitle: 'Keep due dates in front of you',
  crossText: 'Kora keeps due dates and payment reminders on every invoice, so you know who owes what and since when.',
};

export const CALC_PAGES: Record<string, ToolPageInfo> = { 'profit-margin-calculator': PROFIT, 'emi-calculator': EMI, 'interest-calculator': INTEREST };

/** Related tools by slug: shown as links under the steps on each tool page, so the tools link to each other in the text. */
export const RELATED: Record<string, string[]> = {
  'gst-calculator': ['invoice-generator', 'profit-margin-calculator', 'amount-in-words'],
  'invoice-generator': ['gst-calculator', 'gstin-validator', 'amount-in-words', 'qr-code-generator'],
  'quotation-maker': ['gst-calculator', 'profit-margin-calculator', 'invoice-generator'],
  'proforma-invoice-generator': ['invoice-generator', 'gst-calculator', 'gstin-validator'],
  'purchase-order-generator': ['gstin-validator', 'gst-calculator', 'invoice-generator'],
  'receipt-maker': ['amount-in-words', 'invoice-generator', 'interest-calculator'],
  'qr-code-generator': ['qr-code-scanner', 'invoice-generator', 'receipt-maker'],
  'barcode-generator': ['barcode-scanner', 'qr-code-generator'],
  'qr-code-scanner': ['qr-code-generator', 'barcode-scanner'],
  'barcode-scanner': ['barcode-generator', 'qr-code-scanner'],
  'logo-maker': ['invoice-generator', 'quotation-maker', 'qr-code-generator'],
  'gstin-validator': ['invoice-generator', 'gst-calculator', 'purchase-order-generator'],
  'amount-in-words': ['receipt-maker', 'invoice-generator', 'gst-calculator'],
  'profit-margin-calculator': ['gst-calculator', 'quotation-maker', 'emi-calculator'],
  'emi-calculator': ['interest-calculator', 'profit-margin-calculator'],
  'interest-calculator': ['emi-calculator', 'receipt-maker', 'profit-margin-calculator'],
};
