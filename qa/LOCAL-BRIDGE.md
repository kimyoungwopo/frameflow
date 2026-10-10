# Browser-direct local Bridge

2026-10-07

- Browser authentication, device polling, planning and image requests now call the configured `http://127.0.0.1:<port>` directly. No server fallback.
- Publisher API routes return 410 and do not invoke its Bridge, including forged localhost Host/Origin tests.
- Hosted origins require explicit allowlisting and a pairing key on the user's local Bridge. Preflight includes exact origin, allowed methods/headers and legacy private-network permission. The browser declares loopback target address space.
- Bridge launcher: `npm run bridge -- --origin https://YOUR-SITE.example`. Generates a fresh pairing key; OAuth tokens remain in the existing encrypted local session.
- Production build and TypeScript compilation passed. Test suite: 68 passed, 0 failed. Earlier proxy tests were replaced by disabled-proxy tests; workflow harness mocks now target the direct client. Image validation and provider auth tests remain in Bridge tests.
- Actual IAB at 127.0.0.1:4320: configured port 4329 connected and returned authenticated status; port 49999 failed with local Bridge instructions. No new OAuth login or charged image request was made.
- Settings dialog: 390px document width 390, panel 24..366; 320px document width 320, panel 24..296. Viewport restored.
- Screenshots: local-bridge-settings.png, local-bridge-390.png.
- Cloudflare deployment and public HTTPS-to-loopback browser permission flow were not exercised. Each tester must run their own Bridge and allow the exact HTTPS origin. Unsupported browser or enterprise policy may block loopback access; this does not trigger host-account execution.
- Reference for loopback browser permission: https://developer.chrome.com/blog/local-network-access
