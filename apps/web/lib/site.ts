// The public address of the marketing site, for links in search results and share cards.
const FALLBACK_SITE_URL = 'https://kora-invoice.vercel.app';

/** The site address from the environment: the explicit setting, then APP_URL, then the host Vercel gives the production deployment. */
export function siteUrlFrom(env: Record<string, string | undefined>): { url: string; fromEnv: boolean } {
  const raw = env.NEXT_PUBLIC_SITE_URL || env.APP_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : '');
  return { url: (raw || FALLBACK_SITE_URL).replace(/\/+$/, ''), fromEnv: !!raw };
}

const resolved = siteUrlFrom(process.env);
// Canonical links, the sitemap and the structured data all use this address, so a missing setting is worth a loud line in the logs.
if (!resolved.fromEnv && process.env.NODE_ENV === 'production') console.error(`[kora] NEXT_PUBLIC_SITE_URL and APP_URL are both unset, so canonical links and the sitemap use ${FALLBACK_SITE_URL}. Set one of them.`);
export const SITE_URL = resolved.url;
export const SITE_NAME = 'Kora';
export const SITE_TITLE = 'Kora: GST invoicing and collections for Indian businesses';
export const SITE_DESCRIPTION = 'Issue correct GST invoices, send them on WhatsApp, collect by UPI and keep your CA happy. Free to try, in early access.';

/** Public pages that search engines may list. Help article paths are added by the sitemap itself. */
export const PUBLIC_PATHS = ['/', '/pricing', '/download', '/tools', '/help', '/import-guide', '/terms', '/privacy', '/refunds', '/login'];
