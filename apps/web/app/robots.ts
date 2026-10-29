import type { MetadataRoute } from 'next';
import { SITE_URL } from '../lib/site';

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/', disallow: ['/app/', '/ca/', '/send/', '/api/', '/portal/', '/pay/', '/i/', '/setup', '/mock-gateway/'] }], sitemap: `${SITE_URL}/sitemap.xml` };
}
