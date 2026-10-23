# Public app access and identity verification

23 October 2026

## Base and scope

Based on origin/main at 7258c0d (merged PR #17). The previously missing Download navigation and page were already present on main but absent from the old local branch. Main's header, tools, login polish and download page are retained.

This change carries the local invoice/payment identity and rounded animated wordmark into the shared logo, loading screens, payment thank-you page, favicons and install icons. It adds a homepage device section, clear browser fallback, public service-worker registration, install prompt feedback and bounded stable-release discovery.

## Verification

- Web TypeScript check passed.
- 14 unit tests passed: download release filtering/fallback and existing free tools.
- Five public browser tests passed: 390px/1440px download navigation and no horizontal overflow in both themes; simulated accepted, dismissed and failed install prompts.
- One additional browser test passed: primary navigation links and home anchors resolve; wordmark animation respects reduced motion; logo background is transparent.
- Reviewed screenshots of mobile downloads and the homepage device section.

Run public browser checks against a running local preview with:

    cd e2e
    node node_modules/@playwright/test/cli.js test --config playwright.public.config.ts

KORA_PUBLIC_TEST_URL can override the default localhost:3000. This configuration does not reset or modify the test database. Install prompt outcomes are simulated; native installers and actual OS installation were not tested. Installer assets remain unavailable until a stable app release publishes them. No accounting or database behavior was changed.

Production build passed (136 static pages). Existing autoprefixer warnings for end versus flex-end remain in unrelated CSS.
