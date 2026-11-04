import { describe, expect, it } from 'vitest';
import { assetLinks } from '../lib/assetlinks';

const FP = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';

describe('assetLinks', () => {
  it('is empty until a fingerprint is set, so the site never claims an app it has no key for', () => {
    expect(assetLinks({})).toEqual([]);
    expect(assetLinks({ ANDROID_SHA256_FINGERPRINTS: 'not-a-fingerprint' })).toEqual([]);
  });
  it('lists the app package with each valid fingerprint once, upper-cased, ignoring bad ones', () => {
    const [e] = assetLinks({ ANDROID_SHA256_FINGERPRINTS: `${FP.toLowerCase()}, ${FP}, junk` });
    expect(e!.target).toEqual({ namespace: 'android_app', package_name: 'in.kora.app', sha256_cert_fingerprints: [FP] });
    expect(e!.relation).toEqual(['delegate_permission/common.handle_all_urls']);
  });
  it('uses the configured package name', () => {
    expect(assetLinks({ ANDROID_PACKAGE: 'in.example.app', ANDROID_SHA256_FINGERPRINTS: FP })[0]!.target.package_name).toBe('in.example.app');
  });
});
