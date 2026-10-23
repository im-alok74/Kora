// Local development reads the repository's .env; in production the environment is set by the host.
try { process.loadEnvFile?.(new URL('../../.env', import.meta.url)); } catch { /* no .env file */ }

// Not a full script policy (Next.js inlines its bootstrap), but it shuts the frame, base and plugin routes.
// The public invoice route (/i/) and the landing page's sample invoices (/samples/) set their own, much stricter policy, so they are left out here.
const APP_CSP = { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'" };

const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  ...(process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
];

/** @type {import('next').NextConfig} */
export default {
  // The browser tests build into their own folder, so they can run while a dev server is using .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['@kora/core', '@kora/db', '@kora/adapters', '@kora/tax', '@kora/pdf'],
  serverExternalPackages: ['postgres', 'playwright', 'playwright-core', '@sparticuz/chromium'],
  // The serverless Chromium is a packed binary; make sure it is shipped with the two routes that make PDFs.
  // The real folder in the workspace store, not apps/web/node_modules/@sparticuz/chromium, which is a symlink: Vercel refuses a
  // function package that carries files through a symlinked directory ("invalid deployment package for a Serverless Function").
  outputFileTracingIncludes: {
    '/api/documents/[id]/pdf': ['../../node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**'],
    '/i/[token]/pdf': ['../../node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**'],
  },
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      { source: '/((?!i/|samples/).*)', headers: [APP_CSP] },
    ];
  },
  // Workspace packages import their own files as './x.js' (the ESM convention); map that to the .ts source.
  webpack(config) {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};
