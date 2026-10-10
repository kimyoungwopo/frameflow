# GIF 경계 노이즈 수정 결과

## 적용
- `web/app/page.tsx`
  - GIF 프레임별 팔레트 생성을 전체 프레임 공통 팔레트 생성으로 변경
  - GIF 호환 이진 알파 정규화 추가
  - 완전 투명 픽셀 RGB를 0으로 정리
  - GIF 프레임 disposal을 전체 프레임 유지 방식으로 변경
  - FPS, 무한 반복, 프레임 수 계약 유지
- `docs/작업/gif-edge-noise-fix.md`
  - 범위와 수용 기준 기록

## 검증
- `npm run agent:check` 통과
- `npm run typecheck` 통과
- `npm run build` 통과
- `tests/workflow.test.cjs`의 모션 프레임 설정 회귀 케이스에서 motion 테스트 통과
- 로컬 Web `http://127.0.0.1:4310/?giffix=1` HTTP 200
- Bridge `http://127.0.0.1:4319/health` 정상
- 공개 URL `https://YOUR-SITE.example/?giffix=1` HTTP 200

## 미해결/주의
- 전체 `npm test`는 180개 중 166개 통과, 14개 실패했다. 실패는 GIF 인코더와 무관한 기존 `workflow.test.cjs` shared-flow/edit 계열에서 발생하며, 대표 오류는 `Cannot read properties of undefined (reading 'prompt')`와 예상 provider 요청 수 0건이다. 해당 테스트 범위는 이번 변경으로 수정하지 않았다.
- 실제 provider 호출과 GIF 다운로드 E2E는 비용·계정 세션이 필요하므로 실행하지 않았다. 이번 검증은 로컬 인코더 코드, 타입/빌드, 모션 회귀, 서비스 응답 확인 범위다.
