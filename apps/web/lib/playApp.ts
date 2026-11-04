'use client';
/**
 * Inside the Google Play app the site must not sell plans: Play's payments policy wants purchases of digital services in an app to go
 * through Google Play Billing, and Kora bills with Razorpay. The app opens /app/invoices?source=play (see apps/android/twa-manifest.json),
 * which is remembered here for the rest of the session; the Billing page then hides the buy buttons. A plan bought on the website
 * still works in the app.
 */
const KEY = 'kora-play-app';

export function capturePlayApp(): void {
  try {
    const fromApp = new URLSearchParams(window.location.search).get('source') === 'play' || document.referrer.startsWith('android-app://');
    if (fromApp) localStorage.setItem(KEY, '1');
  } catch { /* storage can be blocked; the page then behaves like the website */ }
}

export function isPlayApp(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}
