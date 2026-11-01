import type { ToolPageInfo } from './toolPages';

/** Page copy for the GSTIN validator and the amount in words tool. Plain facts only, no made-up numbers. */
const FACTS: [string, string][] = [['100%', 'Free to use'], ['No signup', 'Start straight away'], ['On your device', 'Nothing is uploaded']];

const GSTIN: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Check a GSTIN in a second',
  lead: 'Paste a GSTIN to check its format and check character, and read the state, the PAN and the registration number inside it. Paste a list to check many.',
  cta: 'Check a GSTIN now',
  toolTitle: 'Validate a',
  toolAccent: 'GSTIN',
  stats: FACTS,
  about: {
    title: 'What is inside a',
    accent: 'GSTIN?',
    body: [
      'A GSTIN has 15 characters. The first two are the state code. The next ten are the PAN of the business. The 13th counts the registrations that PAN has in that state, starting at 1. The 14th is the letter Z for now. The last is a check character worked out from the other fourteen.',
      'Because of that check character, most typing mistakes can be caught without looking the number up. This page does that check for you, and says which part is wrong. Whether the business is actually registered and active can only be confirmed on the GST portal.',
    ],
  },
  steps: [
    ['Paste the GSTIN', 'Type or paste it. Spaces and dashes are ignored, and capital letters are added for you.'],
    ['Read the result', 'See if it is valid, and which part is wrong if not. A good one shows the state, PAN and holder type.'],
    ['Check a list', 'Paste many, one per line, and get a table with a result for each.'],
  ],
  features: [
    ['Says what is wrong', 'Wrong length, an unknown state code, a bad PAN, or a wrong last character, each in plain words.'],
    ['Reads the number', 'State, PAN, the kind of holder and the registration number.'],
    ['Many at once', 'Check up to 200 GSTINs in one go.'],
    ['Same rules as Kora', 'Uses the same check Kora applies when you save a customer.'],
  ],
  faq: [
    ['How do I check if a GSTIN is valid?', 'Paste it above. The tool checks the length, the state code, the PAN pattern, the letter Z and the check character. If all are right, the format is valid.'],
    ['Does this tell me if the business is registered?', 'No. A GSTIN can look correct and still not be registered, or have been cancelled. To confirm that, search the number on the GST portal.'],
    ['What do the 15 characters mean?', 'Two digits for the state, ten characters for the PAN, one for the registration number of that PAN in the state, the letter Z, and a check character.'],
    ['What does the fourth letter of the PAN mean?', 'It shows the type of holder: P for an individual, C for a company, F for a firm or LLP, H for a Hindu Undivided Family, A for an association of persons, T for a trust, B for a body of individuals, L for a local authority, J for an artificial juridical person and G for the government.'],
    ['Why does it say the last character is wrong?', 'The last character is calculated from the first fourteen. If one of them was mistyped, the calculated one will not match. The message shows what the last character should be, which helps you find the typing mistake.'],
    ['Is the GSTIN I type sent anywhere?', 'No. The check runs in your browser and nothing is uploaded.'],
  ],
  crossTitle: 'Never type a customer GSTIN wrong',
  crossText: 'Kora checks the GSTIN when you add a customer, and works out CGST and SGST or IGST on each invoice from the place of supply.',
};

const AMOUNT_WORDS: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Write rupees in words, lakh and crore',
  lead: 'Type an amount and get it in words in the Indian system, in English and in Hindi. Copy it into your invoice, cheque, receipt or letter.',
  cta: 'Convert an amount now',
  toolTitle: 'Convert an amount to',
  toolAccent: 'words',
  stats: FACTS,
  about: {
    title: 'Why write the amount',
    accent: 'in words?',
    body: [
      'Cheques, receipts, agreements and many invoices show the amount in words as well as in figures, because words are harder to alter. In India the words follow lakh and crore: 1,00,000 is one lakh and 1,00,00,000 is one crore, not a hundred thousand or ten million.',
      'This tool writes the amount that way. It uses the same wording as the amount in words on a Kora invoice, so what you copy matches what you would get from the app.',
    ],
  },
  steps: [
    ['Type the amount', 'Use rupees, with up to two decimals for paise. Commas are fine.'],
    ['Read the words', 'See the amount in English and in Hindi, with the figures grouped the Indian way.'],
    ['Copy', 'Press Copy next to the words you need and paste them where you want.'],
  ],
  features: [
    ['Indian system', 'Lakh and crore, not million and billion.'],
    ['English and Hindi', 'Both at once, each with its own copy button.'],
    ['Paise included', 'Amounts like 1,250.50 become "and Fifty Paise".'],
    ['Same as Kora', 'The English wording is the one used on Kora invoices.'],
  ],
  faq: [
    ['How do I write 1,25,000 in words?', 'It is One Lakh Twenty Five Thousand. Type it above and the tool writes it, then adds the "Rupees" and "Only".'],
    ['What is the difference between lakh and million?', 'One lakh is 1,00,000 (one hundred thousand). One crore is 1,00,00,000 (ten million). Indian grouping puts a comma after the first three digits from the right and then after every two.'],
    ['Why does the sentence end with Only?', 'It is the usual way to close an amount in words on a cheque or an invoice, so that nothing can be added after it.'],
    ['How big an amount can I use?', 'Up to Rs 999 crore. Beyond that, usage is not settled, so the tool asks you to check it by hand rather than guess.'],
    ['Is the Hindi correct?', 'It follows the standard Hindi number names, including the irregular ones from 11 to 99. Spelling of a few numbers varies in practice, so read it once before you print it on a legal paper.'],
    ['Does it send my amount anywhere?', 'No. The words are made in your browser.'],
  ],
  crossTitle: 'Invoices that write themselves',
  crossText: 'Kora puts the total in words on every invoice, works out the tax and keeps the numbers in order.',
};

export const NEW_PAGES: Record<string, ToolPageInfo> = { 'gstin-validator': GSTIN, 'amount-in-words': AMOUNT_WORDS };
