import { describe, expect, it } from 'vitest';
import { siteUrlFrom } from '../lib/site';

describe('siteUrlFrom', () => {
  it('prefers the explicit site address, then APP_URL, then the Vercel production host', () => {
    expect(siteUrlFrom({ NEXT_PUBLIC_SITE_URL: 'https://a.example/', APP_URL: 'https://b.example' })).toEqual({ url: 'https://a.example', fromEnv: true });
    expect(siteUrlFrom({ APP_URL: 'https://b.example//' })).toEqual({ url: 'https://b.example', fromEnv: true });
    expect(siteUrlFrom({ VERCEL_PROJECT_PRODUCTION_URL: 'kora.example' })).toEqual({ url: 'https://kora.example', fromEnv: true });
  });
  it('says when it had to fall back, and treats an empty value as unset', () => {
    expect(siteUrlFrom({}).fromEnv).toBe(false);
    expect(siteUrlFrom({ NEXT_PUBLIC_SITE_URL: '' }).fromEnv).toBe(false);
  });
});
