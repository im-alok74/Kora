// The public address of the marketing site, for links in search results and share cards.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.APP_URL ?? 'https://kora-invoice.vercel.app').replace(/\/+$/, '');
export const SITE_NAME = 'Kora';
export const SITE_TITLE = 'Kora: GST invoicing and collections for Indian businesses';
export const SITE_DESCRIPTION = 'Issue correct GST invoices, send them on WhatsApp, collect by UPI and keep your CA happy. Free to try, in early access.';

/** Public pages that search engines may list. Help article paths are added by the sitemap itself. */
export const PUBLIC_PATHS = ['/', '/pricing', '/tools', '/help', '/import-guide', '/terms', '/privacy', '/refunds', '/login'];
