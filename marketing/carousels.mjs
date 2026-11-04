// Carousel copy: Hinglish, CA-first, no price ("free to start"). Link in bio, because the domain is not bought yet.
// Claims are limited to what the product does today (docs/marketing-plan.md section 1). GST facts are general; each carousel says to confirm with your CA.
const handle = 'Kora · GST invoicing';

export const CAROUSELS = [
  {
    id: 'ca-clients', handle, foot: 'Link in bio',
    slides: [
      { kind: 'hook', title: 'Har mahine **client se data** maangte-maangte thak gaye?', sub: 'CA ke liye: ek screen pe saare clients.' },
      { chip: 'Problem', title: 'Pehle 10 tareekh tak ye sab chalta hai', points: ['WhatsApp pe bills ki **photos**', 'Excel files, har client ka **alag format**', '"Sir kal bhej dunga" — aur **deadline paas**'] },
      { chip: 'Ek screen', title: 'Saare clients, **ek jagah**', text: 'Kis client ka kya **overdue** hai, kya **due** hai, kaun sa kaam **kiske paas** atka hai — sab ek list mein.' },
      { chip: 'Documents', title: 'Client ko **upload link** bhejiye', text: 'Client link se bills aur files bhejta hai. Aapke **inbox** mein seedha aate hain — WhatsApp mein dhoondhna nahi.' },
      { chip: 'Review', title: '**Review ke baad hi** filing record', text: 'Kaam approve hone ke baad hi ARN aur acknowledgement file jodi ja sakti hai. Ye aapka apna record hai — Kora GST portal se check nahi karta.' },
      { chip: 'GST data', title: '**GSTR-1** ka data, saaf aur ready', text: 'Client ke invoices se GSTR-1 aur GSTR-3B ka **JSON export**. Return aap hi file karte hain, galti ka darr kam.' },
      { kind: 'cta', title: 'Apna pehla client **free** mein jodiye', text: 'Shuru karna free hai. Client ko bhi Kora pe laayiye — dono ka kaam halka.', button: 'Free mein shuru karein', note: 'CA firm hain? Comment mein "CA" likhein.' },
    ],
  },
  {
    id: 'invoice-5-things', handle, foot: 'Apne CA se confirm karein',
    slides: [
      { kind: 'hook', title: 'GST invoice mein ye **5 cheezein** zaroor hon', sub: 'Ek bhi chhooti, to customer ka input credit atak sakta hai.' },
      { chip: '1', title: '**GSTIN** — aapka aur customer ka', text: 'Registered customer ko bechte ho to uska GSTIN invoice pe likhna hota hai. **Galat GSTIN** = galat return.' },
      { chip: '2', title: 'Invoice number **ek ke baad ek**', text: 'Number mein **gap nahi**, repeat nahi. Har series aur financial year ka apna kram.' },
      { chip: '3', title: '**HSN / SAC** code', text: 'Har item ya service ka code. Rate isi se tay hota hai, GSTR-1 mein bhi yahi jaata hai.' },
      { chip: '4', title: 'Tax ka **sahi batwara**', text: 'Same state: **CGST + SGST**. Dusre state: **IGST**. Cess ho to alag line mein.' },
      { chip: '5', title: '**Place of supply**', text: 'Tax kis state ko jaayega, ye isi se tay hota hai. Isko galat bharna sabse aam galti hai.' },
      { kind: 'cta', title: 'Kora ye sab **khud check** karta hai', text: 'GSTIN ka checksum, HSN, CGST/SGST/IGST ka batwara — invoice banate waqt.', button: 'Free mein shuru karein', note: 'Ye jaankari aam hai. Apni situation ke liye CA se confirm karein.' },
    ],
  },
  {
    id: 'invoice-types', handle, foot: 'Apne CA se confirm karein',
    slides: [
      { kind: 'hook', title: '**Tax invoice**, **bill of supply**, **credit note** — kab kaun sa?', sub: 'Ek line mein samajh lijiye.' },
      { chip: 'Tax invoice', title: 'GST wali **taxable sale**', text: 'Aap regular GST registered ho aur taxable maal ya service bech rahe ho — **tax invoice** banta hai.' },
      { chip: 'Bill of supply', title: 'Jab **GST nahi** lagta', text: 'Composition dealer ya **exempt** maal/service par — tax invoice ki jagah **bill of supply**.' },
      { chip: 'Credit note', title: 'Invoice mein **kami** karni ho', text: 'Maal wapas aaya, discount diya, rate galat tha — **credit note** se value kam hoti hai.' },
      { chip: 'Debit note', title: 'Invoice mein **badhotri** karni ho', text: 'Value ya tax badhana ho to **debit note**. Purana invoice badla nahi jaata.' },
      { chip: 'Yaad rakhein', title: 'Issue hua invoice **edit nahi hota**', text: 'Sudhaar hamesha credit/debit note se. Kora mein issued invoice lock rehta hai, sudhaar note se hi hota hai.' },
      { kind: 'cta', title: 'Sahi document, **sahi number**', text: 'Kora har document ka alag series aur gapless number sambhalta hai.', button: 'Free mein shuru karein', note: 'Ye jaankari aam hai. Apni situation ke liye CA se confirm karein.' },
    ],
  },
];
