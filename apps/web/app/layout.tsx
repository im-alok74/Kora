import type { ReactNode } from 'react';
import './globals.css';
import './kora-loader.css';
import './product.css';
import { THEME_SCRIPT } from '../lib/themeScript';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from '../lib/site';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: '%s | Kora' }, description: SITE_DESCRIPTION,
  openGraph: { type: 'website', siteName: SITE_NAME, title: SITE_TITLE, description: SITE_DESCRIPTION, locale: 'en_IN', url: '/' },
  twitter: { card: 'summary_large_image', title: SITE_TITLE, description: SITE_DESCRIPTION },
  alternates: { canonical: '/' },
  manifest: '/manifest.webmanifest',
  icons: { icon: [{ url: '/icons/icon.svg?v=4', type: 'image/svg+xml' }, { url: '/icons/icon-32.png?v=4', sizes: '32x32', type: 'image/png' }], shortcut: '/favicon.ico?v=4', apple: '/icons/icon-180.png?v=4' },
  appleWebApp: { capable: true, title: 'Kora', statusBarStyle: 'default' as const },
};
export const viewport = { themeColor: '#106cd9', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <head>
        {/* Sets the theme before the first paint, from the saved choice, else from the device setting, so there is no flash of the wrong one. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
