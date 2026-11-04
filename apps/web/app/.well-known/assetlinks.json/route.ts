import { assetLinks } from '../../../lib/assetlinks';

export const dynamic = 'force-dynamic';

/** Proves to Android that this site and the Play app belong together. Empty until ANDROID_SHA256_FINGERPRINTS is set. */
export async function GET() {
  return new Response(JSON.stringify(assetLinks()), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' } });
}
