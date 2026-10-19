import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Kora', description: 'GST invoicing for Indian businesses', manifest: '/manifest.webmanifest',
  icons: { icon: [{ url: '/icons/icon.svg', type: 'image/svg+xml' }, { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }], apple: '/icons/icon-192.png' },
  appleWebApp: { capable: true, title: 'Kora', statusBarStyle: 'default' as const },
};
export const viewport = { themeColor: '#0b5d4f', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
