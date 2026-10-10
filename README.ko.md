# Frameflow

로컬에서 이미지 생성·편집 작업을 노드 그래프로 구성하고, 결과를 deterministic하게 검증·처리하는 웹 스튜디오야.

[English](README.md) · **한국어** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md)

## ✨ 주요 기능

- **노드 기반 workflow** — 프롬프트, 입력, 편집, 합성, 반복, preview, motion 구성
- **Provider adapter** — 공식 provider, 로컬 서비스, mock provider 연결
- **Deterministic motion pipeline** — 동일 셀 atlas 검증, 정확한 셀 분할, GIF/APNG 인코딩
- **계정 없는 QA** — planner, graph, alpha, atlas, encoder를 fixture로 검증
- **Local-first** — 브라우저 프로젝트 저장과 loopback 기본 Local Bridge
- **명시적 실패 처리** — 잘못된 graph·atlas를 crop, patch, 자동 재시도로 숨기지 않음

## 🚀 실행

요구 사항: **Node.js 22 이상**

```bash
npm install
npm run setup
npm run dev
```

<http://127.0.0.1:4310>에서 열면 돼.

```bash
npm run build
npm start
```

포트 변경:

```bash
WEB_PORT=4320 BRIDGE_PORT=4329 npm start
```

## 🔌 Provider와 보안

기본 테스트는 mock 응답과 fixture를 사용해. 실제 provider는 opt-in으로만 연결하고 공식 문서에 따라 로컬 환경변수로 설정해야 해.

```bash
cp .env.example .env.local
# 실제 credential은 로컬에서만 설정하고 커밋하지 않아.
```

credential, token, cookie, device authorization, session 파일, 개인 경로, 실제 tunnel URL, 개인 결과물은 저장소에 넣지 않아. 자세한 내용은 [보안 정책](SECURITY.md)을 확인해.

## 🎞️ Motion atlas 계약

Frameflow는 provider 결과를 통과시키기 위해 임의로 crop하거나 patch하지 않아. 가로 방향 동일 셀, 정확한 프레임 수, 인접 셀 bleed 없음, ghost trail 없음, 텍스트·워터마크·테두리 없음 조건을 검증하고, 규격이 맞지 않으면 실패 처리해.

## ✅ 검증

```bash
npm test
npm run typecheck
npm run agent:check
npm run public:check
npm run build
```

모든 기본 검증은 계정과 API key 없이 실행돼.

## 📦 저장소 구조

```text
web/       Next.js 스튜디오와 브라우저 인코더
bridge/    Local Bridge, provider adapter, planner 검증
shared/    command catalogue와 AI harness
tests/     offline 회귀·통합 테스트
qa/        정리된 QA fixture와 시나리오
docs/      아키텍처와 결정 기록
```

## 📄 문서

- [공개 전 체크리스트](PUBLIC_RELEASE_CHECKLIST.md)
- [보안 정책](SECURITY.md)
- [기여 가이드](CONTRIBUTING.md)
- [라이선스](LICENSE)
- [브랜드·상표](TRADEMARKS.md)
