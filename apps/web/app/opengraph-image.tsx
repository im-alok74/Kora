import { ImageResponse } from 'next/og';

export const alt = 'Kora: GST invoicing and collections for Indian businesses';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 80, background: '#eaf3fd', color: '#171b20' }}>
        <div style={{ fontSize: 40, fontWeight: 800, color: '#106cd9' }}>kora</div>
        <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.08, marginTop: 24, letterSpacing: -2 }}>GST invoicing for your business</div>
        <div style={{ fontSize: 32, marginTop: 28, color: '#3d464f' }}>Correct invoices, a UPI QR on every one, and payments that match themselves.</div>
      </div>
    ),
    size,
  );
}
