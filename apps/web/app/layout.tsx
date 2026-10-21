import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Kora', description: 'GST invoicing for Indian businesses', manifest: '/manifest.webmanifest',
  icons: { icon: [{ url: '/icons/icon.svg', type: 'image/svg+xml' }, { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }], apple: '/icons/icon-192.png' },
  appleWebApp: { capable: true, title: 'Kora', statusBarStyle: 'default' as const },
};
export const viewport = { themeColor: '#106cd9', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        {/* Sets the theme before the first paint, from the saved choice or else the device setting, so there is no flash of the wrong one. */}
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('kora-theme');if(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)t='dark';if(t==='dark')document.documentElement.dataset.theme='dark'}catch(e){}" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
