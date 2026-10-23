# The Kora apps (Windows, Mac, Android, iPhone)

All of them show the same Kora web app, so there is one product, one login and one set of data. Updates to the site reach every app without a new download.

| Device | How it is built | Where the file comes from |
|---|---|---|
| Windows (.exe) | `apps/desktop`, Electron | GitHub release `app-v<version>` |
| Mac (.dmg) | `apps/desktop`, Electron | same release (built on a Mac runner) |
| Android (.apk) | `apps/mobile`, Capacitor | same release |
| iPhone and iPad | none: Add to Home Screen from Safari | the Download page explains the steps |
| Any browser | the PWA (`manifest.webmanifest`, `sw.js`) | the Install button on the Download page |

`apps/desktop` and `apps/mobile` are not part of the pnpm workspace on purpose, so the site build on Vercel never downloads Electron.

## Publishing a new version

1. Open the repository on GitHub, then Actions, then **release-apps**, then **Run workflow**, and type a version such as `0.1.1`.
2. The workflow builds Windows, Mac and Android and creates a release named `app-v0.1.1` with the files.
3. The Download page lists them within ten minutes (it reads the release through the GitHub API and caches for ten minutes). If the repository is private, the page shows "File not published yet", because the API needs a token for private repositories.

## Pointing the apps at your own address

The address the apps open is set in two places. Both are currently `https://kora-git-main-platter2.vercel.app/login`, which is the Vercel alias for the latest deployment of the `main` branch, not the site's public address (`https://kora-invoice.vercel.app` is the default public address in `apps/web/lib/site.ts`). Use the final domain before anyone installs an app:
- `apps/desktop/src/app-config.json` (`url`), or the `KORA_URL` environment variable when running the desktop app.
- `apps/mobile/capacitor.config.json` (`server.url`).

Change them when you attach your own domain, then publish a new version.

## What is not done yet
- **Signing.** The Windows file is not code-signed, so Windows SmartScreen warns once. The Mac file is not notarised (needs an Apple Developer account, 99 US dollars a year), so the user right-clicks and chooses Open the first time. The Android file is signed with a debug key, so it is installed outside the Play Store.
- **Auto-update inside the apps.** The website updates by itself. A new shell version needs a new download.
- **App stores.** Play Store and App Store listings need developer accounts.
- The Mac and Android builds run only in GitHub Actions and have not been run on this machine.
