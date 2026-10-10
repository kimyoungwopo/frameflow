# Contributing

## 시작하기

```bash
npm install
npm run setup
npm test
npm run typecheck
npm run agent:check
npm run public:check
```

## 변경 원칙

- 기존 동작과 테스트 범위를 먼저 확인합니다.
- provider 호출을 테스트 기본 경로에 추가하지 않습니다.
- credential·session·개인 결과물을 커밋하지 않습니다.
- motion atlas의 규격 불일치를 crop·patch·수동 보정으로 숨기지 않습니다.
- 공개 문서에는 개인 경로·실제 URL·계정 정보를 쓰지 않습니다.
- 사용자에게 보이는 오류는 성공으로 위장하지 않고 원인을 구분합니다.

## 커밋 전 확인

`PUBLIC_RELEASE_CHECKLIST.md`를 확인하고 다음 명령을 실행하세요.

```bash
npm test && npm run typecheck && npm run agent:check && npm run public:check && npm run build
```
