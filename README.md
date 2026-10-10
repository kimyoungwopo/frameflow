<div align="center">
  <img src="https://raw.githubusercontent.com/kimyoungwopo/frameflow/main/web/public/brand/frameflow-icon-512.png" width="112" alt="Frameflow icon" />
  <h1>Frameflow</h1>
  <p><strong>A local, node-based image workflow studio with deterministic motion atlas processing.</strong></p>
  <p>
    <a href="https://github.com/kimyoungwopo/frameflow/actions/workflows/public-release-check.yml"><img src="https://github.com/kimyoungwopo/frameflow/actions/workflows/public-release-check.yml/badge.svg" alt="Public release checks" /></a>
    <a href="https://github.com/kimyoungwopo/frameflow/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache 2.0 license" /></a>
    <a href="https://github.com/kimyoungwopo/frameflow"><img src="https://img.shields.io/github/stars/kimyoungwopo/frameflow?style=flat" alt="GitHub stars" /></a>
  </p>
  <p>
    <strong>English</strong> ·
    <a href="README.ko.md">한국어</a> ·
    <a href="README.ja.md">日本語</a> ·
    <a href="README.zh-CN.md">简体中文</a>
  </p>
</div>

---

## Overview

Frameflow is a local web studio for composing image generation and editing workflows as a node graph. It keeps the workflow contract, provider boundary, validation, and output processing explicit—so provider results can be checked and transformed deterministically instead of being silently patched.

## ✨ What it does

- **Node-based workflows** — compose prompts, inputs, edits, blends, repeats, previews, and motion operations.
- **Provider adapters** — connect an official provider, a compatible local service, or a mock provider through a clear boundary.
- **Deterministic motion pipeline** — validate a horizontal equal-cell atlas, split exact cells, and encode GIF/APNG output.
- **Offline-friendly QA** — run planner, graph, alpha, atlas, and encoder tests without an account or paid API call.
- **Local-first storage** — keep workflow data in the browser and run the Bridge on loopback by default.
- **Explicit failure handling** — reject malformed graphs and invalid atlases instead of hiding errors with crop, patch, or silent retry.

## 🧭 Architecture

```text
Natural language / manual graph
              │
              ▼
      Planner + contract validation
              │
              ▼
       Local Bridge / provider adapter
              │
              ▼
   Image result → atlas validation → exact split
              │
              ▼
       GIF / APNG encoder → project results
```

## 🖼️ Preview

**The studio** — compose an image workflow with nodes and inspect the result locally.

![Frameflow studio overview](docs/assets/studio-overview.png)

**The motion output** — validate a wide atlas, split exact cells, and encode a GIF/APNG.

![Synthetic motion fixture](docs/assets/motion-demo.gif)

For the technical contract, see the [motion atlas card](docs/assets/motion-atlas-contract.png). These are public-safe local UI and synthetic fixture assets; they do not contain account state or provider output. See the full [offline demo guide](docs/DEMO.md).

## 🚀 Quick start

Requirements: **Node.js 22+**

```bash
npm install
npm run setup
npm run dev
```

Open <http://127.0.0.1:4310>.

Production build:

```bash
npm run build
npm start
```

Custom local ports:

```bash
WEB_PORT=4320 BRIDGE_PORT=4329 npm start
```

## 🔌 Provider boundary

The default test path uses mock responses and fixtures. Real providers are opt-in and must be configured locally from their official documentation.

```bash
cp .env.example .env.local
# Fill only the provider settings you choose to use.
# Never commit .env.local or real credentials.
```

For a trusted HTTPS website connecting to a local Bridge:

```bash
npm run bridge -- --origin https://YOUR-SITE.example
```

Credentials, tokens, cookies, device authorization state, and session files must stay outside the repository. See [bridge/README.md](bridge/README.md) and [SECURITY.md](SECURITY.md).

## 🎞️ Motion atlas contract

Frameflow does not crop or repair a provider result to make it pass. A motion atlas must satisfy the contract before encoding:

- horizontal, equal-width cells
- exact frame count, typically 8 frames at 6 fps
- transparent or explicitly requested background
- no adjacent-cell bleed or ghost trail
- no text, watermark, border, or checkerboard baked into the asset
- dimension mismatch means a clear failure

## ✅ Verification

All of these commands run without a provider account or API key:

```bash
npm test
npm run typecheck
npm run agent:check
npm run public:check
npm run build
```

## 📦 Repository map

```text
web/       Next.js studio and browser-side encoders
bridge/    Local Bridge, provider adapters, planner validation
shared/    Command catalogue and AI harness definitions
tests/     Offline regression and integration tests
qa/        Sanitized QA fixtures and scenario records
docs/      Architecture and decision notes
```

## 🔐 Public-release boundary

This repository intentionally excludes API keys, OAuth secrets, access/refresh tokens, passwords, connection strings, session state, personal paths, private QA captures, live tunnel URLs, local build output, source maps, packaged apps, and private generated assets.

Run `npm run public:check` before publishing. See [PUBLIC_RELEASE_CHECKLIST.md](PUBLIC_RELEASE_CHECKLIST.md).

## 📄 License and brand

Source code: [Apache License 2.0](LICENSE).

The Frameflow name, logo, hosted-service identifiers, and brand assets are separate from the code license. See [TRADEMARKS.md](TRADEMARKS.md). Contributions are welcome under [CONTRIBUTING.md](CONTRIBUTING.md).

## Links

- [Security policy](SECURITY.md)
- [Contributing guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [License](LICENSE)
- [Brand and trademarks](TRADEMARKS.md)
- [GitHub Actions](https://github.com/kimyoungwopo/frameflow/actions)
