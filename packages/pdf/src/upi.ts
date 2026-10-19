import QRCode from 'qrcode';
import { formatRupees } from '@kora/tax';

/**
 * A UPI deep link (NPCI linking spec): pa payee address, pn payee name, am amount in rupees, tn note, cu currency.
 * The amount is fixed in the code, so the customer pays exactly what is still due.
 */
export function upiUri(a: { vpa: string; name: string; amountPaise: bigint; note: string }): string {
  if (!/^[a-zA-Z0-9._-]{2,100}@[a-zA-Z]{2,64}$/.test(a.vpa)) throw new Error('Invalid UPI address');
  const rupees = `${a.amountPaise / 100n}.${(a.amountPaise % 100n).toString().padStart(2, '0')}`;
  const q = new URLSearchParams({ pa: a.vpa, pn: a.name.slice(0, 60), am: rupees, cu: 'INR', tn: a.note.slice(0, 40) });
  return `upi://pay?${q.toString().replace(/\+/g, '%20')}`;
}

export interface UpiBlock { qrDataUrl: string; vpa: string; amountText: string }

/** A QR image for the amount still due, or null when there is nothing to collect or no UPI address. */
export async function upiBlockFor(a: { vpa: string | null | undefined; name: string; outstandingPaise: bigint; number: string }): Promise<UpiBlock | null> {
  if (!a.vpa || a.outstandingPaise <= 0n) return null;
  const uri = upiUri({ vpa: a.vpa, name: a.name, amountPaise: a.outstandingPaise, note: a.number });
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220, errorCorrectionLevel: 'M' });
  return { qrDataUrl, vpa: a.vpa, amountText: formatRupees(a.outstandingPaise) };
}

/** Any text as a QR PNG data URL. Used for the e-invoice's signed QR. */
export async function qrDataUrl(text: string, width = 240): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width, errorCorrectionLevel: 'L' });
}
