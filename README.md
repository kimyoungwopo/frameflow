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
    <a href="#english">English</a> ·
    <a href="#한국어">한국어</a> ·
    <a href="#日本語">日本語</a> ·
    <a href="#简体中文">简体中文</a>
  </p>
</div>

---

<a id="english"></a>

## English

Frameflow is a local web studio for composing image generation and editing workflows as a node graph. It keeps the workflow contract, provider boundary, validation, and output processing explicit—so provider results can be checked and transformed deterministically instead of being silently patched.

### ✨ What it does

- **Node-based workflows** — compose prompts, inputs, edits, blends, repeats, previews, and motion operations.
- **Provider adapters** — connect an official provider, a compatible local service, or a mock provider through a clear boundary.
- **Deterministic motion pipeline** — validate a horizontal equal-cell atlas, split exact cells, and encode GIF/APNG output.
- **Offline-friendly QA** — run planner, graph, alpha, atlas, and encoder tests without an account or paid API call.
- **Local-first storage** — keep project metadata and image records in the browser; run the Bridge on loopback by default.
- **Explicit failure handling** — reject malformed graphs and invalid atlases instead of hiding errors with crop, patch, or silent retry.

### 🧭 Architecture

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

### 🚀 Quick start

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

### 🔌 Provider boundary

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

### 🎞️ Motion atlas contract

Frameflow does not crop or repair a provider result to make it pass. A motion atlas must satisfy the contract before encoding:

- horizontal, equal-width cells
- exact frame count, typically 8 frames at 6 fps
- transparent or explicitly requested background
- no adjacent-cell bleed or ghost trail
- no text, watermark, border, or checkerboard baked into the asset
- dimension mismatch means a clear failure

### ✅ Verification

All of these commands run without a provider account or API key:

```bash
npm test
npm run typecheck
npm run agent:check
npm run public:check
npm run build
```

The repository currently covers planner contracts, graph validation, provider boundaries, session isolation, alpha-preserving image handling, motion atlas processing, and result persistence.

### 📦 Repository map

```text
web/       Next.js studio and browser-side encoders
bridge/    Local Bridge, provider adapters, planner validation
shared/    Command catalogue and AI harness definitions
tests/     Offline regression and integration tests
qa/        Sanitized QA fixtures and scenario records
docs/      Architecture and decision notes
```

### 🔐 Public-release boundary

This repository intentionally excludes:

- API keys, OAuth secrets, access/refresh tokens, passwords, and connection strings
- session, cookie, browser-profile, and device-authorization state
- personal paths, account identifiers, private QA captures, and live tunnel URLs
- local build output, source maps, packaged apps, and private generated assets

Run `npm run public:check` before publishing. The full checklist is in [PUBLIC_RELEASE_CHECKLIST.md](PUBLIC_RELEASE_CHECKLIST.md).

### 📄 License and brand

Source code: [Apache License 2.0](LICENSE).

The Frameflow name, logo, hosted-service identifiers, and brand assets are separate from the code license. See [TRADEMARKS.md](TRADEMARKS.md). Contributions are welcome under [CONTRIBUTING.md](CONTRIBUTING.md).

---

<a id="한국어"></a>

## 한국어

Frameflow는 이미지 생성·편집 작업을 노드 그래프로 구성하는 로컬 웹 스튜디오야. provider 경계와 workflow 계약을 분리하고, 생성 결과를 검증한 뒤 deterministic하게 모션 atlas와 GIF/APNG로 처리해.

### 주요 기능

- 프롬프트, 입력, 편집, 합성, 반복, preview, motion을 노드로 구성
- 공식 provider·로컬 서비스·mock provider를 adapter로 연결
- 동일 셀 atlas 검증과 정확한 프레임 분할
- 계정/API key 없이 실행 가능한 fixture 기반 테스트
- loopback 기본 Local Bridge와 브라우저 프로젝트 저장
- 잘못된 그래프·atlas를 crop이나 자동 재시도로 숨기지 않는 명시적 실패 처리

### 실행

```bash
npm install
npm run setup
npm run dev
```

<http://127.0.0.1:4310>에서 열면 돼. 전체 검증은 다음 명령으로 실행해.

```bash
npm test
npm run typecheck
npm run agent:check
npm run public:check
npm run build
```

실제 provider 연결은 opt-in이며, credential·token·세션·개인 결과물은 저장소에 넣지 않아. 자세한 내용은 [공개 전 체크리스트](PUBLIC_RELEASE_CHECKLIST.md), [보안 정책](SECURITY.md), [기여 가이드](CONTRIBUTING.md)를 확인해.

---

<a id="日本語"></a>

## 日本語

Frameflowは、画像生成・編集ワークフローをノードグラフで構成するローカルWebスタジオです。providerとの境界とworkflow契約を分離し、生成結果を検証してからモーションatlasとGIF/APNGへ決定的に変換します。

### 主な特徴

- プロンプト、入力、編集、合成、反復、プレビュー、モーションをノードで構成
- 公式provider、ローカルサービス、mock providerをadapter経由で接続
- 等幅セルのatlas検証と正確なフレーム分割
- アカウントやAPI keyなしで実行できるfixtureベースのテスト
- loopbackを基本とするLocal Bridgeとブラウザ内プロジェクト保存
- 不正なグラフやatlasをcrop・patch・暗黙の再試行で隠さない明示的なエラー処理

### 実行

```bash
npm install
npm run setup
npm run dev
```

<http://127.0.0.1:4310> を開いてください。検証コマンドは次のとおりです。

```bash
npm test
npm run typecheck
npm run agent:check
npm run public:check
npm run build
```

実際のprovider接続はopt-inです。credential、token、セッション、個人の生成物はリポジトリに含めません。詳しくは [公開チェックリスト](PUBLIC_RELEASE_CHECKLIST.md) と [Security Policy](SECURITY.md) を確認してください。

---

<a id="简体中文"></a>

## 简体中文

Frameflow 是一个本地 Web 工作室，用于通过节点图组合图像生成与编辑流程。它将 provider 边界和 workflow 契约明确分开，在生成结果经过验证后，再以确定性的方式处理 motion atlas、GIF 和 APNG。

### 核心能力

- 使用节点组合提示词、输入、编辑、合成、重复、预览和动画操作
- 通过 adapter 连接官方 provider、本地服务或 mock provider
- 验证等宽横向 atlas，并精确拆分每一帧
- 无需账号或 API key 即可运行的 fixture 测试
- 默认仅绑定 loopback 的 Local Bridge，以及浏览器端项目存储
- 对无效图结构和 atlas 直接报错，不用裁剪、打补丁或静默重试来掩盖问题

### 运行

```bash
npm install
npm run setup
npm run dev
```

打开 <http://127.0.0.1:4310>。完整检查命令：

```bash
npm test
npm run typecheck
npm run agent:check
npm run public:check
npm run build
```

真实 provider 连接必须显式 opt-in。请勿将 credential、token、会话文件或个人生成结果提交到仓库。详情请查看[公开发布检查清单](PUBLIC_RELEASE_CHECKLIST.md)和[安全策略](SECURITY.md)。

---

## Links

- [Public release checklist](PUBLIC_RELEASE_CHECKLIST.md)
- [Security policy](SECURITY.md)
- [Contributing guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [License](LICENSE)
- [Brand and trademarks](TRADEMARKS.md)
- [GitHub Actions](https://github.com/kimyoungwopo/frameflow/actions)
