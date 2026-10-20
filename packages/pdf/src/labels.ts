/**
 * The fixed words on a document, in the languages shops and firms ask for. Statutory terms (GSTIN, HSN/SAC, CGST, SGST, IGST, IRN) are
 * never translated, because the portal and the law use them as they are. The translations are written for ordinary business use; a firm
 * that needs exact legal wording should have its own words reviewed.
 */
export type Language = 'en' | 'hi' | 'mr' | 'gu';
export const LANGUAGES: Record<Language, string> = { en: 'English', hi: 'Hindi', mr: 'Marathi', gu: 'Gujarati' };

export interface Labels {
  tax_invoice: string; bill_of_supply: string; estimate: string; proforma: string; delivery_challan: string; credit_note: string; debit_note: string;
  billTo: string; placeOfSupply: string; shipTo: string; no: string; date: string; due: string; against: string;
  description: string; qty: string; rate: string; discount: string; taxable: string; taxableValue: string; total: string; amountDue: string;
  notes: string; terms: string; payTo: string; signatory: string; reverseCharge: string; scanToPay: string; roundOff: string; tdsLess: string; netPayable: string; inclusive: string;
  thanks: string; items: string; walkIn: string; reference: string; salesperson: string; paid: string;
}

const en: Labels = {
  tax_invoice: 'Tax Invoice', bill_of_supply: 'Bill of Supply', estimate: 'Estimate', proforma: 'Proforma Invoice', delivery_challan: 'Delivery Challan', credit_note: 'Credit Note', debit_note: 'Debit Note',
  billTo: 'Bill to', placeOfSupply: 'Place of supply', shipTo: 'Ship to', no: 'No.', date: 'Date', due: 'Due', against: 'Against',
  description: 'Description', qty: 'Qty', rate: 'Rate', discount: 'Disc.', taxable: 'Taxable', taxableValue: 'Taxable value', total: 'Total', amountDue: 'Amount due',
  notes: 'Notes', terms: 'Terms', payTo: 'Pay to', signatory: 'Authorised signatory', reverseCharge: 'Tax is payable on reverse charge.', scanToPay: 'Scan to pay', roundOff: 'Round off',
  tdsLess: 'Less: TDS to be deducted', netPayable: 'Net payable by customer', inclusive: 'incl. GST', thanks: 'Thank you. Visit again.', items: 'Items', walkIn: 'Walk-in customer',
  reference: 'Reference',
  salesperson: 'Salesperson',
  paid: 'Paid',
};

const hi: Labels = {
  tax_invoice: 'कर चालान', bill_of_supply: 'आपूर्ति का बिल', estimate: 'अनुमान (कोटेशन)', proforma: 'प्रोफार्मा चालान', delivery_challan: 'डिलीवरी चालान', credit_note: 'क्रेडिट नोट', debit_note: 'डेबिट नोट',
  billTo: 'बिल प्राप्तकर्ता', placeOfSupply: 'आपूर्ति का स्थान', shipTo: 'माल भेजने का पता', no: 'क्रमांक', date: 'दिनांक', due: 'देय तिथि', against: 'संदर्भ',
  description: 'विवरण', qty: 'मात्रा', rate: 'दर', discount: 'छूट', taxable: 'कर योग्य मूल्य', taxableValue: 'कर योग्य मूल्य', total: 'कुल', amountDue: 'देय राशि',
  notes: 'टिप्पणी', terms: 'शर्तें', payTo: 'भुगतान करें', signatory: 'अधिकृत हस्ताक्षरकर्ता', reverseCharge: 'इस पर कर का भुगतान रिवर्स चार्ज के अंतर्गत प्राप्तकर्ता द्वारा किया जाएगा।', scanToPay: 'भुगतान के लिए स्कैन करें', roundOff: 'पूर्णांक समायोजन',
  tdsLess: 'घटाएँ: काटा जाने वाला टीडीएस', netPayable: 'ग्राहक द्वारा देय शुद्ध राशि', inclusive: 'जीएसटी सहित', thanks: 'धन्यवाद। फिर पधारें।', items: 'सामान', walkIn: 'खुला ग्राहक',
  reference: 'ऑर्डर संदर्भ',
  salesperson: 'विक्रय प्रतिनिधि',
  paid: 'भुगतान हो चुका',
};

const mr: Labels = {
  tax_invoice: 'कर बीजक', bill_of_supply: 'पुरवठा बिल', estimate: 'अंदाजपत्रक', proforma: 'प्रोफॉर्मा बीजक', delivery_challan: 'डिलिव्हरी चलन', credit_note: 'क्रेडिट नोट', debit_note: 'डेबिट नोट',
  billTo: 'बिल प्राप्तकर्ता', placeOfSupply: 'पुरवठ्याचे ठिकाण', shipTo: 'माल पाठवण्याचा पत्ता', no: 'क्रमांक', date: 'दिनांक', due: 'देय तारीख', against: 'संदर्भ',
  description: 'तपशील', qty: 'प्रमाण', rate: 'दर', discount: 'सूट', taxable: 'करपात्र मूल्य', taxableValue: 'करपात्र मूल्य', total: 'एकूण', amountDue: 'देय रक्कम',
  notes: 'टीप', terms: 'अटी', payTo: 'येथे भरणा करा', signatory: 'अधिकृत स्वाक्षरीकर्ता', reverseCharge: 'या वरील कर रिव्हर्स चार्जअंतर्गत प्राप्तकर्त्याने भरावयाचा आहे.', scanToPay: 'भरण्यासाठी स्कॅन करा', roundOff: 'पूर्णांक समायोजन',
  tdsLess: 'वजा: कापला जाणारा टीडीएस', netPayable: 'ग्राहकाने भरावयाची निव्वळ रक्कम', inclusive: 'जीएसटीसह', thanks: 'धन्यवाद. पुन्हा भेट द्या.', items: 'वस्तू', walkIn: 'सामान्य ग्राहक',
  reference: 'ऑर्डर संदर्भ',
  salesperson: 'विक्रेता प्रतिनिधी',
  paid: 'पैसे मिळाले',
};

const gu: Labels = {
  tax_invoice: 'કર ઇન્વૉઇસ', bill_of_supply: 'પુરવઠાનું બિલ', estimate: 'અંદાજ', proforma: 'પ્રોફોર્મા ઇન્વૉઇસ', delivery_challan: 'ડિલિવરી ચલણ', credit_note: 'ક્રેડિટ નોટ', debit_note: 'ડેબિટ નોટ',
  billTo: 'બિલ મેળવનાર', placeOfSupply: 'પુરવઠાનું સ્થળ', shipTo: 'માલ મોકલવાનું સરનામું', no: 'ક્રમાંક', date: 'તારીખ', due: 'બાકી તારીખ', against: 'સંદર્ભ',
  description: 'વિગત', qty: 'જથ્થો', rate: 'દર', discount: 'ડિસ્કાઉન્ટ', taxable: 'કરપાત્ર મૂલ્ય', taxableValue: 'કરપાત્ર મૂલ્ય', total: 'કુલ', amountDue: 'ચૂકવવાપાત્ર રકમ',
  notes: 'નોંધ', terms: 'શરતો', payTo: 'અહીં ચૂકવો', signatory: 'અધિકૃત સહી કરનાર', reverseCharge: 'આ પર કર રિવર્સ ચાર્જ હેઠળ મેળવનારે ચૂકવવાનો છે.', scanToPay: 'ચૂકવવા સ્કેન કરો', roundOff: 'રાઉન્ડ ઑફ',
  tdsLess: 'બાદ: કપાતો ટીડીએસ', netPayable: 'ગ્રાહકે ચૂકવવાની ચોખ્ખી રકમ', inclusive: 'જીએસટી સહિત', thanks: 'આભાર. ફરી પધારજો.', items: 'વસ્તુઓ', walkIn: 'સામાન્ય ગ્રાહક',
  reference: 'ઓર્ડર સંદર્ભ',
  salesperson: 'વેચાણ પ્રતિનિધિ',
  paid: 'ચૂકવાઈ ગયું',
};

const ALL: Record<Language, Labels> = { en, hi, mr, gu };
export const labelsFor = (lang: unknown): Labels => ALL[(typeof lang === 'string' && lang in ALL ? lang : 'en') as Language];
/** A title in the chosen language, with the English name beside it so the document is still recognisable to a tax officer. */
export const titleFor = (lang: unknown, docType: string): string => {
  const l = labelsFor(lang);
  const key = docType as keyof Labels;
  const local = (l[key] as string | undefined) ?? en.tax_invoice;
  return l === en || local === (en[key] as string) ? local : `${local} / ${en[key] as string}`;
};
