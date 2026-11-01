// Public contact addresses for the legal pages. Set NEXT_PUBLIC_SUPPORT_EMAIL and NEXT_PUBLIC_PRIVACY_EMAIL before launch;
// until then the pages show a reserved example address and say it must be replaced.
const PLACEHOLDER_SUPPORT = 'support@kora.example';
const PLACEHOLDER_PRIVACY = 'privacy@kora.example';

export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || PLACEHOLDER_SUPPORT;
export const PRIVACY_EMAIL = process.env.NEXT_PUBLIC_PRIVACY_EMAIL?.trim() || PLACEHOLDER_PRIVACY;
export const SUPPORT_IS_PLACEHOLDER = SUPPORT_EMAIL === PLACEHOLDER_SUPPORT;
export const PRIVACY_IS_PLACEHOLDER = PRIVACY_EMAIL === PLACEHOLDER_PRIVACY;
