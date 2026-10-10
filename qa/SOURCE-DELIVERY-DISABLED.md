# Bridge source delivery disabled

2026-10-07

- User requires that Bridge source must not be delivered to other users.
- Immediately stopped the owned Cloudflare Quick Tunnel (exec session 43647). The previous public test URL is no longer served by this tunnel.
- Replaced /api/bridge/setup with an unconditional 410 source_delivery_disabled JSON response and no-store headers. It does not import the installer, read source files or attach an archive.
- Removed setup download generation, OS selector and ZIP instructions from the browser UI. Offline users see a distribution-stopped notice. Existing local Bridge account connection remains available.
- Removed installer-specific source tracing from Next.js configuration. Bridge source files stay in the private development project; no source installer was redeployed.
- Production build and TypeScript compilation passed. npm test: 72 passed, 0 failed. Updated the installer endpoint test to assert direct Mac/Windows/local-forged requests cannot trigger any source-file read or attachment.
- Actual HTTP requests to the rebuilt local web server for Mac and Windows returned 410, no Content-Disposition header and source_delivery_disabled.
- Actual browser showed the distribution-stopped notice and no download action. Screenshot: source-delivery-disabled.png.
- Already downloaded copies cannot be recalled. New-PC automatic setup is unavailable. This change blocks distribution; it is not a completed migration of the Bridge to Vercel or a claim that all browser-side JavaScript is private.
- No Supabase dependency was added and no publisher GPT account fallback was enabled. Local web 4320 and Bridge 4329 remain running (owned exec session 64052).
