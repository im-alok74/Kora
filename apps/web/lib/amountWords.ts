import { parseRupees, rupeesInWords, TaxError } from '@kora/tax';

/** Largest amount the wording supports: Rs 999 crore. Beyond it Indian usage is not settled, so we refuse rather than guess. */
export const MAX_RUPEES = 9_999_999_999n;

const HI = ['शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ', 'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस',
  'बीस', 'इक्कीस', 'बाईस', 'तेईस', 'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताईस', 'अट्ठाईस', 'उनतीस',
  'तीस', 'इकतीस', 'बत्तीस', 'तैंतीस', 'चौंतीस', 'पैंतीस', 'छत्तीस', 'सैंतीस', 'अड़तीस', 'उनतालीस',
  'चालीस', 'इकतालीस', 'बयालीस', 'तैंतालीस', 'चौंतालीस', 'पैंतालीस', 'छियालीस', 'सैंतालीस', 'अड़तालीस', 'उनचास',
  'पचास', 'इक्यावन', 'बावन', 'तिरपन', 'चौवन', 'पचपन', 'छप्पन', 'सत्तावन', 'अट्ठावन', 'उनसठ',
  'साठ', 'इकसठ', 'बासठ', 'तिरसठ', 'चौंसठ', 'पैंसठ', 'छियासठ', 'सड़सठ', 'अड़सठ', 'उनहत्तर',
  'सत्तर', 'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छिहत्तर', 'सतहत्तर', 'अठहत्तर', 'उनासी',
  'अस्सी', 'इक्यासी', 'बयासी', 'तिरासी', 'चौरासी', 'पचासी', 'छियासी', 'सत्तासी', 'अट्ठासी', 'नवासी',
  'नब्बे', 'इक्यानवे', 'बानवे', 'तिरानवे', 'चौरानवे', 'पंचानवे', 'छियानवे', 'सत्तानवे', 'अट्ठानवे', 'निन्यानवे'];

/** 0 to 999 in Hindi. */
const hi1000 = (n: number) => [n >= 100 ? `${HI[Math.floor(n / 100)]} सौ` : '', n % 100 ? HI[n % 100]! : ''].filter(Boolean).join(' ');

/** Whole rupees in Hindi, Indian grouping: करोड़, लाख, हज़ार, सौ. Defined for 0 to 9,999,999,999. */
export function hindiNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > Number(MAX_RUPEES)) throw new RangeError('out of range');
  if (n === 0) return HI[0]!;
  const crore = Math.floor(n / 1e7), lakh = Math.floor((n % 1e7) / 1e5), thou = Math.floor((n % 1e5) / 1e3), rest = n % 1e3;
  return [crore ? `${hi1000(crore)} करोड़` : '', lakh ? `${HI[lakh]} लाख` : '', thou ? `${HI[thou]} हज़ार` : '', rest ? hi1000(rest) : ''].filter(Boolean).join(' ');
}

export type Words = { ok: true; paise: bigint; english: string; hindi: string; digits: string } | { ok: false; error: string };

/** "1,23,456.50" -> the amount in words, English and Hindi, in the Indian system. */
export function amountToWords(input: string): Words {
  const t = input.trim().replace(/^(?:rs\.?|inr|₹)\s*/i, '');
  if (!t) return { ok: false, error: 'Enter an amount.' };
  let paise: bigint;
  try { paise = parseRupees(t); } catch (e) {
    if (/^-/.test(t)) return { ok: false, error: 'The amount cannot be negative.' };
    return { ok: false, error: e instanceof TaxError ? 'Enter the amount as a number, like 1250 or 1,25,000.50 (at most 2 decimals).' : 'Enter the amount as a number.' };
  }
  if (paise / 100n > MAX_RUPEES) return { ok: false, error: 'This tool goes up to Rs 999 crore (9,99,99,99,999).' };
  const rupees = Number(paise / 100n), ps = Number(paise % 100n);
  const parts: string[] = [];
  if (rupees > 0 || ps === 0) parts.push(`${hindiNumber(rupees)} ${rupees === 1 ? 'रुपया' : 'रुपये'}`);
  if (ps > 0) parts.push(`${hindiNumber(ps)} ${ps === 1 ? 'पैसा' : 'पैसे'}`);
  const whole = String(rupees).replace(/\B(?=(\d{2})*\d{3}$)/g, ',');
  return { ok: true, paise, english: rupeesInWords(paise), hindi: `${parts.join(' और ')} केवल`, digits: `Rs ${whole}.${String(ps).padStart(2, '0')}` };
}
