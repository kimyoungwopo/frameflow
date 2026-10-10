# Demo

This demo path is intentionally offline. It does not require an account, API key, tunnel, or paid provider request.

## Start the studio

```bash
npm install
npm run setup
npm run dev
```

Open <http://127.0.0.1:4310>.

## What the public assets show

- [`assets/studio-overview.png`](assets/studio-overview.png) — clean local studio surface.
- [`assets/motion-atlas-contract.png`](assets/motion-atlas-contract.png) — equal-cell atlas contract.
- [`assets/motion-demo.gif`](assets/motion-demo.gif) — a synthetic fixture animation used for documentation, not a provider result.

The screenshots and animation contain no account state, private result, provider response, or personal file path.

## Reproduce the offline checks

```bash
npm test
npm run typecheck
npm run agent:check
npm run public:check
npm run build
```

For provider-specific testing, configure a local adapter from the provider's official documentation. Do not commit local environment files or credentials.
