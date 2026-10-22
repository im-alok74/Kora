import type { MetadataRoute } from 'next';
import { PUBLIC_PATHS, SITE_URL } from '../lib/site';
import { HELP_ARTICLES } from '../lib/help';

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [...PUBLIC_PATHS, ...HELP_ARTICLES.map((a) => `/help/${a.slug}`)];
  return paths.map((p) => ({ url: `${SITE_URL}${p}`, changeFrequency: p === '/' ? 'weekly' : 'monthly', priority: p === '/' ? 1 : p === '/pricing' ? 0.8 : 0.5 }));
}
