# Provider Adapter Contract

Frameflow keeps provider-specific transport behind a small adapter boundary. The public default is mock/fixture execution; real providers are opt-in.

## Responsibilities

An adapter is responsible for:

1. Accepting a validated image operation or planning request.
2. Translating the request to the provider's official API or local service.
3. Returning a normalized image result or an explicit typed failure.
4. Never returning credentials, authorization headers, or private provider metadata to the browser.
5. Respecting cancellation, payload limits, origin checks, and finite timeouts.

## Image result contract

The normalized result must be one of:

- PNG/JPEG/WebP data URL
- an HTTPS image URL from an explicitly allowed provider origin
- a typed provider failure with safe public metadata

Remote URLs are downloaded and validated before being passed to another workflow stage. Arbitrary client URLs, redirects, private IP addresses, and credential-bearing URLs are rejected.

## Motion contract

A provider motion result is not accepted as a final GIF automatically. Frameflow validates the atlas first:

```text
horizontal atlas
→ exact equal-cell check
→ deterministic cell split
→ alpha/edge validation
→ GIF or APNG encoding
```

Dimension mismatch, adjacent-cell bleed, ghost trail, text, watermark, or baked checkerboard background must fail validation. Do not crop or patch the result to hide a provider contract failure.

## Local configuration

Use `.env.example` as a shape-only reference. Put real values in an ignored local file or secret store. Never commit `.env.local`, provider tokens, session files, or browser state.

## Testing an adapter

Adapter tests should use a local mock server or fixture and cover:

- valid image output
- malformed output
- provider refusal and rate limit
- timeout and cancellation
- unsafe URL and redirect rejection
- payload and image-size limits
- session isolation

Run the repository gates before submitting a change:

```bash
npm test
npm run typecheck
npm run public:check
npm run build
```
