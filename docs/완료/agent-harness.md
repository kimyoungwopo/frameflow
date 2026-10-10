# Agent harness 구축 완료 기록

상태: 완료
원본 작업: `docs/작업/command-node-composition-harness.md`

## 구현

- 루트 `AGENTS.md` 추가
- `docs/상태`, `작업`, `생각`, `아이디어`, `진행중`, `완료` 상태 구조 추가
- `scripts/agent-check.cjs` 추가
- 루트 `package.json`에 `npm run agent:check` 추가
- 커맨드 노드 하나에 여러 명령어를 순서대로 담는 규칙을 프로젝트 기억으로 명시
- 자연어 장면 설명과 command code 분리 규칙을 명시
- motion/GIF 요청에 executable `motion` 노드를 요구하는 규칙을 명시
- `shared/ai-harness.json` 추가: COMMAND 다중 코드, PROMPT 분리, motion 강제, graph/safety 계약
- `bridge/planner-contract.js`가 AI harness를 매 planner 요청의 고정 정의와 지침으로 주입
- `tests/ai-harness.test.cjs` 추가: planner definitions 전달과 핵심 계약 검증
- 테스트 하네스의 `gifenc` 모듈 해석 오류 수정
- API 테스트가 외부 `FRAMEFLOW_SERVER_*` 환경변수에 오염되지 않도록 환경 격리

## 검증 증거

- 전체 `npm test` → 178개 통과, 0개 실패
- `tests/workflow.test.cjs` → 19개 통과
- `npm run agent:check` → 통과, `ok: true`, findings 없음
- `node --test tests/ai-harness.test.cjs tests/command-combos.test.cjs tests/planner-context.test.cjs` → 18개 통과
- `node --test tests/api.test.cjs` → 1개 통과
- `npm run typecheck` → 통과
- `npm run build` → 통과

## 남은 위험

- 실제 provider 이미지/GIF end-to-end는 계정 연결과 비용 승인 없이는 검증하지 않았다.
- `docs/작업/ebook-command-recipes.md`에 다음 후보 작업을 기록했다.
