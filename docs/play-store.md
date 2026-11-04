# Kora on Google Play

How the app is built, what is ready, what only you can do, and the text to paste into Play Console. Last checked 4 November 2026 against Google's pages (linked at the end); Google changes these rules, so re-read the linked page before each step.

## 1. How the Android app works

The app is a **Trusted Web Activity**: Chrome shows the Kora website full screen, inside an Android app that Google Play distributes. There is one product, one login and one set of data; a change to the site reaches the app at once.

I chose this over the Capacitor shell in `apps/mobile` (still used for the downloadable APK) because Google Play rejects apps that are only "a webview of a website", and a Trusted Web Activity of a real installable web app (manifest, offline service worker) is the way Google itself documents for this. Kora already has the manifest (`apps/web/public/manifest.webmanifest`) and an offline service worker (`apps/web/public/sw.js`).

| Piece | Where | State |
|---|---|---|
| Android project settings | `apps/android/twa-manifest.template.json` | Done. Generating the project from it was run here and gives `targetSdkVersion 36` (Google's requirement for new apps from 31 August 2026). |
| Build of the signed bundle (.aab) | `.github/workflows/release-play.yml` (Actions, "Run workflow") | Written. **Not yet run end to end**: it needs your domain, your key and Play Console first. |
| Digital Asset Links (full-screen proof) | `/.well-known/assetlinks.json`, filled from `ANDROID_SHA256_FINGERPRINTS` | Done and tested. Empty until you add the fingerprint. |
| No plan purchases inside the app | `apps/web/lib/playApp.ts`, Billing page | Done. See section 5. |
| Store graphics | `marketing/play/out/` (feature graphic and five phone screenshots) | Done. Regenerate with `node marketing/play/build-graphics.mjs`. |

## 2. What only you can do, in order

1. **Own domain on the site.** The app is tied to one web address, so buy the domain and attach it in Vercel first. Everything below uses it (call it `app.example.in`).
2. **Google Play Console account** at play.google.com/console. One-time fee of US $25. Choose carefully:
   - **Personal account** (created after 13 November 2023): Google requires a **closed test with at least 12 testers who stay opted in for 14 days in a row** before you can apply for production. Each new app needs its own.
   - **Organization account** (needs a registered business and a D-U-N-S number): the 12-testers rule does not apply, but verification takes longer.
3. **Create your upload key** (once, on your own computer; never commit or share it, and back it up in two places, because losing it means a support request to Google):
   ```bash
   keytool -genkeypair -v -keystore upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 10000
   ```
   It asks for a password and your details. Then add three secrets in GitHub (Settings, Secrets and variables, Actions): `ANDROID_KEYSTORE_B64` (the output of `base64 -w0 upload.keystore`, or in PowerShell `[Convert]::ToBase64String([IO.File]::ReadAllBytes("upload.keystore"))`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`; and one **variable**: `ANDROID_HOST` = your domain without `https://`.
4. **Create the app in Play Console**: name "Kora: GST Invoicing", default language English (India), type App, free. Package name `in.kora.app` (cannot be changed later; if you want a different one, change `packageId` in the template and `ANDROID_PACKAGE`).
5. **Build the bundle**: GitHub, Actions, release-play, Run workflow, version name `1.0.0`, version code `1`. Download `kora-play-bundle` and upload the `.aab` to a **closed testing** track (Testing, Closed testing).
6. **Turn on Play App Signing** (Play Console asks when you upload; accept). Then open **Test and release, App integrity, App signing** and copy the **SHA-256 certificate fingerprint** of the *app signing key*. Put it in Vercel as `ANDROID_SHA256_FINGERPRINTS` (comma separate more if you also install your own builds) and redeploy. Check `https://app.example.in/.well-known/assetlinks.json` shows it. Without this the app opens with a browser address bar.
7. **Fill in the app content pages** (section 4 has the answers), upload the graphics, and add the testers (personal accounts: at least 12 people with Gmail addresses, active for 14 days).
8. **After the 14 days**, apply for production access, answering Google's questions about your test, then release.

## 3. Store listing text (paste into Play Console)

**App name** (max 30): `Kora: GST Invoicing`

**Short description** (max 80): `GST invoices, WhatsApp sharing and UPI collection for Indian businesses.`

**Full description** (max 4000):

```
Kora makes GST invoicing simple for small businesses, freelancers and the CAs who work with them.

MAKE A CORRECT GST INVOICE IN SECONDS
- Choose the customer, add items and rates; CGST, SGST or IGST is worked out for you
- Invoice numbers run in order with no gaps, per series and financial year
- Tax invoices, bills of supply, estimates, delivery challans, credit notes and debit notes

SHARE AND GET PAID
- Send invoices on WhatsApp, SMS or email
- Every invoice carries a UPI QR for the amount due
- See when an invoice was sent, opened and paid
- Reminders for overdue invoices and a clear list of who owes what

BUILT TO WORK WITH YOUR CA
- GSTR-1 and GSTR-3B data export for your CA
- Customers, items and old invoices come in from Excel or Tally
- CA firms get one screen for every client, document requests and upload links

MORE
- Works offline: draft invoices without a connection and they sync later
- Bills in English, Hindi, Marathi and Gujarati
- Expenses, purchases, stock and reports
- Your data is protected with one-time codes, optional authenticator-app sign-in and a record of who did what

Kora helps you prepare GST documents and data. You or your CA remain responsible for filing returns. Kora is not a government app.

Start free. Questions: support@YOUR-DOMAIN
```

**Category**: Business. **Tags**: invoicing, accounting, business tools. **Contact**: your support e-mail, website, and the privacy policy URL `https://app.example.in/privacy`.

**Do not write**: "government", "official", "files your GST returns", numbers of users or ratings, "free forever", or anything about a feature not in the app. The description above avoids all of these.

## 4. Play Console answers

| Section | Answer |
|---|---|
| App access | Login is required. Give reviewers a working account: sign up on the live site with an e-mail address and a password (the sign-up form asks for one), press "Try it with sample data" on the dashboard, and paste the e-mail and password and short steps into "App access". Keep that account working. |
| Ads | No ads. |
| Content rating | Complete the questionnaire honestly (a business tool with no violence, gambling or user-to-user chat): expect "Everyone". |
| Target audience | 18 and over. Not for children. |
| Data safety | Collects: name, phone number, e-mail, address (business and customer details the user enters), financial info (invoices, payment records; bank details only if the user enters them), photos and files (receipts the user uploads), app activity, device or other IDs (session). All data is encrypted in transit. Users can request deletion. Data is **not sold**. Shared with service providers only to run the service (WhatsApp/SMS/e-mail delivery, payment processing, hosting). Check this against your own privacy policy and sign-up flow before submitting; Google compares the two. |
| Account deletion | Required for apps with sign-up. In the app: Security, "Close my account" (it asks you to type DELETE). Give the same web instructions at `https://app.example.in/privacy` (add a short "How to delete your account" paragraph first). |
| Privacy policy | `https://app.example.in/privacy`: it must name the real company, support contact, what is collected, where it is stored (India, Mumbai), retention and deletion. Replace placeholder text first. |
| Financial features | Kora does not provide loans or investment services. |
| Government app | No. |

## 5. Payments: the rule that can stop the app

Google Play's payments policy expects purchases of digital services inside an Android app to use **Google Play Billing**, which charges Google's fee. Kora sells its plans with **Razorpay** on the website.

What the app does now: it **does not sell plans**. Inside the Play app the Billing page shows no buy buttons and says "Plan changes are not available in this app". A plan bought on the website still works in the app. It also does not mention or link to the website for buying, because steering users out of the app to pay can itself break the policy.

What you should know:
- Google has programmes that allow other payment systems (user choice billing in India with a reduced fee; external offers in the US). Their terms change and have to be applied for. If you want in-app sales later, read the "User choice billing" page linked below, or add Play Billing.
- Free-plan users in the app will hit plan limits (10 documents a month, no WhatsApp sending) with no way to upgrade inside the app. They can upgrade on the website. Decide whether that is acceptable for launch.
- A policy reviewer decides; this has not been tested with Google. Expect questions.

## 6. First-run notes for the build

The workflow generates the Android project (tested: it works and targets API 36), then builds with Gradle. The steps that have **not** been run here, so expect to fix small things the first time:
- `bubblewrap build` in CI (needs the Android SDK on the runner, which GitHub's Ubuntu image provides).
- The signing secrets.
- Installing the signed build on a phone and confirming there is **no address bar** (that proves the asset links match).

**If the workflow gives you trouble, the fallback that needs no code:** go to pwabuilder.com, enter your site address, choose Android, Google Play, and download the package. It contains the signed `.aab`, the key and the exact `assetlinks.json` entry to use. The Play Console steps are the same.

## 6b. Test APK (built and run on the Android emulator, 4 November 2026)

`apps/android/out/Kora-test-1.0.0.apk` is a **debug-signed test build** of the same project, pointed at `https://kora-swart-six.vercel.app`. It is for trying the app on a phone, not for Play (Play needs the signed `.aab` from the workflow).
- Checked in the file: package `in.kora.app`, version 1.0.0, minimum Android 7 (API 24), target Android 16 (API 36), signed (APK Signature Scheme v2), start page `/app/invoices?source=play`.
- Run on the Android 15 emulator: it installs, shows the Kora splash, and opens the site's sign-in page. It shows a browser address bar because the test key is not listed in `/.well-known/assetlinks.json`; the Play build gets the full-screen look once `ANDROID_SHA256_FINGERPRINTS` has Google's key.
- Install on a phone: copy the file to the phone, open it, allow "install unknown apps" for the app you opened it from. Or with a cable and USB debugging: `adb install Kora-test-1.0.0.apk`.
- Two template settings were needed to make the build work and are now in `twa-manifest.template.json`: `splashScreenFadeOutDuration` and `minSdkVersion: 24`.

## 7. Updates after launch

Site changes need no new app version. Build a new bundle (higher version code) only when you change the app itself (icon, name, start page, target API level). Google raises the minimum target API level every August; the workflow stops with a clear message if the generated project is below it.

## Sources

- Target API level requirement (API 36 for new apps and updates from 31 August 2026): support.google.com/googleplay/android-developer/answer/11926878
- Testing requirements for new personal accounts (12 testers, 14 days): support.google.com/googleplay/android-developer/answer/14151465
- User choice billing: support.google.com/googleplay/android-developer/answer/13821247
- Trusted Web Activities: developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities
- Bubblewrap CLI 1.27.0 (used to generate the project)
