// Local development reads the repository's .env; in production the environment is set by the host.
try { process.loadEnvFile?.(new URL('../../.env', import.meta.url)); } catch { /* no .env file */ }

// Not a full script policy (Next.js inlines its bootstrap), but it shuts the frame, base and plugin routes.
// The public invoice route (/i/) and the landing page's sample invoices (/samples/) set their own, much stricter policy, so they are left out here.
const APP_CSP = { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'" };

// The two scanner tools open the camera, so they alone may use it (on this origin only). Every other route keeps it shut.
const CAMERA_PAGES = '/tools/:tool(barcode-scanner|qr-code-scanner)';
const PERMISSIONS_POLICY = (camera) => ({ key: 'Permissions-Policy', value: `camera=${camera}, microphone=(), geolocation=(), payment=()` });

// Free tools that were taken off the site because they have nothing to do with invoicing or GST. The pages may be indexed, so each
// address (and anything under it, such as the share card) answers with a permanent redirect to the tools hub. Keep in step with
// REMOVED_TOOLS in lib/tools.ts; test/toolRedirects.test.ts checks that they match.
export const REMOVED_TOOL_SLUGS = ['pdf-to-image', 'image-converter', 'image-compressor', 'images-to-pdf', 'merge-split-pdf', 'word-counter'];

const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  PERMISSIONS_POLICY('()'),
  ...(process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
];

/** @type {import('next').NextConfig} */
export default {
  async redirects() {
    return [{ source: `/tools/:slug(${REMOVED_TOOL_SLUGS.join('|')})/:rest*`, destination: '/tools', permanent: true }];
  },
  // The browser tests build into their own folder, so they can run while a dev server is using .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: ['@kora/core', '@kora/db', '@kora/adapters', '@kora/tax', '@kora/pdf'],
  serverExternalPackages: ['postgres', 'playwright', 'playwright-core', '@sparticuz/chromium'],
  // The serverless Chromium is a packed binary; make sure it is shipped with the two routes that make PDFs.
  // The real folder in the workspace store, not apps/web/node_modules/@sparticuz/chromium, which is a symlink: Vercel refuses a
  // function package that carries files through a symlinked directory ("invalid deployment package for a Serverless Function").
  outputFileTracingIncludes: {
    // The health route compares these with the migrations the database has recorded.
    '/api/health': ['../../packages/db/migrations/*.sql'],
    '/api/documents/[id]/pdf': ['../../node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**'],
    '/i/[token]/pdf': ['../../node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**'],
  },
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      { source: '/((?!i/|samples/).*)', headers: [APP_CSP] },
      // Listed last: when two rules set the same header on one path, the later one wins.
      { source: CAMERA_PAGES, headers: [PERMISSIONS_POLICY('(self)')] },
    ];
  },
  // Workspace packages import their own files as './x.js' (the ESM convention); map that to the .ts source.
  webpack(config) {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};
