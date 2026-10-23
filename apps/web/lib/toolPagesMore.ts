import type { ToolPageInfo } from './toolPages';

/** Page copy for the PDF, picture and text tools. Plain facts only, no made-up numbers. */
const FACTS: [string, string][] = [['100%', 'Free to use'], ['No signup', 'Start straight away'], ['On your device', 'Nothing is uploaded']];
const PRIVATE_FACTS: [string, string][] = [['100%', 'Free to use'], ['No signup', 'Start straight away'], ['Never uploaded', 'Files stay on your device']];

const PDF_TO_IMAGE: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Turn PDF pages into pictures',
  lead: 'Choose a PDF and save each page as a PNG or JPG picture. Pick the sharpness, take just the pages you need, and download one picture or all of them in a ZIP file.',
  cta: 'Convert a PDF now',
  toolTitle: 'Convert a PDF to',
  toolAccent: 'images',
  stats: PRIVATE_FACTS,
  about: {
    title: 'When do you need a PDF as',
    accent: 'a picture?',
    body: [
      'Many places take a picture but not a PDF: a WhatsApp status, a product listing, a form that asks for a scanned proof, or a slide. Turning the page into a PNG or JPG gets it there without a screenshot that cuts off the edges.',
      'This tool draws each page inside your browser and saves it at the sharpness you choose. Nothing is sent to a server, so a bank statement, an invoice or an ID proof stays on your device.',
    ],
  },
  steps: [
    ['Choose your PDF', 'Pick the file or drop it on the box. If it is password protected, the tool asks for the password.'],
    ['Pick the format and sharpness', 'PNG keeps text crisp. JPG makes smaller files. Choose all pages or a range such as 1-3, 5.'],
    ['Download', 'Save one picture, or all pages together in a ZIP file.'],
  ],
  features: [
    ['PNG or JPG', 'PNG for sharp text and line art, JPG when a smaller file matters more.'],
    ['Choose the sharpness', 'From 100 dpi for the screen up to 300 dpi for print.'],
    ['Only the pages you need', 'Type a range like 2-4, 7 to skip the rest.'],
    ['Private', 'The PDF is drawn in your browser. It is never uploaded.'],
  ],
  faq: [
    ['Is it safe to use with a private document?', 'Yes. The PDF is opened and drawn inside your browser and is not sent anywhere.'],
    ['Does it work with a password protected PDF?', 'Yes, if you know the password. Type it when asked and the pages are drawn as usual. The password is used only in your browser to open the file.'],
    ['Which should I choose, PNG or JPG?', 'Choose PNG for pages with text, tables or logos, since it keeps edges sharp. Choose JPG for photos or when you need a smaller file.'],
    ['What do the dpi choices mean?', 'Dots per inch. 100 is fine for the screen, 150 suits most sharing, 200 is high and 300 is a print quality. Higher means a larger picture and a bigger file.'],
    ['Is there a limit on the size?', 'A PDF can be up to 100 MB and up to 100 pages are turned into pictures at a time. For a longer file, run it in parts using a page range. Very large pages are drawn a little smaller so the browser does not run out of memory, and the page tells you when that happens.'],
    ['Why is my picture blank or wrong?', 'A few PDFs use features a browser cannot draw. If a page looks wrong, try opening the PDF in another viewer and printing it to a new PDF, then convert that.'],
  ],
  crossTitle: 'Keep your documents tidy',
  crossText: 'Kora creates GST invoices as PDFs for you, numbers them in order and keeps every one in one place, so you do not hunt through files.',
};

const IMAGE_CONVERTER: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Switch between JPG, PNG and WebP',
  lead: 'Convert pictures from one format to another in your browser. Add one picture or a batch, set the quality, and download them one by one or in a ZIP file.',
  cta: 'Convert pictures now',
  toolTitle: 'Convert',
  toolAccent: 'images',
  stats: PRIVATE_FACTS,
  about: {
    title: 'JPG, PNG or WebP:',
    accent: 'which one?',
    body: [
      'JPG is the usual choice for photos: files are small, and every device opens them. PNG is lossless and keeps transparency, which suits logos, screenshots and text. WebP is newer and usually gives smaller files than both, and most current browsers and apps support it, although some older software does not.',
      'Converting does not make a picture sharper. Going from JPG to PNG gives a larger file with the same detail, and going from PNG to JPG drops transparency, so transparent areas turn white.',
    ],
  },
  steps: [
    ['Add your pictures', 'Choose JPG, PNG or WebP files, or drop them on the box. You can add up to 30 at once.'],
    ['Choose the new format', 'Pick JPG, PNG or WebP. For JPG and WebP, set the quality with the slider.'],
    ['Convert and download', 'Save each picture, or all of them together as a ZIP file.'],
  ],
  features: [
    ['Batch conversion', 'Convert many pictures in one go and download them as one ZIP file.'],
    ['Quality control', 'Trade a little detail for a much smaller file, or keep it high.'],
    ['Phone photos stay upright', 'Pictures taken sideways on a phone are turned the right way up.'],
    ['Private', 'Pictures are converted in your browser and are never uploaded.'],
  ],
  faq: [
    ['Are my pictures uploaded?', 'No. They are converted inside your browser by your own device. Nothing is sent to us or anyone else.'],
    ['Will I lose quality?', 'PNG output loses nothing. JPG and WebP are lossy, so a lower quality setting gives a smaller file with a little less detail. A setting of 80 to 90 percent usually looks the same to the eye.'],
    ['What happens to a transparent PNG when I make a JPG?', 'JPG cannot be transparent, so the transparent parts become white.'],
    ['Why does my WebP not open in some software?', 'Some older programs do not know WebP. If you need to share a picture widely, convert it to JPG or PNG.'],
    ['What are the limits?', 'Up to 30 pictures at a time, each up to 25 MB and up to 50 megapixels. A picture that is too large is skipped with a message that names it, and the rest carry on.'],
    ['Can I convert a PDF to pictures?', 'Yes, with the PDF to Image Converter, which turns each page into a PNG or JPG.'],
  ],
  crossTitle: 'Put your logo on every invoice',
  crossText: 'Kora puts your logo, GSTIN and bank details on each invoice, in a clean layout, and sends it on WhatsApp.',
};

const IMAGE_COMPRESSOR: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Make a picture smaller, to the KB',
  lead: 'Shrink a picture to a file size you choose, such as 150 KB, or set an exact width and height. See before and after side by side, then download.',
  cta: 'Shrink a picture now',
  toolTitle: 'Compress and resize an',
  toolAccent: 'image',
  stats: PRIVATE_FACTS,
  about: {
    title: 'Why a picture has to be',
    accent: 'under a size limit',
    body: [
      'Forms, portals, email and apps often turn away a picture that is too large, and say so only after you have tried. This tool works toward a limit you set: it lowers the quality a little at a time, and makes the picture smaller only when quality alone is not enough.',
      'For Kora, a business logo must be a PNG or JPG under 150 KB. The one-click button sets that up, so you can add your logo to every invoice without trial and error.',
    ],
  },
  steps: [
    ['Choose a picture', 'Pick a JPG, PNG or WebP file, or drop it on the box.'],
    ['Set the limit', 'Type the largest size in KB, or switch to width and height. Or tap the Kora invoice logo button for under 150 KB.'],
    ['Compare and download', 'Check the before and after, then download the smaller picture.'],
  ],
  features: [
    ['Target a size in KB', 'Say how big the file may be and the tool finds the best quality that fits.'],
    ['Exact dimensions', 'Set a width and height in pixels, with the proportions kept if you wish.'],
    ['Before and after', 'See both pictures and both sizes before you download.'],
    ['Private', 'The picture is processed in your browser and never uploaded.'],
  ],
  faq: [
    ['How do I reduce a picture to under 150 KB?', 'Choose the picture, leave the mode on Target file size, type 150 and press Make it smaller. Or use the Kora invoice logo button, which does the same in one tap.'],
    ['Why is a PNG harder to shrink than a JPG?', 'PNG is lossless, so there is no quality to lower. For a PNG the tool can only make the picture smaller in pixels. If the size matters more than transparency, save it as JPG or WebP.'],
    ['Will the picture look worse?', 'Lowering quality removes fine detail, and making it smaller removes pixels. The tool tries the highest quality first and shows you the result so you can judge it before you save.'],
    ['What if it cannot reach my size?', 'It makes the picture smaller in steps, and if even that is not enough it tells you and gives you the smallest it could make. Try a higher limit or a different format.'],
    ['Does it keep the picture the right way up?', 'Yes. Photos taken sideways on a phone are turned upright first.'],
    ['Are my pictures uploaded?', 'No. Everything happens in your browser. The limits are 25 MB and 50 megapixels for one picture, to keep your device from running out of memory.'],
  ],
  crossTitle: 'Your logo, on every invoice',
  crossText: 'Once your logo is under 150 KB, add it in Kora and it appears on every invoice, quotation and receipt you send.',
};

const IMAGES_TO_PDF: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Combine pictures into one PDF',
  lead: 'Put photos, scans and screenshots into a single PDF. Arrange the pages, choose A4 or fit-to-picture, set the margin and download it.',
  cta: 'Make a PDF now',
  toolTitle: 'Convert pictures to a',
  toolAccent: 'PDF',
  stats: PRIVATE_FACTS,
  about: {
    title: 'One PDF is easier to',
    accent: 'send and keep',
    body: [
      'Ten photos of a bill, a form or a signed page are awkward to send. A single PDF opens the same on every phone and computer and keeps the pages in order. It is also the format most portals and offices ask for.',
      'Each picture becomes one page. You can fit them to A4, let each page match its picture, or add a margin so nothing is cut off when printed.',
    ],
  },
  steps: [
    ['Add your pictures', 'Choose JPG, PNG or WebP files, up to 50. Photos from your phone are turned the right way up.'],
    ['Arrange and set the page', 'Use Up and Down to put the pages in order, then choose the page size, margin and quality.'],
    ['Make the PDF', 'Press the button and download the PDF.'],
  ],
  features: [
    ['Your order', 'Move pages up and down, or remove one, before you make the PDF.'],
    ['A4 or fit to picture', 'A4 turns to portrait or landscape to suit each picture. Or each page can match its picture.'],
    ['Margins and quality', 'Choose a margin, and a picture quality from large and sharp to small for email.'],
    ['Private', 'Your pictures are put into the PDF in your browser and are never uploaded.'],
  ],
  faq: [
    ['Are my pictures uploaded?', 'No. The PDF is built in your browser. Nothing leaves your device.'],
    ['Can I change the order of the pages?', 'Yes. Use the Up and Down buttons next to each picture, or Remove to take one out. The PDF follows the order of the list.'],
    ['Will the pictures be stretched?', 'No. Each picture is scaled to fit inside the page and margins and is centred, with its shape kept.'],
    ['How do I keep the PDF small?', 'Choose the Medium or Small picture quality. Pictures are reduced to a size that is still clear on screen and in print, and saved as JPG inside the PDF.'],
    ['What happens to transparent areas?', 'They are shown white, since the pictures are saved as JPG inside the PDF.'],
    ['How many pictures can I add?', 'Up to 50 at a time, each up to 25 MB and 50 megapixels. A picture that is not readable is named in the message so you can remove it.'],
  ],
  crossTitle: 'Stop scanning bills by hand',
  crossText: 'Kora makes the invoice for you as a PDF the moment you save, and keeps a copy you can send again.',
};

const MERGE_SPLIT: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Merge, split and rotate PDFs',
  lead: 'Join several PDFs into one, pull out the pages you want, split a PDF into parts or turn pages the right way up. It all happens in your browser.',
  cta: 'Work on a PDF now',
  toolTitle: 'Merge, split or rotate a',
  toolAccent: 'PDF',
  stats: PRIVATE_FACTS,
  about: {
    title: 'The PDF jobs that come up',
    accent: 'again and again',
    body: [
      'You get an invoice, a statement and a receipt as three files and need to send one. Or you have a 40 page scan and need to share only pages 3 to 6. Or a scan came out sideways. These are small jobs that should not need an account or an upload.',
      'This tool does them on your device. Because the PDF never leaves your browser, it is safe for bank statements, tax papers and agreements.',
    ],
  },
  steps: [
    ['Choose what to do', 'Merge PDFs, split or extract pages, or rotate pages.'],
    ['Add your PDF and set it up', 'For a merge, add the files and put them in order. Otherwise type the pages, like 1-3, 5, 8-.'],
    ['Download', 'Save the new PDF, or all the parts together in a ZIP file.'],
  ],
  features: [
    ['Merge in any order', 'Add up to 20 PDFs and arrange them with the Up and Down buttons.'],
    ['Extract or split', 'Pull pages into one new PDF, make one file per range, or one for every page.'],
    ['Rotate', 'Turn all pages or only some by 90, 180 or 270 degrees.'],
    ['Private', 'Your PDFs are changed in your browser and are never uploaded.'],
  ],
  faq: [
    ['Are my PDFs uploaded?', 'No. They are read and changed inside your browser. Nothing is sent to a server.'],
    ['How do I type the pages?', 'Use numbers and ranges separated by commas, like 1-3, 5, 8-. The last page can be left open, so 8- means page 8 to the end. For extracting, the pages come out in the order you type them, so 3,1 puts page 3 first.'],
    ['What if my PDF has a password?', 'This tool cannot open a protected PDF and says so by name. Open it with its password in a PDF viewer, save or print an unprotected copy, and add that.'],
    ['Will the text and quality stay the same?', 'Yes. Pages are copied as they are, not redrawn, so text stays sharp and searchable. The file size can differ a little.'],
    ['What are the limits?', 'Each PDF up to 100 MB, up to 20 PDFs in a merge, and 300 MB in all, so your browser does not run out of memory.'],
    ['Can I add a page number or a signature?', 'Not here. This tool only joins, splits, extracts and rotates.'],
  ],
  crossTitle: 'Send one clean document',
  crossText: 'With Kora, an invoice, its payment link and its reminders go out together, and you never have to merge anything.',
};

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

const WORD_COUNTER: ToolPageInfo = {
  badge: 'Free, no signup',
  highlight: 'Count words and find your keywords',
  lead: 'Paste your product description or page copy to see words, characters, sentences and reading time, and which words and phrases you use most, with the density of each.',
  cta: 'Count my words now',
  toolTitle: 'Count words and check',
  toolAccent: 'keyword density',
  stats: FACTS,
  about: {
    title: 'What is keyword',
    accent: 'density?',
    body: [
      'Keyword density is how many times a word or phrase appears, divided by the total number of words, shown as a percent. If "cotton kurta" appears 3 times in a 150 word description, its density is 2%.',
      'Search engines do not publish a target density, so treat it as a guide for spotting a word you repeat too much, not as a goal. Write for the person reading first, and use the list to check that your main topic shows up and that no word is stuffed in.',
    ],
  },
  steps: [
    ['Paste your text', 'Type or paste your copy. The counts update as you go.'],
    ['Read the numbers', 'See words, characters, sentences, paragraphs and how long it takes to read.'],
    ['Check the keywords', 'See the top words and two and three word phrases. Common words like "the" are skipped unless you turn that off.'],
  ],
  features: [
    ['Counts that update live', 'Words, characters with and without spaces, sentences, paragraphs.'],
    ['Reading and speaking time', 'Based on 200 and 130 words a minute.'],
    ['Keywords and phrases', 'One, two and three word phrases with how often and what percent.'],
    ['Private', 'Your text is counted in your browser and never uploaded.'],
  ],
  faq: [
    ['How is keyword density worked out?', 'The number of times a word or phrase appears, divided by the total words, times 100. A phrase counts each time it appears as a whole.'],
    ['What is a good keyword density?', 'There is no number that search engines ask for. Use the tool to catch a word you overuse, and write naturally.'],
    ['What does skip common words do?', 'It leaves out words like the, and, of and for from the keyword list, and stops phrases from starting or ending with them, so the list shows the words that carry meaning.'],
    ['How is reading time estimated?', 'Words divided by 200 words a minute, which is a typical adult reading speed. Speaking time uses 130 words a minute.'],
    ['Does it work for Hindi or other languages?', 'It counts words in any language that puts spaces between words, including Hindi. The common-word list is English only.'],
    ['Is my text sent to a server?', 'No. It is counted in your browser and goes nowhere.'],
  ],
  crossTitle: 'Descriptions that sell, items that stay tidy',
  crossText: 'Once the copy is ready, Kora keeps your items, prices and stock together so every invoice uses the same description.',
};

export const NEW_PAGES: Record<string, ToolPageInfo> = {
  'pdf-to-image': PDF_TO_IMAGE, 'image-converter': IMAGE_CONVERTER, 'image-compressor': IMAGE_COMPRESSOR, 'images-to-pdf': IMAGES_TO_PDF,
  'merge-split-pdf': MERGE_SPLIT, 'gstin-validator': GSTIN, 'amount-in-words': AMOUNT_WORDS, 'word-counter': WORD_COUNTER,
};
