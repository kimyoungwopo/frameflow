# Frameflow

Frameflowは、画像生成・編集ワークフローをノードグラフで構成し、結果を決定的に検証・処理するローカルWebスタジオです。

[English](README.md) · [한국어](README.ko.md) · **日本語** · [简体中文](README.zh-CN.md)

## ✨ 主な機能

- **ノードベースのworkflow** — プロンプト、入力、編集、合成、反復、プレビュー、モーションを構成
- **Provider adapter** — 公式provider、ローカルサービス、mock providerを接続
- **決定的なmotion pipeline** — 等幅atlasの検証、正確なセル分割、GIF/APNGエンコード
- **アカウント不要のQA** — planner、graph、alpha、atlas、encoderをfixtureで検証
- **Local-first** — ブラウザ内プロジェクト保存とloopbackを基本とするLocal Bridge
- **明示的なエラー処理** — 不正なgraphやatlasをcrop、patch、暗黙の再試行で隠さない

## 🖼️ プレビュー

**スタジオ** — ノードで画像ワークフローを組み、結果をローカルで確認できます。

![Frameflowスタジオ](docs/assets/studio-overview.png)

**モーション出力** — 横長atlasを検証し、セルを正確に分割してGIF/APNGにエンコードします。

![Synthetic motion fixture](docs/assets/motion-demo.gif)

技術仕様は [motion atlasカード](docs/assets/motion-atlas-contract.png)、手順は [Demoガイド](docs/DEMO.md) を確認してください。

## 🚀 実行

必要条件: **Node.js 22以上**

```bash
npm install
npm run setup
npm run dev
```

<http://127.0.0.1:4310> を開いてください。

```bash
npm run build
npm start
```

ポート変更:

```bash
WEB_PORT=4320 BRIDGE_PORT=4329 npm start
```

## 🔌 Providerとセキュリティ

標準のテスト経路はmockレスポンスとfixtureを使用します。実際のproviderはopt-inで接続し、公式ドキュメントに従ってローカル環境変数で設定してください。

credential、token、cookie、device authorization、セッションファイル、個人パス、実際のtunnel URL、個人の生成物はリポジトリに含めません。詳しくは [Security Policy](SECURITY.md) を確認してください。

## 🎞️ Motion atlas契約

Frameflowはprovider結果を通すために任意のcropやpatchを行いません。横方向の等幅セル、正確なフレーム数、隣接セルのbleedなし、ghost trailなし、テキスト・透かし・枠なしを検証し、規格外の場合は失敗にします。

## ✅ 検証

```bash
npm test
npm run typecheck
npm run agent:check
npm run public:check
npm run build
```

基本検証はアカウントやAPI keyなしで実行できます。

## 📦 リポジトリ構成

```text
web/       Next.jsスタジオとブラウザ側encoder
bridge/    Local Bridge、provider adapter、planner検証
shared/    command catalogueとAI harness
tests/     offline回帰・統合テスト
qa/        整理済みQA fixtureとシナリオ
docs/      アーキテクチャと判断記録
```

## 📄 ドキュメント

- [公開チェックリスト](PUBLIC_RELEASE_CHECKLIST.md)
- [Security Policy](SECURITY.md)
- [Contributing guide](CONTRIBUTING.md)
- [License](LICENSE)
- [Brand and trademarks](TRADEMARKS.md)
