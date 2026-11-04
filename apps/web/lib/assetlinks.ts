/**
 * The Digital Asset Links file that ties the Android app to this website (https://<domain>/.well-known/assetlinks.json). Without a matching
 * entry the Play app opens the site in a browser bar instead of full screen. The fingerprints are the SHA-256 of the key Google Play signs the
 * app with (Play Console, App integrity), and of your upload key if you sideload builds; comma separated in ANDROID_SHA256_FINGERPRINTS.
 */
export const ANDROID_PACKAGE_DEFAULT = 'in.kora.app';

const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function assetLinks(env: Record<string, string | undefined> = process.env) {
  const pkg = (env.ANDROID_PACKAGE ?? ANDROID_PACKAGE_DEFAULT).trim();
  const prints = (env.ANDROID_SHA256_FINGERPRINTS ?? '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => FINGERPRINT.test(s));
  if (!prints.length) return [];
  return [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: [...new Set(prints)] } }];
}
