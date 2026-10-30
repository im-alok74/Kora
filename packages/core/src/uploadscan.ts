/**
 * A check on the bytes of an uploaded file, run after the type and size checks. It is NOT an antivirus: it catches the cheap, common tricks
 * (the standard virus-test string, PDFs that launch programs or carry other files inside, pictures with a web page or a program stuck on the
 * end) and nothing else. A real scanner (ClamAV or a hosted one) can be added behind this same function later.
 * Returns the sentence to show, or null when nothing was found.
 */
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const TEXT_TRICKS = /<script[\s>]|<\?php|<html[\s>]|<iframe[\s>]/i;
// What a program, an archive, another PDF or a script looks like when it is hidden after the end of a picture.
const TAIL_TRICKS = [Buffer.from('MZ'), Buffer.from('PK\x03\x04', 'latin1'), Buffer.from('%PDF'), Buffer.from('#!'), Buffer.from('\x7fELF', 'latin1')];

const flagged = 'This file looks unsafe, so it was not accepted. If it is a real document, save it again or send a photo of it.';

export function scanUpload(data: Buffer, type: string): string | null {
  if (data.includes(EICAR)) return flagged;
  if (type === 'application/pdf') {
    const t = data.toString('latin1');
    if (/\/Launch\b/.test(t) || /\/EmbeddedFile\b/.test(t) || /\/RichMedia\b/.test(t) || (/\/OpenAction\b/.test(t) && /\/(JavaScript|JS)\b/.test(t))) return flagged;
    return null;
  }
  // A picture ends at a known marker. Anything after it must not be code or another file.
  const end = type === 'image/png' ? findPngEnd(data) : data.lastIndexOf(Buffer.from([0xff, 0xd9])) >= 0 ? data.lastIndexOf(Buffer.from([0xff, 0xd9])) + 2 : -1;
  if (end >= 0) {
    const tail = data.subarray(end);
    if (tail.length > 0 && (TEXT_TRICKS.test(tail.toString('latin1')) || TAIL_TRICKS.some((sig) => tail.subarray(0, 4096).includes(sig)))) return flagged;
    return null;
  }
  // No end marker (a cut-off picture): only look for a web page or script anywhere in it.
  return TEXT_TRICKS.test(data.toString('latin1')) ? flagged : null;
}

function findPngEnd(data: Buffer): number {
  const i = data.lastIndexOf(Buffer.from('IEND'));
  return i >= 4 ? i + 8 : -1;   // the chunk name, then its 4-byte checksum
}
