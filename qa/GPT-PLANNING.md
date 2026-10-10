# GPT 기반 플로우 구성 — 2026-10-07

## 결과

자연어 구성을 실제 GPT 호출로 변경했습니다. 기본 모델 `gpt-6.1-sol`, 기존 프로젝트의 암호화된 Codex OAuth 계정을 사용합니다. API 키 추가 없이 현재 계정에서 실행 확인했습니다. 웹은 http://127.0.0.1:4320 에 최신 빌드로 실행 중입니다.

웹의 'GPT로 작업 순서 만들기' → Next API → Local Bridge → GPT Responses → JSON 파싱·그래프 검증·좌표 계산 → 캔버스 반영 순서입니다. 기존 localPlan 키워드 함수와 501 시 규칙 대체를 제거했습니다. 실패·취소 시 기존 플로우를 유지합니다.

## 실제 GPT 검증

- 새 생성: 흰 배경의 빨간 운동화, 글자 제외 → PROMPT/GENERATE/PREVIEW. `gpt-plan-first.json`.
- 배경 제거 금지 + 따뜻한/차가운 독립 버전 → 동일 입력에서 두 편집 분기와 PREVIEW 2개. 엔진 추적에서 두 요청 모두 원본 입력을 사용하고 transparent=false 확인.
- 사진 세 장 각각 배경 제거 후 선명도 개선 → 입력3개·편집3개·UPSCALE3개·PREVIEW3개. 앞선 편집 결과가 해당 UPSCALE에 전달되고 transparency 유지 확인.
- 원본 제품 + 참고 조명/색감 → 입력2개·프롬프트·편집·PREVIEW. GENERATE 없이 두 입력으로 편집 확인.

위 3개 복합 사례의 실제 GPT 결과 및 실행 엔진 추적은 `gpt-live-scenarios.json`에 기록했습니다. 엔진 추적의 이미지 작업은 결과 문자열로 대체했습니다. 이번 작업에서 실제 이미지를 생성·편집하지 않았습니다.

실제 브라우저도 GPT에 직접 요청했습니다. 배경 보존·피사체 모양 유지·따뜻한/차가운 버전별 프롬프트가 반환되고 7노드·6연결·예상2회로 반영됐습니다. 구성 취소 후 같은 7노드가 유지됐습니다. 390/768 화면 가로 넘침 없음, 콘솔 error/warn 0개. 기존 프로젝트는 유지하고 새 'GPT 플로우' 프로젝트에서 확인했습니다.

## 응답 검증

strict JSON Schema, 완료 이벤트 필수, 응답 최대1MiB, 64노드·128연결·8입력 제한. ID 중복/알 수 없는 타입/잘못된 연결/순환/누락된 작업 지시/잘못된 PREVIEW/REPEAT 범위를 거부합니다. 모델 좌표 대신 서버가 DAG 깊이로 좌표를 계산합니다. 부분 응답·거절·사용 한도는 성공으로 처리하지 않으며 자동 재시도하지 않습니다.

Codex 실제 SSE는 Content-Type이 없고 `response.completed.output`이 빈 배열인 경우가 있었습니다. 완료된 `response.output_item.done`을 수집하고 terminal 완료까지 확인하도록 수정했습니다. 같은 형식의 테스트가 수정 전 실패, 수정 후 통과했습니다.

자동 검증: `npm test` 44개 통과, 실패0. `npm run typecheck` 통과. 최종 `npm run build` 컴파일·타입 검사·9페이지 생성 통과. 계획 API 과도한 입력 차단, local-mode 응답 차단, 인증·429, 클라이언트 연결 종료에 따른 GPT 호출 취소도 확인했습니다.

## 인증과 근거

신규 ChatGPT 토큰 공유 OAuth 문서는 공개 `api.openai.com/v1/responses`를 사용합니다. 기존 프로젝트의 Codex OAuth 토큰은 그 공개 호출에서 401을 반환했습니다. 기존 Codex 인증에 맞는 경로는 공식 Codex 소스에서 확인하고 실제 성공을 확인했습니다. 신규 공개 OAuth 연동을 구현했다고 주장하지 않습니다.

- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
- [OpenAI Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [공식 Codex의 기존 ChatGPT 인증 경로](https://github.com/openai/codex/blob/18e28fe1b96db7e1d6b13584bec37c41f71b8b0e/codex-rs/model-provider-info/src/lib.rs#L80)

선택적으로 서버 환경에 PROVIDER_PLAN_AUTH=api-key 및 OPENAI_API_KEY를 지정하면 공개 Responses API를 사용합니다. 현재 실제 검증은 기존 Codex OAuth 경로이며 API 키 경로의 실제 과금 호출은 하지 않았습니다. 신규 로그인, 다른 계정 권한, 모든 자연어 표현은 보장하지 않습니다. 조건부 분기·픽셀 확대 배율 등 실행 엔진의 제한은 유지합니다. GPT의 주의사항과 노드를 확인한 뒤 이미지를 실행하세요.

![실제 GPT가 만든 플로우](gpt-planner.png)
