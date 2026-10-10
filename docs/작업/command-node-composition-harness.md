# 커맨드 노드 조합과 에이전트 하네스

상태: 완료

## 목표

자연어 의도를 하나의 COMMAND 노드 안 여러 명령어 조합으로 변환하고, 프로젝트 규칙·검증·결정사항을 다음 에이전트 세션에서도 재사용한다.

## 범위

- COMMAND 노드의 다중 `/CODE` 배열 및 순서 보존
- 장면 설명·보존 조건과 command code 분리
- 지원 catalog 밖의 code 거부
- motion 요청의 전용 `motion` 노드 강제
- 프로젝트 로컬 `AGENTS.md`와 `npm run agent:check` 도입

## 비범위

- 새로운 provider 인증 방식
- 외부 공개 Bridge
- 실제 유료 provider 호출 자동화
- command catalog의 무분별한 확장

## Acceptance criteria

- 자연어 planner가 `/RAIN /NIGHTFLASH /MOTIONBLUR`를 COMMAND 노드 하나에 넣는다.
- command code와 자유 설명이 섞여도 prompt 노드로 분리되며 이미지 작업 수는 불필요하게 늘지 않는다.
- unknown command와 graph cycle이 실패한다.
- motion/GIF 요청에 motion 노드가 없으면 실패 또는 제한된 재구성으로 처리한다.
- `npm run agent:check`, `npm test`, `npm run typecheck`, `npm run build`가 통과한다.

## 관련 코드

- `shared/command-catalog.json`
- `bridge/planned-commands.js`
- `bridge/planner-contract.js`
- `web/app/workflow-engine.ts`
- `tests/command-combos.test.cjs`
